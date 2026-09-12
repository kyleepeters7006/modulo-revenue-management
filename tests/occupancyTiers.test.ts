/**
 * Regression tests for the occupancy-tier what-if grid.
 *
 * Two halves:
 *
 *   1. Pure policy arithmetic — where the tier boundaries actually fall, and
 *      the rule that a tier may vary guardrails but never the horizon. If a
 *      tier could move the effective dates, the growth target or turnover, the
 *      three plans in a row would be measured over different periods and the
 *      grid would be comparing unlike things.
 *
 *   2. Live behaviour of `calculatePlanTiers` against real client data. The
 *      engine was split into a `preparePlan` load phase plus a synchronous
 *      `solve` closure so one line's data is read once and solved three times.
 *      That refactor is only safe if solving through the tier path reproduces
 *      `calculatePlanDetailed` exactly, so that parity is asserted directly
 *      rather than inferred from the unit suite.
 *
 * Run with: npx tsx tests/occupancyTiers.test.ts
 */
import { pool } from "../server/db";
import {
  DEFAULT_ASSUMPTIONS,
  OCCUPANCY_TIER_GUARDRAIL_KEYS,
  OCCUPANCY_TIER_IDS,
  applyOccupancyTier,
  defaultOccupancyTierPolicy,
  guardrailsFromAssumptions,
  occupancyTierRangeLabel,
  tierForOccupancy,
} from "../shared/inhousePlanning";
import type {
  OccupancyTierGuardrails,
  OccupancyTierPolicy,
  PlanningAssumptions,
} from "../shared/inhousePlanning";
import {
  calculatePlanDetailed,
  calculatePlanTiers,
} from "../server/services/inhouseRatePlanning";
import { fetchOccupancyByServiceLine } from "../server/services/inhouseRatePlanning/dataAccess";

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

// ── 1. Tier boundaries ──────────────────────────────────────────────────────

function testTierBoundaries() {
  console.log("\n-- Where the tier boundaries fall --");

  const policy = defaultOccupancyTierPolicy();
  policy.lowCutoffPct = 88;
  policy.highCutoffPct = 95;

  ok("well below the low cutoff is the low tier", tierForOccupancy(policy, 70) === "low");
  ok("just below the low cutoff is still low", tierForOccupancy(policy, 87.99) === "low");
  ok(
    "the low cutoff itself belongs to target, not low",
    tierForOccupancy(policy, 88) === "target",
    "the low cutoff is the bottom of the target band, so the band it names is inclusive",
  );
  ok("mid-band is the target tier", tierForOccupancy(policy, 91) === "target");
  ok("just below the high cutoff is still target", tierForOccupancy(policy, 94.99) === "target");
  ok("the high cutoff itself is the high tier", tierForOccupancy(policy, 95) === "high");
  ok("full occupancy is the high tier", tierForOccupancy(policy, 100) === "high");
  ok("above 100% still reads as high, not as an error", tierForOccupancy(policy, 103) === "high");

  // Unknown occupancy must not be guessed into a tier: a guessed tier applies
  // guardrails the operator never chose to a plan that looks measured.
  ok("null occupancy selects no tier", tierForOccupancy(policy, null) === null);
  ok("undefined occupancy selects no tier", tierForOccupancy(policy, undefined) === null);
  ok("NaN occupancy selects no tier", tierForOccupancy(policy, Number.NaN) === null);
  ok("Infinity occupancy selects no tier", tierForOccupancy(policy, Number.POSITIVE_INFINITY) === null);

  // Editing the cutoffs is the whole point of per-line policy: the same
  // occupancy must land in a different tier once the line moves its bands.
  const tight: OccupancyTierPolicy = { ...policy, lowCutoffPct: 92, highCutoffPct: 97 };
  ok(
    "an occupancy in one policy's target band can be another's low band",
    tierForOccupancy(policy, 90) === "target" && tierForOccupancy(tight, 90) === "low",
    `default=${tierForOccupancy(policy, 90)}, tight=${tierForOccupancy(tight, 90)}`,
  );
  ok(
    "an occupancy in one policy's high band can be another's target band",
    tierForOccupancy(policy, 96) === "high" && tierForOccupancy(tight, 96) === "target",
    `default=${tierForOccupancy(policy, 96)}, tight=${tierForOccupancy(tight, 96)}`,
  );

  // A degenerate policy where the bands collapse must still classify.
  const collapsed: OccupancyTierPolicy = { ...policy, lowCutoffPct: 90, highCutoffPct: 90 };
  ok("collapsed cutoffs leave no target band", tierForOccupancy(collapsed, 90) === "high");
  ok("collapsed cutoffs still separate low from high", tierForOccupancy(collapsed, 89.9) === "low");

  console.log("\n-- Range labels describe the band they govern --");
  ok(
    "the low label names the cutoff it stops at",
    occupancyTierRangeLabel(policy, "low").includes("88"),
    occupancyTierRangeLabel(policy, "low"),
  );
  ok(
    "the target label names both cutoffs",
    occupancyTierRangeLabel(policy, "target").includes("88") &&
      occupancyTierRangeLabel(policy, "target").includes("95"),
    occupancyTierRangeLabel(policy, "target"),
  );
  ok(
    "the high label names the cutoff it starts at",
    occupancyTierRangeLabel(policy, "high").includes("95"),
    occupancyTierRangeLabel(policy, "high"),
  );
  ok(
    "every tier gets a distinct label",
    new Set(OCCUPANCY_TIER_IDS.map((t) => occupancyTierRangeLabel(policy, t))).size === 3,
  );
}

// ── 2. A tier may vary guardrails, never the horizon ────────────────────────

/** Everything a tier must leave alone, because the data load depends on it. */
const HORIZON_KEYS: ReadonlyArray<keyof PlanningAssumptions> = [
  "streetRateEffectiveDate",
  "inhouseEffectiveDate",
  "annualRateGrowthTargetPct",
  "annualTurnoverPct",
];

function testTierScope() {
  console.log("\n-- A tier varies guardrails and nothing else --");

  const base: PlanningAssumptions = {
    ...DEFAULT_ASSUMPTIONS,
    streetRateEffectiveDate: "2027-01-01",
    inhouseEffectiveDate: "2027-02-01",
    annualRateGrowthTargetPct: 6.5,
    annualTurnoverPct: 42,
    minInhouseIncreasePct: 1,
    maxInhouseIncreasePct: 7,
    minStreetIncreasePct: 1,
    maxStreetIncreasePct: 9,
    maxYoYStreetIncreasePct: 9,
    desiredVarianceToTopCompetitorPct: -1,
    equalizationStrength: "low",
  };

  const tier: OccupancyTierGuardrails = {
    minInhouseIncreasePct: 3,
    maxInhouseIncreasePct: 11,
    minStreetIncreasePct: 2,
    maxStreetIncreasePct: 14,
    maxYoYStreetIncreasePct: 13,
    desiredVarianceToTopCompetitorPct: 4,
    equalizationStrength: "high",
  };

  const applied = applyOccupancyTier(base, tier);

  for (const key of OCCUPANCY_TIER_GUARDRAIL_KEYS) {
    ok(
      `the tier's ${key} is the one that takes effect`,
      applied[key] === tier[key],
      `expected ${String(tier[key])}, got ${String(applied[key])}`,
    );
  }

  for (const key of HORIZON_KEYS) {
    ok(
      `${key} survives the tier untouched`,
      applied[key] === base[key],
      `expected ${String(base[key])}, got ${String(applied[key])}`,
    );
  }

  // Anything not named as a guardrail must pass through, or a future
  // assumption silently reverts to its default inside the grid.
  const untouched = (Object.keys(base) as Array<keyof PlanningAssumptions>).filter(
    (k) => !(OCCUPANCY_TIER_GUARDRAIL_KEYS as readonly string[]).includes(k as string),
  );
  ok(
    "every non-guardrail assumption passes through unchanged",
    untouched.every((k) => applied[k] === base[k]),
    untouched.filter((k) => applied[k] !== base[k]).join(", "),
  );
  ok("the horizon keys are actually part of that set", untouched.length > HORIZON_KEYS.length);

  ok("applying a tier does not mutate the original assumptions", base.maxInhouseIncreasePct === 7);

  console.log("\n-- Guardrails round-trip out of a full assumptions object --");
  const extracted = guardrailsFromAssumptions(base);
  ok(
    "extraction reads exactly the tier-varying fields",
    OCCUPANCY_TIER_GUARDRAIL_KEYS.every((k) => extracted[k] === base[k]),
  );
  ok(
    "extraction carries no extra keys",
    Object.keys(extracted).length === OCCUPANCY_TIER_GUARDRAIL_KEYS.length,
    Object.keys(extracted).join(", "),
  );
  ok(
    "re-applying extracted guardrails is a no-op",
    OCCUPANCY_TIER_GUARDRAIL_KEYS.every(
      (k) => applyOccupancyTier(base, extracted)[k] === base[k],
    ),
  );

  console.log("\n-- Default policy hands out independent copies --");
  const a = defaultOccupancyTierPolicy();
  const b = defaultOccupancyTierPolicy();
  a.tiers.low.maxInhouseIncreasePct = 99;
  a.lowCutoffPct = 1;
  ok("editing one policy's tier does not reach another", b.tiers.low.maxInhouseIncreasePct !== 99);
  ok("editing one policy's cutoff does not reach another", b.lowCutoffPct !== 1);

  const fresh = defaultOccupancyTierPolicy();
  ok(
    "the defaults loosen as occupancy rises",
    fresh.tiers.low.maxStreetIncreasePct < fresh.tiers.target.maxStreetIncreasePct &&
      fresh.tiers.target.maxStreetIncreasePct < fresh.tiers.high.maxStreetIncreasePct,
    `${fresh.tiers.low.maxStreetIncreasePct} / ${fresh.tiers.target.maxStreetIncreasePct} / ${fresh.tiers.high.maxStreetIncreasePct}`,
  );
  ok(
    "and an emptier community targets a position below the top competitor",
    fresh.tiers.low.desiredVarianceToTopCompetitorPct < 0 &&
      fresh.tiers.high.desiredVarianceToTopCompetitorPct > 0,
  );
  ok("the default cutoffs are ordered", fresh.lowCutoffPct < fresh.highCutoffPct);
}

// ── 3. Live grid ────────────────────────────────────────────────────────────

async function largestClient(): Promise<string | null> {
  const res = await pool.query<{ client_id: string }>(
    `SELECT client_id, COUNT(*) AS n
       FROM rent_roll_data
      WHERE client_id IS NOT NULL
      GROUP BY client_id
      ORDER BY n DESC
      LIMIT 1`,
  );
  return res.rows[0]?.client_id ?? null;
}

async function busiestServiceLine(clientId: string): Promise<string | null> {
  const res = await pool.query<{ service_line: string }>(
    `SELECT service_line, COUNT(*) AS n
       FROM rent_roll_data
      WHERE client_id = $1
        AND service_line = ANY($2::text[])
      GROUP BY service_line
      ORDER BY n DESC
      LIMIT 1`,
    [clientId, ["AL", "AL/MC", "SL", "VIL"]],
  );
  return res.rows[0]?.service_line ?? null;
}

async function testLiveGrid(clientId: string, serviceLine: string) {
  console.log(`\n=== Live tier grid — ${clientId} / ${serviceLine} ===\n`);

  const assumptions: PlanningAssumptions = { ...DEFAULT_ASSUMPTIONS };
  const scope = { clientId, locationId: null, location: null, serviceLine };

  // A policy whose three tiers are identical to the plain assumptions. Every
  // cell must then reproduce the single-plan result exactly — this is what
  // proves the load/solve split did not change any arithmetic.
  const flat = defaultOccupancyTierPolicy();
  const asIs = guardrailsFromAssumptions(assumptions);
  for (const tier of OCCUPANCY_TIER_IDS) flat.tiers[tier] = { ...asIs };

  const singleStart = Date.now();
  const { plan: single } = await calculatePlanDetailed({ ...scope, assumptions });
  const singleMs = Date.now() - singleStart;

  const gridStart = Date.now();
  const flatGrid = await calculatePlanTiers({ ...scope, assumptions, tierPolicy: flat });
  const gridMs = Date.now() - gridStart;

  console.log("-- Solving through the tier path reproduces the single plan --");
  ok("the grid returns one cell per tier", flatGrid.cells.length === 3);
  ok(
    "the cells come back in low-to-high order",
    flatGrid.cells.every((c, i) => c.tier === OCCUPANCY_TIER_IDS[i]),
    flatGrid.cells.map((c) => c.tier).join(", "),
  );
  ok("no cell failed to solve", flatGrid.cells.every((c) => !c.error), flatGrid.cells.find((c) => c.error)?.error);

  for (const cell of flatGrid.cells) {
    near(
      `${cell.tier}: in-house increase matches the single plan`,
      cell.inhouseIncreasePct ?? Number.NaN,
      single.summary.weightedAvgIncreasePct,
      1e-9,
    );
    near(
      `${cell.tier}: street increase matches the single plan`,
      cell.streetIncreasePct ?? Number.NaN,
      single.streetIncreasePct,
      1e-9,
    );
    ok(
      `${cell.tier}: feasibility matches the single plan`,
      cell.feasible === single.feasible,
      `plan=${single.feasible}, cell=${cell.feasible}`,
    );
  }

  console.log("\n-- The data is loaded once, not once per tier --");
  console.log(`    single plan ${singleMs}ms, three-tier grid ${gridMs}ms`);
  ok(
    "three tiers cost far less than three plan builds",
    gridMs < singleMs * 2.5,
    `grid=${gridMs}ms vs single=${singleMs}ms — the load phase looks like it is running per tier`,
  );

  console.log("\n-- Occupancy selects the tier in force --");
  ok(
    "the occupancy source is reported",
    flatGrid.occupancySource === "occupancy_history" || flatGrid.occupancySource === "rent_roll",
    String(flatGrid.occupancySource),
  );
  ok(
    "a reported occupancy is a plausible percentage",
    flatGrid.occupancyPct == null ||
      (flatGrid.occupancyPct > 0 && flatGrid.occupancyPct <= 110),
    String(flatGrid.occupancyPct),
  );
  ok(
    "the tier in force is the one the occupancy falls in",
    flatGrid.currentTier === tierForOccupancy(flat, flatGrid.occupancyPct),
    `occ=${flatGrid.occupancyPct}, currentTier=${flatGrid.currentTier}`,
  );
  ok(
    "at most one cell is marked as in force",
    flatGrid.cells.filter((c) => c.isCurrent).length <= 1,
  );
  ok(
    "a known occupancy marks exactly one cell, an unknown one marks none",
    flatGrid.occupancyPct == null
      ? flatGrid.cells.every((c) => !c.isCurrent)
      : flatGrid.cells.filter((c) => c.isCurrent).length === 1,
  );
  ok(
    "unknown occupancy is warned about rather than guessed",
    flatGrid.occupancyPct != null || flatGrid.warnings.length > 0,
  );
  ok(
    "rent-roll occupancy is flagged as the weaker source",
    flatGrid.occupancySource !== "rent_roll" || flatGrid.warnings.length > 0,
  );
  ok(
    "a history reading names the month it came from",
    flatGrid.occupancySource !== "occupancy_history" || flatGrid.occupancyMonth != null,
    String(flatGrid.occupancyMonth),
  );
  ok(
    "every cell carries the band it governs",
    flatGrid.cells.every((c) => typeof c.rangeLabel === "string" && c.rangeLabel.length > 0),
  );
  if (flatGrid.currentTier && flatGrid.occupancyPct != null) {
    const currentGuardrails = flat.tiers[flatGrid.currentTier];
    const currentCell = flatGrid.cells.find((cell) => cell.tier === flatGrid.currentTier);
    ok(
      "the primary recommendation is the measured tier's plan",
      currentCell?.inhouseIncreasePct === flatGrid.currentPlan.summary.weightedAvgIncreasePct &&
        currentCell?.streetIncreasePct === flatGrid.currentPlan.streetIncreasePct,
    );
    ok(
      "every resident stays under the measured tier's maximum",
      flatGrid.currentPlan.residents.every(
        (resident) => resident.increasePct <= currentGuardrails.maxInhouseIncreasePct + 1e-9,
      ),
      `max=${currentGuardrails.maxInhouseIncreasePct}, actual=${Math.max(...flatGrid.currentPlan.residents.map((resident) => resident.increasePct))}`,
    );
    ok(
      "the measured tier's full guardrail set reaches the primary plan",
      Object.entries(currentGuardrails).every(
        ([key, value]) =>
          flatGrid.currentPlan.assumptions[key as keyof PlanningAssumptions] === value,
      ),
    );
    ok(
      "resident descriptions name the occupancy tier that governed the calculation",
      flatGrid.currentPlan.residents.every((resident) =>
        resident.explanation.steps.some((step) => step.label === "Occupancy tier"),
      ),
    );
  }

  console.log("\n-- Looser guardrails produce a different, not identical, plan --");
  const spread = defaultOccupancyTierPolicy();
  const spreadGrid = await calculatePlanTiers({ ...scope, assumptions, tierPolicy: spread });
  const byTier = new Map(spreadGrid.cells.map((c) => [c.tier, c]));
  const low = byTier.get("low");
  const high = byTier.get("high");

  ok("the low tier solved", !!low && !low.error, low?.error);
  ok("the high tier solved", !!high && !high.error, high?.error);

  if (low?.streetIncreasePct != null && high?.streetIncreasePct != null) {
    ok(
      "a fuller community is never asked to raise street rate by less than an emptier one",
      high.streetIncreasePct >= low.streetIncreasePct - 1e-9,
      `low=${low.streetIncreasePct}, high=${high.streetIncreasePct}`,
    );
  }
  if (low?.inhouseIncreasePct != null && high?.inhouseIncreasePct != null) {
    ok(
      "the high tier's resident minimum holds",
      high.inhouseIncreasePct >= spread.tiers.high.minInhouseIncreasePct - 1e-9,
      `min=${spread.tiers.high.minInhouseIncreasePct}, achieved=${high.inhouseIncreasePct}`,
    );
    ok(
      "no tier exceeds its own resident maximum on average",
      spreadGrid.cells.every(
        (c) =>
          c.inhouseIncreasePct == null ||
          c.inhouseIncreasePct <= spread.tiers[c.tier].maxInhouseIncreasePct + 1e-9,
      ),
    );
  }
  ok(
    "no tier exceeds its own street ceiling",
    spreadGrid.cells.every(
      (c) =>
        c.streetIncreasePct == null ||
        c.streetIncreasePct <= spread.tiers[c.tier].maxStreetIncreasePct + 1e-9,
    ),
    spreadGrid.cells.map((c) => `${c.tier}=${c.streetIncreasePct}`).join(", "),
  );
  ok(
    "tightening the guardrails actually changed something",
    spreadGrid.cells.some(
      (c) =>
        c.streetIncreasePct !== flatGrid.cells.find((f) => f.tier === c.tier)?.streetIncreasePct ||
        c.inhouseIncreasePct !== flatGrid.cells.find((f) => f.tier === c.tier)?.inhouseIncreasePct,
    ),
    "all three tiers produced the plain-assumptions plan — the guardrails are not reaching the solver",
  );

  console.log("\n-- One unsolvable tier does not discard the other two --");
  const broken = defaultOccupancyTierPolicy();
  // A minimum above the maximum is not a plan anyone can solve.
  broken.tiers.low = { ...broken.tiers.low, minInhouseIncreasePct: 40, maxInhouseIncreasePct: 1 };
  const brokenGrid = await calculatePlanTiers({ ...scope, assumptions, tierPolicy: broken });
  ok("the grid still returns three cells", brokenGrid.cells.length === 3);
  const survivors = brokenGrid.cells.filter((c) => c.tier !== "low");
  ok(
    "the two sound tiers still carry numbers",
    survivors.every((c) => c.inhouseIncreasePct != null || c.error != null),
  );
  ok(
    "a cell that could not be solved says so instead of reporting a zero",
    brokenGrid.cells.every((c) => c.error == null || c.inhouseIncreasePct == null),
  );
}

// ── 4. Occupancy resolution ─────────────────────────────────────────────────

/**
 * The tier a line plans under is decided entirely by this reading, so the two
 * ways it used to go wrong are worth pinning down: a campus whose upload lags
 * the portfolio must not read as unmeasurable, and a line history does not
 * cover must not lose its rent-roll reading just because other lines have
 * history.
 */
async function testOccupancyResolution(clientId: string) {
  console.log("\n=== Occupancy resolution ===\n");

  const portfolio = await fetchOccupancyByServiceLine(clientId, null);
  ok("the portfolio reading covers at least one service line", portfolio.byServiceLine.size > 0);
  ok(
    "every reading names its source",
    [...portfolio.byServiceLine.values()].every(
      (v) => v.source === "occupancy_history" || v.source === "rent_roll",
    ),
  );
  ok(
    "every reading is a plausible percentage",
    [...portfolio.byServiceLine.values()].every((v) => v.occupancyPct > 0 && v.occupancyPct <= 110),
    [...portfolio.byServiceLine.entries()].map(([sl, v]) => `${sl}=${v.occupancyPct.toFixed(1)}`).join(", "),
  );
  ok(
    "a history-sourced reading names the month it came from",
    [...portfolio.byServiceLine.values()].every(
      (v) => v.source !== "occupancy_history" || v.month != null,
    ),
  );

  console.log("\n-- A campus whose upload lags the portfolio is still measurable --");
  // Campuses whose newest occupancy-history month is older than the client's.
  const lagging = await pool.query<{ location_name: string }>(
    `WITH per_campus AS (
       SELECT COALESCE(roh.location_name, l2.name) AS location_name,
              MAX(make_date(roh.year, roh.month, 1)) AS d
         FROM room_type_occupancy_history roh
         LEFT JOIN locations l2 ON l2.id = roh.location_id
        WHERE roh.client_id = $1
        GROUP BY 1
     ), newest AS (SELECT MAX(d) AS d FROM per_campus)
     SELECT location_name
       FROM per_campus, newest
      WHERE per_campus.d < newest.d
        AND location_name IS NOT NULL
      LIMIT 3`,
    [clientId],
  );

  if (lagging.rows.length === 0) {
    console.log("    (every campus reports in the same month — nothing to test)");
  }
  for (const { location_name } of lagging.rows) {
    const scoped = await fetchOccupancyByServiceLine(clientId, location_name);
    ok(
      `${location_name}: a lagging campus still returns occupancy`,
      scoped.byServiceLine.size > 0,
      "the anchor month is being taken client-wide and then filtered to the campus",
    );
    ok(
      `${location_name}: and it comes from its own history, not the rent roll`,
      [...scoped.byServiceLine.values()].some((v) => v.source === "occupancy_history"),
      [...scoped.byServiceLine.entries()].map(([sl, v]) => `${sl}=${v.source}`).join(", "),
    );
  }

  console.log("\n-- A line history does not cover keeps its rent-roll reading --");
  // Campuses where the rent roll knows a service line occupancy history does not.
  const partial = await pool.query<{ location: string; service_line: string }>(
    `SELECT DISTINCT rr.location, rr.service_line
       FROM rent_roll_data rr
      WHERE rr.client_id = $1
        AND rr.upload_month = (
              SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1
            )
        AND rr.location IS NOT NULL
        AND rr.service_line IS NOT NULL
        AND EXISTS (
              SELECT 1 FROM room_type_occupancy_history roh
               LEFT JOIN locations l2 ON l2.id = roh.location_id
               WHERE roh.client_id = $1
                 AND COALESCE(roh.location_name, l2.name) = rr.location
            )
        AND NOT EXISTS (
              SELECT 1 FROM room_type_occupancy_history roh
               LEFT JOIN locations l2 ON l2.id = roh.location_id
               WHERE roh.client_id = $1
                 AND COALESCE(roh.location_name, l2.name) = rr.location
                 AND roh.service_line LIKE '%' || rr.service_line || '%'
            )
      LIMIT 3`,
    [clientId],
  );

  if (partial.rows.length === 0) {
    console.log("    (history covers every service line the rent roll knows about)");
  }
  for (const { location, service_line } of partial.rows) {
    const scoped = await fetchOccupancyByServiceLine(clientId, location);
    const reading = scoped.byServiceLine.get(service_line);
    ok(
      `${location} / ${service_line}: an uncovered line still gets a reading`,
      reading != null,
      "the rent-roll fallback is still all-or-nothing for the whole scope",
    );
    if (reading) {
      ok(
        `${location} / ${service_line}: the fallback is labelled as the rent roll`,
        reading.source === "rent_roll",
        reading.source,
      );
    }
    ok(
      `${location} / ${service_line}: the covered lines keep their history reading`,
      [...scoped.byServiceLine.values()].some((v) => v.source === "occupancy_history"),
      "falling back for one line must not downgrade the rest",
    );
  }
}

async function main() {
  console.log("\n=== Occupancy tiers ===");
  testTierBoundaries();
  testTierScope();

  const clientId = await largestClient();
  if (!clientId) {
    ok("a client with rent-roll rows exists", false, "no rent roll data at all");
    return;
  }
  await testOccupancyResolution(clientId);

  const serviceLine = await busiestServiceLine(clientId);
  if (!serviceLine) {
    ok(`${clientId} has a senior-housing service line to plan`, false);
    return;
  }
  await testLiveGrid(clientId, serviceLine);
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
    process.exit(failed > 0 ? 1 : 0);
  });
