/**
 * Guardrail regression coverage for in-house rate planning against LIVE data.
 *
 * The sibling suite (tests/inhouseRatePlanning.test.ts) proves the solver's
 * arithmetic on synthetic residents. This one proves the same operator
 * guardrails survive the whole pipeline: the real SQL, the rent roll's two
 * date spellings, the daily-vs-monthly service lines, companion B-bed rows,
 * NULL street rates and whatever payer strings the import actually produced.
 *
 * A data-shape surprise cannot be caught by unit tests — it can only be caught
 * by running `calculatePlan` on the database and re-checking every promise the
 * operator was made:
 *
 *   • no resident's rate is ever cut
 *   • no resident exceeds the configured maximum increase
 *   • no resident falls below the configured minimum, unless the street
 *     ceiling is what held them back
 *   • no new rate crosses street unless `allowInhouseAboveStreet` is on
 *   • the recommended street increase stays inside its own ceiling
 *   • the headline weighted-average increase reconciles to the per-resident
 *     recommendations, recomputed independently from resident-day weights
 *
 * Scopes are DISCOVERED from the database rather than hard-coded, so the test
 * keeps testing something after a re-import: the largest client, one monthly
 * service line, one daily-rate line (HC / HC-MC), and the campus carrying the
 * most companion B-beds.
 *
 * Run with: npx tsx tests/inhouseRatePlanningLive.test.ts
 */
import { pool } from "../server/db";
import { DAYS_PER_MONTH } from "../shared/careRates";
import { DEFAULT_ASSUMPTIONS } from "../shared/inhousePlanning";
import type {
  PlanResult,
  PlanningAssumptions,
  ResidentRecommendation,
} from "../shared/inhousePlanning";
import {
  buildResidents,
  calculatePlan,
  fetchResidentRows,
  getLatestMonthForScope,
  horizonQuarters,
  PlanningDataError,
} from "../server/services/inhouseRatePlanning";
import {
  addMonths,
  monthBoundsMs,
  quarterEndMs,
  quarterStartMs,
} from "../server/services/inhouseRatePlanning/dates";
import { isDailyRateServiceLine } from "../server/services/rateNormalization";
import { isBBedRow } from "../shared/bBed";
import { privatePaySql } from "../shared/payerScope";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function ok(description: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    if (detail) console.log(`    ${detail}`);
    failed++;
  }
}

function near(description: string, actual: number, expected: number, tolerance: number) {
  ok(
    description,
    Math.abs(actual - expected) <= tolerance,
    `Expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

// ── Scope discovery ─────────────────────────────────────────────────────────

interface Scope {
  label: string;
  clientId: string;
  location: string | null;
  serviceLine: string;
  /** Plan already built while discovering this scope, reused as the default run. */
  prefetched: PlanResult;
}

interface Candidate {
  location: string | null;
  serviceLine: string;
}

/** The client with the most occupied rent-roll rows — i.e. the real data set. */
async function largestClient(): Promise<string | null> {
  const res = await pool.query<{ client_id: string }>(
    `SELECT client_id
       FROM rent_roll_data
      WHERE occupied_yn = true
      GROUP BY client_id
      ORDER BY COUNT(*) DESC
      LIMIT 1`,
  );
  return res.rows[0]?.client_id ?? null;
}

/**
 * Candidate scopes, ranked by how many rows would actually reach the solver.
 *
 * Ranking by raw occupied rows is what makes a discovery-driven test lie: the
 * campus with the most AL rows can have nobody left once the private-pay scope
 * and the in-house rate filter apply, and the scope then quietly produces
 * nothing. Every discovery query here therefore applies the same payer scope
 * and rate condition production applies, over each scope's own latest month.
 *
 * @param byCampus false ranks whole service lines (portfolio scope); true
 *                 ranks campus + service line pairs.
 * @param companionOnly restrict the count to companion B-bed rows.
 */
async function candidateScopes(
  clientId: string,
  serviceLines: string[],
  opts: { byCampus: boolean; companionOnly?: boolean },
): Promise<Candidate[]> {
  const scopeCols = opts.byCampus ? "rr.location, rr.service_line" : "rr.service_line";
  const latestKey = opts.byCampus ? "location, service_line" : "service_line";
  const joinOn = opts.byCampus
    ? "l.location = rr.location AND l.service_line = rr.service_line"
    : "l.service_line = rr.service_line";
  const companionSql = opts.companionOnly ? "AND rr.room_number ~* '/[B-Zb-z]$'" : "";

  const res = await pool.query<{ location: string | null; service_line: string }>(
    `WITH latest AS (
       SELECT ${latestKey}, MAX(upload_month) AS month
         FROM rent_roll_data
        WHERE client_id = $1
          AND occupied_yn = true
          AND service_line = ANY($2)
        GROUP BY ${latestKey}
     )
     SELECT ${opts.byCampus ? "rr.location" : "NULL::text AS location"}, rr.service_line
       FROM rent_roll_data rr
       JOIN latest l ON ${joinOn} AND l.month = rr.upload_month
      WHERE rr.client_id = $1
        AND rr.occupied_yn = true
        AND rr.service_line = ANY($2)
        AND rr.in_house_rate > 0
        AND ${privatePaySql("rr.payor_type")}
        ${companionSql}
      GROUP BY ${scopeCols}
      ORDER BY COUNT(*) DESC
      LIMIT 12`,
    [clientId, serviceLines],
  );
  return res.rows.map((r) => ({ location: r.location, serviceLine: r.service_line }));
}

/**
 * Walk candidates until one produces a real plan.
 *
 * A `PlanningDataError` here is not an excuse to skip: it only means THIS
 * candidate is unplannable (no private-pay population, no prior-year baseline)
 * and the next one should be tried. Running out of candidates is a failure —
 * a suite that silently stops covering the daily-rate path after a re-import
 * is exactly the blind spot this file exists to close.
 */
async function resolveScope(
  clientId: string,
  describe: string,
  candidates: Candidate[],
  extraRequirement?: (plan: PlanResult) => boolean,
): Promise<Scope | null> {
  const rejected: string[] = [];
  for (const candidate of candidates) {
    const where = `${candidate.location ?? "portfolio"} ${candidate.serviceLine}`;
    let plan: PlanResult;
    try {
      plan = await calculatePlan({
        clientId,
        locationId: null,
        location: candidate.location,
        serviceLine: candidate.serviceLine,
        assumptions: assumptions(),
      });
    } catch (err) {
      if (err instanceof PlanningDataError) {
        rejected.push(`${where}: ${err.message}`);
        continue;
      }
      throw err;
    }
    if (plan.residents.length === 0) {
      rejected.push(`${where}: plan contained no residents`);
      continue;
    }
    if (extraRequirement && !extraRequirement(plan)) {
      rejected.push(`${where}: did not satisfy ${describe}`);
      continue;
    }
    return {
      label: `${where} (${describe})`,
      clientId,
      location: candidate.location,
      serviceLine: candidate.serviceLine,
      prefetched: plan,
    };
  }
  ok(
    `a ${describe} scope with a plannable population exists`,
    false,
    rejected.length
      ? `tried ${rejected.length} candidate(s):\n      ${rejected.join("\n      ")}`
      : "no candidate scopes at all",
  );
  return null;
}

// ── Guardrail assertions ────────────────────────────────────────────────────

const EPS_PCT = 1e-6;
const EPS_MONEY = 0.01;

/**
 * The floor that actually applies to one resident.
 *
 * The configured minimum is a floor on the increase, but it can never push a
 * rate through the street ceiling: a resident with less headroom than the
 * minimum is legitimately held below it. Encoding that here — rather than
 * asserting a flat `increase >= min` — is what makes the assertion true of the
 * guardrail rather than of the happy path.
 */
function effectiveFloorPct(
  rec: ResidentRecommendation,
  a: PlanningAssumptions,
  streetMultiplier: number,
): number {
  if (a.allowInhouseAboveStreet) return a.minInhouseIncreasePct;
  if (rec.streetRateMonthly <= 0) return a.minInhouseIncreasePct;
  const effectiveStreet = rec.streetRateMonthly * streetMultiplier;
  const headroomPct = Math.max(0, (effectiveStreet / rec.currentRateMonthly - 1) * 100);
  return Math.min(a.minInhouseIncreasePct, headroomPct);
}

/** Street multiplier in force on the in-house effective date. */
function streetMultiplierAtInhouse(plan: PlanResult): number {
  const streetFirst =
    Date.parse(plan.assumptions.streetRateEffectiveDate) <=
    Date.parse(plan.assumptions.inhouseEffectiveDate);
  return streetFirst ? 1 + plan.streetIncreasePct / 100 : 1;
}

function assertGuardrails(title: string, plan: PlanResult) {
  const a = plan.assumptions;
  const mult = streetMultiplierAtInhouse(plan);
  const recs = plan.residents;

  ok(`${title}: the plan returned residents`, recs.length > 0, `got ${recs.length}`);

  // 1. Never a rate cut.
  const cuts = recs.filter(
    (r) => r.increasePct < -EPS_PCT || r.newRateMonthly < r.currentRateMonthly - EPS_MONEY,
  );
  ok(
    `${title}: no resident's rate is cut`,
    cuts.length === 0,
    cuts.length
      ? `${cuts.length} cut, worst: room ${cuts[0].roomNumber} ${cuts[0].currentRateMonthly} → ${cuts[0].newRateMonthly}`
      : undefined,
  );

  // 2. Nobody above the configured maximum.
  const overMax = recs.filter((r) => r.increasePct > a.maxInhouseIncreasePct + EPS_PCT);
  ok(
    `${title}: no resident exceeds the ${a.maxInhouseIncreasePct}% maximum increase`,
    overMax.length === 0,
    overMax.length
      ? `${overMax.length} over, worst ${Math.max(...overMax.map((r) => r.increasePct)).toFixed(4)}%`
      : undefined,
  );

  // 3. Nobody below the minimum unless street is what stopped them.
  const underMin = recs.filter(
    (r) => r.increasePct < effectiveFloorPct(r, a, mult) - 1e-6,
  );
  ok(
    `${title}: no resident falls below the ${a.minInhouseIncreasePct}% minimum without a street-ceiling reason`,
    underMin.length === 0,
    underMin.length
      ? `${underMin.length} below, e.g. room ${underMin[0].roomNumber} got ${underMin[0].increasePct.toFixed(4)}% with floor ${effectiveFloorPct(underMin[0], a, mult).toFixed(4)}%`
      : undefined,
  );

  // 4. Street ceiling. A resident who already sits above street is never cut
  //    back down to it, so their own current rate is the ceiling that applies.
  if (!a.allowInhouseAboveStreet) {
    const crossed = recs.filter((r) => {
      if (r.streetRateMonthly <= 0) return false;
      const ceiling = Math.max(r.streetRateMonthly * mult, r.currentRateMonthly);
      return r.newRateMonthly > ceiling + EPS_MONEY;
    });
    ok(
      `${title}: no new rate crosses street while allowInhouseAboveStreet is off`,
      crossed.length === 0,
      crossed.length
        ? `${crossed.length} crossed, e.g. room ${crossed[0].roomNumber}: ${crossed[0].newRateMonthly.toFixed(2)} vs street ${(crossed[0].streetRateMonthly * mult).toFixed(2)}`
        : undefined,
    );
    const blocked = recs.filter(
      (r) => r.constraint === "at_or_above_street" || r.constraint === "street_cap",
    );
    ok(
      `${title}: residents reported as blocked by street all sit at their ceiling`,
      blocked.every(
        (r) =>
          r.streetRateMonthly <= 0 ||
          r.newRateMonthly <= Math.max(r.streetRateMonthly * mult, r.currentRateMonthly) + EPS_MONEY,
      ),
    );
  } else {
    ok(
      `${title}: allowInhouseAboveStreet lets rates past street where the maximum permits`,
      recs.every((r) => r.increasePct <= a.maxInhouseIncreasePct + EPS_PCT),
    );
  }

  // 5. The street recommendation respects its own ceiling.
  ok(
    `${title}: the recommended street increase stays within the ${a.maxStreetIncreasePct}% ceiling`,
    plan.streetIncreasePct <= a.maxStreetIncreasePct + 1e-6 && plan.streetIncreasePct >= -1e-9,
    `got ${plan.streetIncreasePct.toFixed(4)}%`,
  );

  // 6. Rate basis. A daily line reported as monthly (or vice versa) is a 30x
  //    error, and it would show up as an implausible display rate long before
  //    anyone noticed the label.
  const daily = isDailyRateServiceLine(plan.scope.serviceLine);
  ok(
    `${title}: rate basis is reported as ${daily ? "daily" : "monthly"}`,
    plan.rateBasis === (daily ? "daily" : "monthly") &&
      recs.every((r) => r.rateBasis === plan.rateBasis),
  );
  const badDisplay = recs.filter((r) => {
    const expected = daily ? r.newRateMonthly / DAYS_PER_MONTH : r.newRateMonthly;
    return Math.abs(r.newRateDisplay - expected) > 1;
  });
  ok(
    `${title}: display rates are the monthly rates converted to the billed unit`,
    badDisplay.length === 0,
    badDisplay.length
      ? `e.g. room ${badDisplay[0].roomNumber}: display ${badDisplay[0].newRateDisplay} vs monthly ${badDisplay[0].newRateMonthly.toFixed(2)}`
      : undefined,
  );
  const bandLo = daily ? 20 : 600;
  const bandHi = daily ? 3000 : 90000;
  const outOfBand = recs.filter(
    (r) => r.newRateDisplay < bandLo || r.newRateDisplay > bandHi,
  );
  ok(
    `${title}: every recommended rate is plausible for a ${daily ? "daily" : "monthly"} line ($${bandLo}–$${bandHi})`,
    outOfBand.length === 0,
    outOfBand.length
      ? `${outOfBand.length} out of band, e.g. room ${outOfBand[0].roomNumber} at ${outOfBand[0].newRateDisplay}`
      : undefined,
  );

  // 7. Summary reconciliation against the recommendations it summarizes.
  const totalMonthly = recs.reduce((s, r) => s + r.increaseDollarsMonthly, 0);
  near(
    `${title}: total monthly increase equals the sum of the recommendations`,
    plan.summary.totalMonthlyIncreaseDollars,
    totalMonthly,
    Math.max(0.01, Math.abs(totalMonthly) * 1e-9),
  );
  ok(
    `${title}: resident count matches the recommendation list`,
    plan.summary.residentCount === recs.length,
    `${plan.summary.residentCount} vs ${recs.length}`,
  );
  near(
    `${title}: reported maximum resident increase matches the list`,
    plan.summary.maxIncreasePct,
    Math.max(...recs.map((r) => r.increasePct)),
    1e-9,
  );
  near(
    `${title}: reported minimum resident increase matches the list`,
    plan.summary.minIncreasePct,
    Math.min(...recs.map((r) => r.increasePct)),
    1e-9,
  );
}

/**
 * Recompute the headline weighted-average increase from the per-resident
 * recommendations and the resident-day weights, independently of the summary.
 *
 * The weights come from `buildResidents` over the same horizon the plan used,
 * joined to the recommendations by key. If the reported average and this one
 * disagree, the number the operator approves is not the number the plan hands
 * to residents.
 */
async function assertWeightedAverageReconciles(title: string, plan: PlanResult) {
  const quarters = horizonQuarters(plan.assumptions.inhouseEffectiveDate);
  const horizonStartMs = quarterStartMs(quarters[0]);
  const horizonEndMs = quarterEndMs(quarters[quarters.length - 1]);
  const anchorMs = monthBoundsMs(addMonths(plan.scope.sourceMonth, 1)).startMs;

  const rows = await fetchResidentRows(
    {
      clientId: plan.scope.clientId,
      location: plan.scope.location,
      serviceLine: plan.scope.serviceLine,
    },
    plan.scope.sourceMonth,
  );
  const { residents } = buildResidents(rows, {
    horizonStartMs: Math.min(anchorMs, horizonStartMs),
    horizonEndMs,
  });
  const weightByKey = new Map(residents.map((r) => [r.key, r.weight]));

  ok(
    `${title}: every recommendation maps back to a resident-day weight`,
    plan.residents.every((r) => weightByKey.has(r.key)),
    `${plan.residents.filter((r) => !weightByKey.has(r.key)).length} unmatched`,
  );

  let wCurrent = 0;
  let wNew = 0;
  let wTotal = 0;
  for (const rec of plan.residents) {
    const w = weightByKey.get(rec.key) ?? 0;
    wCurrent += w * rec.currentRateMonthly;
    wNew += w * rec.newRateMonthly;
    wTotal += w;
  }
  ok(`${title}: resident-day weights are positive`, wTotal > 0, `got ${wTotal}`);

  const recomputedAvgIncreasePct = (wNew / wCurrent - 1) * 100;
  near(
    `${title}: reported weighted-average increase reconciles to the recommendations`,
    plan.summary.weightedAvgIncreasePct,
    recomputedAvgIncreasePct,
    0.01,
  );
  near(
    `${title}: reported current average rate is the resident-day weighted average`,
    plan.summary.currentAvgInhouseRateMonthly,
    wCurrent / wTotal,
    0.01,
  );
  near(
    `${title}: reported new average rate is the resident-day weighted average`,
    plan.summary.newAvgInhouseRateMonthly,
    wNew / wTotal,
    0.01,
  );

  // A feasible plan claims it hit the required average; if the allocation had
  // to clip, "feasible" was the wrong verdict.
  if (plan.feasible) {
    near(
      `${title}: a feasible plan actually delivers the required average increase`,
      plan.summary.weightedAvgIncreasePct,
      plan.requiredWeightedAvgIncreasePct,
      0.01,
    );
  } else {
    ok(
      `${title}: an infeasible plan reports why`,
      plan.infeasibility !== null,
      "infeasibility block missing",
    );
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────

function assumptions(overrides: Partial<PlanningAssumptions> = {}): PlanningAssumptions {
  return { ...DEFAULT_ASSUMPTIONS, ...overrides };
}

/**
 * Run one settings variant against a scope that has already proved plannable.
 *
 * Nothing here may skip. The scope was resolved by building a plan with the
 * default settings, so a later variant that cannot produce one has found a
 * real defect — changing the minimum increase or the street effective date
 * must never make a population disappear.
 */
async function runScope(
  scope: Scope,
  variant: string,
  overrides: Partial<PlanningAssumptions>,
): Promise<PlanResult | null> {
  const title = `${scope.label} [${variant}]`;
  let plan: PlanResult;
  try {
    plan =
      variant === "default"
        ? scope.prefetched
        : await calculatePlan({
            clientId: scope.clientId,
            locationId: null,
            location: scope.location,
            serviceLine: scope.serviceLine,
            assumptions: assumptions(overrides),
          });
  } catch (err) {
    ok(
      `${title}: calculatePlan produced a plan`,
      false,
      err instanceof PlanningDataError
        ? `settings change made a plannable scope unplannable: ${err.message}`
        : String(err),
    );
    return null;
  }
  assertGuardrails(title, plan);
  await assertWeightedAverageReconciles(title, plan);
  return plan;
}

async function main() {
  console.log("\n=== In-House Rate Planning — live-data guardrails ===\n");

  const clientId = await largestClient();
  if (!clientId) {
    ok("a client with occupied rent-roll rows exists", false, "no rent roll data at all");
    return;
  }
  console.log(`Client under test: ${clientId}\n`);

  // Three scopes are REQUIRED. Each is resolved by actually building a plan,
  // so "the data no longer supports this scope" fails the run instead of
  // quietly shrinking what the suite covers.
  const monthlyScope = await resolveScope(
    clientId,
    "monthly basis",
    (await candidateScopes(clientId, ["AL", "AL/MC", "SL", "VIL"], { byCampus: false })).map(
      (c) => ({ location: null, serviceLine: c.serviceLine }),
    ),
  );
  const dailyScope = await resolveScope(
    clientId,
    "daily basis",
    await candidateScopes(clientId, ["HC", "HC/MC"], { byCampus: true }),
  );
  const companionScope = await resolveScope(
    clientId,
    "companion beds",
    await candidateScopes(clientId, ["AL", "AL/MC", "SL", "VIL"], {
      byCampus: true,
      companionOnly: true,
    }),
    (plan) => plan.residents.some((r) => r.isCompanionBed),
  );

  ok(
    "a monthly service line, a daily-rate service line and a companion-bed campus are all plannable",
    !!monthlyScope && !!dailyScope && !!companionScope,
    `monthly=${monthlyScope?.label ?? "none"} daily=${dailyScope?.label ?? "none"} companion=${companionScope?.label ?? "none"}`,
  );

  const scopes = [monthlyScope, dailyScope, companionScope].filter(
    (s): s is Scope => s !== null,
  );

  for (const scope of scopes) {
    console.log(`\n-- ${scope.label} --`);

    // Default operator settings: 0–8%, may not exceed street.
    const base = await runScope(scope, "default", {});
    if (!base) continue;

    // A non-zero minimum, which must still not push anyone through street.
    await runScope(scope, "min 2% / max 5%", {
      minInhouseIncreasePct: 2,
      maxInhouseIncreasePct: 5,
    });

    // Street increases forbidden: the ceiling that creates in-house headroom
    // is nailed shut, so the street cap does all the binding.
    await runScope(scope, "street frozen", { maxStreetIncreasePct: 0 });

    // Street rise lands AFTER the in-house increase, so today's street rate —
    // not the raised one — is the ceiling that applies.
    const inhouseDate = base.assumptions.inhouseEffectiveDate;
    const [y, m, d] = inhouseDate.split("-").map(Number);
    const laterStreet = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    await runScope(scope, "street rise after in-house", {
      inhouseEffectiveDate: inhouseDate,
      streetRateEffectiveDate: laterStreet,
    });

    // The rule switched off: rates may pass street, but the maximum still binds.
    await runScope(scope, "above-street allowed", { allowInhouseAboveStreet: true });
  }

  // Companion beds must actually be IN the plan — the whole point of that
  // scope. Excluding them from street averages must not exclude the people.
  if (companionScope) {
    const title = companionScope.label;
    const plan = companionScope.prefetched;
    const companions = plan.residents.filter((r) => r.isCompanionBed);
    ok(
      `${title}: companion-bed residents are in the plan, not filtered out`,
      companions.length > 0,
      `${companions.length} of ${plan.residents.length}`,
    );
    ok(
      `${title}: companion flag matches the room-number convention`,
      plan.residents.every(
        (r) => r.isCompanionBed === isBBedRow(companionScope!.serviceLine, r.roomNumber),
      ),
    );
    ok(
      `${title}: companion residents obey the same guardrails`,
      companions.every(
        (r) =>
          r.increasePct >= -EPS_PCT &&
          r.increasePct <= plan.assumptions.maxInhouseIncreasePct + EPS_PCT &&
          (r.streetRateMonthly <= 0 ||
            r.newRateMonthly <=
              Math.max(
                r.streetRateMonthly * streetMultiplierAtInhouse(plan),
                r.currentRateMonthly,
              ) +
                EPS_MONEY),
      ),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    failed++;
  })
  .finally(async () => {
    await pool.end();
    console.log("\n=== Summary ===");
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
