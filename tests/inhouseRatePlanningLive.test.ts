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
 *   • Street Rate shapes allocation but never caps an in-house increase
 *   • the recommended street increase stays inside its own ceiling
 *   • low-but-positive source rates remain in the resident recommendations
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
  fetchCurrentStreetRate,
  fetchMixStandardizedStreetComparison,
  fetchResidentRows,
  getLatestMonthForScope,
  horizonQuarters,
  PlanningDataError,
} from "../server/services/inhouseRatePlanning";
import {
  expectedMonths,
  fetchCohortMonthlyRealizedRates,
  fetchMonthlyRealizedRates,
} from "../server/services/inhouseRatePlanning/dataAccess";
import {
  addMonths,
  addQuarters,
  monthBoundsMs,
  quarterEndMs,
  quarterStartMs,
} from "../server/services/inhouseRatePlanning/dates";
import { isDailyRateServiceLine } from "../server/services/rateNormalization";
import {
  buildRateBaselineJoin,
  streetRateGate,
} from "../server/services/rateBaselineView";
import { baseRateExclusionSql } from "../shared/baseRate";
import { privatePaySql } from "../shared/payerScope";
import { classifyRateProduct, rateProductSql } from "../shared/rateProduct";

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

function standardizeMatchedMovement(
  currentAverageMonthly: number,
  comparison: {
    priorMatchedMonthly: number;
    currentMatchedMonthly: number;
  },
): number {
  return comparison.currentMatchedMonthly > 0
    ? currentAverageMonthly *
        (comparison.priorMatchedMonthly / comparison.currentMatchedMonthly)
    : 0;
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
 */
async function candidateScopes(
  clientId: string,
  serviceLines: string[],
  opts: { byCampus: boolean },
): Promise<Candidate[]> {
  const scopeCols = opts.byCampus ? "rr.location, rr.service_line" : "rr.service_line";
  const latestKey = opts.byCampus ? "location, service_line" : "service_line";
  const joinOn = opts.byCampus
    ? "l.location = rr.location AND l.service_line = rr.service_line"
    : "l.service_line = rr.service_line";
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
        AND ${baseRateExclusionSql("rr.")}
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
  return a.minInhouseIncreasePct;
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

  // 3. Nobody below the configured minimum.
  const underMin = recs.filter(
    (r) => r.increasePct < effectiveFloorPct(r, a, mult) - 1e-6,
  );
  ok(
    `${title}: no resident falls below the ${a.minInhouseIncreasePct}% minimum`,
    underMin.length === 0,
    underMin.length
      ? `${underMin.length} below, e.g. room ${underMin[0].roomNumber} got ${underMin[0].increasePct.toFixed(4)}% with floor ${effectiveFloorPct(underMin[0], a, mult).toFixed(4)}%`
      : undefined,
  );

  // 4. The legacy allow-above-street setting never creates a resident cap.
  ok(
    `${title}: no resident is reported as blocked by Street Rate`,
    recs.every((r) => r.constraint !== "at_or_above_street" && r.constraint !== "street_cap"),
  );

  // 5. The street recommendation respects its own ceiling.
  ok(
    `${title}: the recommended street increase stays within the ${a.maxStreetIncreasePct}% ceiling`,
    plan.streetIncreasePct <= a.maxStreetIncreasePct + 1e-6 && plan.streetIncreasePct >= -1e-9,
    `got ${plan.streetIncreasePct.toFixed(4)}%`,
  );

  // 6. Rate basis. A daily line reported as monthly (or vice versa) is a 30x
  //    error. Source rates are allowed to be outside normal ranges: a bad or
  //    unusually low positive rate must not remove its resident from the plan.
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
  const invalidRates = recs.filter(
    (r) =>
      !Number.isFinite(r.currentRateMonthly) ||
      !Number.isFinite(r.newRateMonthly) ||
      !Number.isFinite(r.newRateDisplay) ||
      r.currentRateMonthly <= 0 ||
      r.newRateMonthly < r.currentRateMonthly,
  );
  ok(
    `${title}: every positive source rate remains a finite recommendation, even outside normal ranges`,
    invalidRates.length === 0,
    invalidRates.length
      ? `${invalidRates.length} invalid, e.g. room ${invalidRates[0].roomNumber} at ${invalidRates[0].newRateDisplay}`
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

/**
 * The rate-product classifier exists twice — once in JS for resident rows,
 * once as SQL for the baseline medians. If the two ever disagree, a resident
 * is measured against a median computed over a DIFFERENT set of rows than the
 * one they were assigned to, and nothing anywhere raises an error. Only real
 * rent-roll text can prove the two dialects agree, so the check runs here.
 */
async function assertProductClassifierParity(clientId: string) {
  console.log("\n-- Rate product classifier: SQL twin agrees with JS --");
  const res = await pool.query<{
    service_line: string | null;
    room_number: string | null;
    room_type: string | null;
    source_room_type: string | null;
    sql_product: string;
  }>(
    `SELECT rr.service_line, rr.room_number, rr.room_type, rr.source_room_type,
            ${rateProductSql("rr.")} AS sql_product
       FROM rent_roll_data rr
      WHERE rr.client_id = $1
        AND rr.upload_month = (
          SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1
        )`,
    [clientId],
  );

  ok("the classifier has real rows to judge", res.rows.length > 0, `${res.rows.length} rows`);

  const mismatches = res.rows.filter(
    (r) =>
      classifyRateProduct(r.service_line, r.room_number, r.room_type, r.source_room_type) !==
      r.sql_product,
  );
  ok(
    "every row classifies identically in SQL and JS",
    mismatches.length === 0,
    mismatches
      .slice(0, 3)
      .map(
        (r) =>
          `${r.service_line} ${r.room_number} "${r.room_type}"/"${r.source_room_type}": sql=${r.sql_product} js=${classifyRateProduct(r.service_line, r.room_number, r.room_type, r.source_room_type)}`,
      )
      .join(" | "),
  );

  // A classifier that puts everything in one bucket would pass parity and
  // still be useless, so prove the non-base products are actually found.
  const found = new Set(res.rows.map((r) => r.sql_product));
  ok(
    "more than the base product is recognised in real data",
    found.size > 1,
    `products seen: ${Array.from(found).join(", ")}`,
  );
}

/**
 * The Bedford HC failure was a room-mix failure, not a pricing failure. Keep a
 * real production-shaped fixture here: West Lafayette's April 2025 current
 * cohort has the same room-level Street Rates as January, but several rooms
 * changed payer. January's portfolio average contains a different room mix and
 * is therefore not a valid annual-ceiling baseline.
 */
async function assertCurrentRoomMixStreetBaseline(clientId: string) {
  const scope = {
    clientId,
    location: "West Lafayette - 2135",
    serviceLine: "HC",
  };
  const baselineMonth = "2025-01";
  const currentMonth = "2025-04";
  const fixture = await pool.query<{
    room_number: string;
    current_rate: string;
    historical_rate: string;
    current_payer: string | null;
    historical_payer: string | null;
  }>(
    `SELECT cur.room_number,
            cur.street_rate AS current_rate,
            hist.street_rate AS historical_rate,
            cur.payor_type AS current_payer,
            hist.payor_type AS historical_payer
       FROM rent_roll_data cur
       JOIN rent_roll_data hist
         ON hist.client_id = cur.client_id
        AND hist.location = cur.location
        AND hist.service_line = cur.service_line
        AND hist.upload_month = $3
        AND hist.room_number = cur.room_number
      WHERE cur.client_id = $1
        AND cur.location = $4
        AND cur.service_line = $5
        AND cur.upload_month = $2
        AND cur.street_rate > 0
        AND ${privatePaySql("cur.payor_type")}
        AND ${baseRateExclusionSql("cur.")}
        AND hist.street_rate > 0
        AND ${baseRateExclusionSql("hist.")}`,
    [clientId, currentMonth, baselineMonth, scope.location, scope.serviceLine],
  );

  ok(
    "the room-mix regression fixture exists",
    fixture.rows.length > 0,
    `expected ${scope.location} ${scope.serviceLine} rows for ${currentMonth}`,
  );
  if (fixture.rows.length === 0) return;

  const unchanged = fixture.rows.every(
    (r) => Math.abs(Number(r.current_rate) - Number(r.historical_rate)) < 0.01,
  );
  const payerChanges = fixture.rows.filter(
    (r) => r.current_payer !== r.historical_payer,
  ).length;
  ok(
    "the fixture keeps room-level Street Rates unchanged",
    unchanged,
    fixture.rows
      .filter((r) => Math.abs(Number(r.current_rate) - Number(r.historical_rate)) >= 0.01)
      .slice(0, 2)
      .map((r) => `${r.room_number}: ${r.historical_rate} → ${r.current_rate}`)
      .join(", "),
  );
  ok(
    "the fixture changes the payer mix",
    payerChanges > 0,
    `${payerChanges} of ${fixture.rows.length} matched rooms changed payer`,
  );

  const rawJanuary = await pool.query<{ avg_rate: string | null }>(
    `SELECT AVG(street_rate) AS avg_rate
       FROM rent_roll_data
      WHERE client_id = $1
        AND location = $2
        AND service_line = $3
        AND upload_month = $4
        AND street_rate > 0`,
    [clientId, scope.location, scope.serviceLine, baselineMonth],
  );
  const independentlyWeightedJanuaryAverage =
    Number(rawJanuary.rows[0]?.avg_rate) * DAYS_PER_MONTH;
  const comparison = await fetchMixStandardizedStreetComparison(
    scope,
    baselineMonth,
    currentMonth,
  );
  const currentAverageMonthly = await fetchCurrentStreetRate(scope, currentMonth);
  const standardizedJanuaryAverage = standardizeMatchedMovement(
    currentAverageMonthly,
    comparison,
  );
  const expectedHistoricalMonthly =
    (fixture.rows.reduce((sum, r) => sum + Number(r.historical_rate), 0) /
      fixture.rows.length) *
    DAYS_PER_MONTH;
  near(
    "the January baseline is averaged over the current eligible room cohort",
    standardizedJanuaryAverage,
    expectedHistoricalMonthly,
    0.01,
  );
  ok(
    "the room-mix baseline differs from the independently weighted January average",
    Math.abs(standardizedJanuaryAverage - independentlyWeightedJanuaryAverage) > 1,
    `cohort=${standardizedJanuaryAverage}, independent=${independentlyWeightedJanuaryAverage}`,
  );
  near(
    "unchanged room prices do not consume Street Rate ceiling headroom",
    standardizedJanuaryAverage,
    await fetchCurrentStreetRate(scope, currentMonth),
    0.01,
  );
}
/**
 * Current rent rolls can contain more than one eligible row for a physical
 * room. The annual baseline and today's Street Rate must not weight those
 * rooms by row count. Find a real duplicate-row scope and compare production
 * output with an independently room-weighted SQL calculation.
 */
async function assertDuplicateRowsUseRoomWeights(clientId: string) {
  const duplicates = await pool.query<{
    location: string;
    service_line: string;
    upload_month: string;
    row_count: string;
    room_count: string;
  }>(
    `SELECT rr.location,
            rr.service_line,
            rr.upload_month,
            COUNT(*) AS row_count,
            COUNT(DISTINCT rr.room_number) AS room_count
       FROM rent_roll_data rr
      WHERE rr.client_id = $1
        AND rr.street_rate > 0
        AND ${privatePaySql("rr.payor_type")}
        AND ${baseRateExclusionSql("rr.")}
      GROUP BY rr.location, rr.service_line, rr.upload_month
     HAVING COUNT(*) > COUNT(DISTINCT rr.room_number)
      ORDER BY COUNT(*) - COUNT(DISTINCT rr.room_number) DESC
      LIMIT 1`,
    [clientId],
  );
  ok(
    "a duplicate-row room-weight regression fixture exists",
    duplicates.rows.length > 0,
    "no eligible scope has multiple rows for a physical room",
  );
  if (duplicates.rows.length === 0) return;

  const fixture = duplicates.rows[0];
  const scope = {
    clientId,
    location: fixture.location,
    serviceLine: fixture.service_line,
  };
  const params = [clientId, fixture.upload_month, fixture.service_line, fixture.location];
  const join = buildRateBaselineJoin({
    rr: "rr.",
    clientSql: "$1",
    monthSql: "$2",
  });
  const expected = await pool.query<{ avg_rate: string | null }>(
    `WITH eligible AS (
       SELECT rr.location,
              rr.service_line,
              rr.room_number,
              AVG(
                CASE WHEN rr.service_line IN ('HC', 'HC/MC')
                  THEN rr.street_rate * ${DAYS_PER_MONTH}
                  ELSE rr.street_rate
                END
              ) AS room_rate
         FROM rent_roll_data rr
         ${join}
        WHERE rr.client_id = $1
          AND rr.upload_month = $2
          AND rr.service_line = $3
          AND rr.location = $4
          AND rr.street_rate > 0
          AND ${privatePaySql("rr.payor_type")}
          AND ${baseRateExclusionSql("rr.")}
          AND ${streetRateGate()}
        GROUP BY rr.location, rr.service_line, rr.room_number
     )
     SELECT AVG(room_rate) AS avg_rate FROM eligible`,
    params,
  );
  const actual = await fetchCurrentStreetRate(scope, fixture.upload_month);
  near(
    "duplicate current rows are weighted once per physical room",
    actual,
    Number(expected.rows[0]?.avg_rate) || 0,
    0.01,
  );
}
async function assertRealPriceIncreaseUsesStreetHeadroom(clientId: string) {
  const scope = {
    clientId,
    location: "Bedford - 115",
    serviceLine: "HC",
  };
  const comparison = await fetchMixStandardizedStreetComparison(
    scope,
    "2025-01",
    "2026-08",
  );
  const current = await fetchCurrentStreetRate(scope, "2026-08");
  const priorJanuary = standardizeMatchedMovement(current, comparison);
  const plan = await calculatePlan({
    clientId,
    locationId: null,
    location: scope.location,
    serviceLine: scope.serviceLine,
    assumptions: assumptions(),
  });
  ok(
    "a real Bedford Street Rate increase consumes the January-to-January allowance",
    current > priorJanuary * (1 + assumptions().maxYoYStreetIncreasePct / 100),
    `January=${priorJanuary}, current=${current}`,
  );
  ok(
    "a real Street Rate increase is not erased by room-mix standardization",
    plan.streetIncreasePct <= EPS_PCT,
    `recommended increase=${plan.streetIncreasePct}%`,
  );
}

function assertSyntheticRoomMixArithmetic() {
  // A duplicate current row and a current room without a January match must
  // not look like price movement when matched room prices are unchanged.
  const currentAverageMonthly = (100 + 200 + 300) / 3;
  const comparison = {
    priorMatchedMonthly: (100 + 200) / 2,
    currentMatchedMonthly: (100 + 200) / 2,
  };
  near(
    "unmatched rooms and duplicate current rows do not manufacture price movement",
    standardizeMatchedMovement(currentAverageMonthly, comparison),
    currentAverageMonthly,
    0.0001,
  );

  near(
    "a real matched-room price increase remains measurable",
    standardizeMatchedMovement(200, {
      priorMatchedMonthly: 135,
      currentMatchedMonthly: 150,
    }),
    180,
    0.0001,
  );
}
/**
 * Quarter baselines are mix-standardized by dividing each historical month by
 * the CURRENT rate of the rooms that qualified in that month. That only cancels
 * composition when the qualifying rooms are the same every month — and they are
 * not, because payer scope, base-rate exclusions and the relative outlier gate
 * move rooms in and out while occupancy stays flat. When a cluster of low-rate
 * rooms drops out, the divisor jumps and the standardized series shows a rate
 * decline the rent roll never had.
 *
 * The guarantee here is on the divisor, not on any particular rate: with the
 * cohort held constant it must be flat across the comparison window. The
 * unrestricted divisor is checked too, so this stops being a test the day it
 * would pass no matter what the code did.
 */
async function assertStandardizationCohortIsStable(scope: Scope) {
  const plan = scope.prefetched;
  const unitMix = Array.from(
    plan.residents
      .reduce((map, r) => {
        const key = `${r.location ?? ""}\x1f${r.roomNumber ?? ""}`;
        if (!map.has(key)) map.set(key, r.currentRateMonthly);
        return map;
      }, new Map<string, number>())
      .entries(),
    ([key, currentRateMonthly]) => ({ key, currentRateMonthly }),
  );
  const query = {
    clientId: plan.scope.clientId,
    location: plan.scope.location ?? null,
    serviceLine: plan.scope.serviceLine,
  };
  const window = horizonQuarters(plan.assumptions.inhouseEffectiveDate)
    .map((q) => addQuarters(q, -4))
    .flatMap((q) => expectedMonths(q));
  const inWindow = new Set(window);

  const [raw, cohort] = await Promise.all([
    fetchMonthlyRealizedRates(query, "2000-01", unitMix),
    fetchCohortMonthlyRealizedRates(query, "2000-01", unitMix, window),
  ]);

  /** How far the divisor travels across the window, as a share of its mean. */
  const divisorSpreadPct = (rows: typeof raw) => {
    const divisors = rows
      .filter((m) => inWindow.has(m.month) && (m.currentMixRateMonthly ?? 0) > 0)
      .map((m) => m.currentMixRateMonthly!);
    if (divisors.length < 2) return null;
    const mean = divisors.reduce((a, b) => a + b, 0) / divisors.length;
    return ((Math.max(...divisors) - Math.min(...divisors)) / mean) * 100;
  };

  ok(
    `${scope.label}: a room cohort survives every month of the comparison window`,
    cohort.cohortRooms > 0 && cohort.cohortMonthCount > 1,
    `${cohort.cohortRooms} rooms over ${cohort.cohortMonthCount} months of ${unitMix.length} priced today`,
  );
  if (cohort.cohortRooms === 0) return;

  const cohortSpread = divisorSpreadPct(cohort.months);
  ok(
    `${scope.label}: the standardization divisor holds still once the cohort is fixed`,
    cohortSpread !== null && cohortSpread < 0.5,
    `divisor moved ${cohortSpread?.toFixed(2)}% across ${cohort.cohortMonthCount} window months`,
  );
  return divisorSpreadPct(raw);
}

async function main() {
  console.log("\n=== In-House Rate Planning — live-data guardrails ===\n");

  const clientId = await largestClient();
  if (!clientId) {
    ok("a client with occupied rent-roll rows exists", false, "no rent roll data at all");
    return;
  }
  console.log(`Client under test: ${clientId}\n`);
  assertSyntheticRoomMixArithmetic();

  // Both billing bases are REQUIRED. Each is resolved by actually building a plan,
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
  await assertProductClassifierParity(clientId);
  await assertCurrentRoomMixStreetBaseline(clientId);
  await assertDuplicateRowsUseRoomWeights(clientId);
  await assertRealPriceIncreaseUsesStreetHeadroom(clientId);

  ok(
    "a monthly service line and a daily-rate service line are plannable",
    !!monthlyScope && !!dailyScope,
    `monthly=${monthlyScope?.label ?? "none"} daily=${dailyScope?.label ?? "none"}`,
  );

  const scopes = [monthlyScope, dailyScope].filter(
    (s): s is Scope => s !== null,
  );

  console.log("\n-- Mix standardization measures price, not eligibility --");
  const rawSpreads: number[] = [];
  for (const scope of scopes) {
    const rawSpread = await assertStandardizationCohortIsStable(scope);
    if (rawSpread != null) rawSpreads.push(rawSpread);
  }
  ok(
    "the per-month qualifying set really does churn, so the fixed cohort is doing work",
    rawSpreads.some((s) => s > 0.5),
    `unrestricted divisor spreads: ${rawSpreads.map((s) => `${s.toFixed(2)}%`).join(", ") || "none measured"}`,
  );

  for (const scope of scopes) {
    console.log(`\n-- ${scope.label} --`);

    // Default operator settings: 0–8%, may not exceed street.
    const base = await runScope(scope, "default", {});
    if (!base) continue;
    ok(
      `${scope.label}: only single-occupant standard-stay base rates enter the plan`,
      base.residents.every((r) => r.rateProduct === "base" && !r.isCompanionBed),
    );
    if (scope.location == null) {
      const premiumPct =
        (base.recommendedStreetRateMonthly / base.summary.newAvgInhouseRateMonthly - 1) * 100;
      ok(
        `${scope.label}: portfolio Street Rate is at least 1% above planned in-house, or names the binding ceiling`,
        premiumPct >= 1 - EPS_PCT ||
          base.warnings.some(
            (warning) =>
              warning.includes("below the 1.0% floor") &&
              warning.includes("ceiling"),
          ),
        `premium=${premiumPct.toFixed(3)}%; warnings=${base.warnings.join(" | ")}`,
      );
    }

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
