/**
 * Regression tests for the in-house rate planning solver.
 *
 * The solver has no database dependency by design, so every case here is a
 * synthetic population with hand-checkable arithmetic. What is being guarded:
 *
 *   • turnover really moves the projection (0% vs 60% must differ)
 *   • min == max degenerates to a flat increase for everyone
 *   • Street Rate aims at the growth target without replacing the configured
 *     minimum, while competitive requirements may call for more
 *   • Street Rate shapes allocation but never caps an in-house increase
 *   • an unreachable target is reported as unreachable, with a named binding
 *     constraint and a concrete minimum change — never as a plan
 *   • effective dates are weighted by the part of the quarter they cover
 *   • whichever quarter has the least cushion is the one that binds, whether
 *     that is the first or the last
 *   • the resident-level allocation reconciles back to the required aggregate
 *
 * Run with: npx tsx tests/inhouseRatePlanning.test.ts
 */
import type {
  BaselineQuarter,
  PlanningAssumptions,
  PlanningResident,
} from "../shared/inhousePlanning";
import {
  DEFAULT_ASSUMPTIONS,
  planAssumptionsMatch,
  selectSubmittablePlans,
} from "../shared/inhousePlanning";
import {
  allocateIncreases,
  projectMonthlyRealizedRates,
  projectQuarterlyRealizedRates,
  residentDayWeightedAverageRate,
  solvePlan,
} from "../server/services/inhouseRatePlanning/solver";
import {
  addQuarters,
  isoToMs,
  makeQuarterRef,
  quarterStartMs,
} from "../server/services/inhouseRatePlanning/dates";
import {
  buildResidents,
  makeProductStreetResolver,
  projectMissingQuarters,
  realizedRateWeightBasis,
  type ProductStreetBaselines,
  type RawResidentRow,
} from "../server/services/inhouseRatePlanning/dataAccess";
import {
  assignStrata,
  compareQuarters,
  type CoverageThresholds,
  type RoomQuarterObservation,
} from "../server/services/inhouseRatePlanning/twoPointIndex";
import { classifyRateProduct } from "../shared/rateProduct";

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

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Horizon: the four quarters of 2027. */
const QUARTERS = [1, 2, 3, 4].map((q) => makeQuarterRef(2027, q));
const ANCHOR_MS = isoToMs("2026-12-01");

function resident(
  id: string,
  currentRate: number,
  streetRate: number,
  weight = 90,
  serviceLine = "AL",
): PlanningResident {
  return {
    key: id,
    location: "Test Campus",
    serviceLine,
    roomNumber: id,
    roomType: "Studio",
    careLevel: null,
    payorType: "PRIVATE PAY",
    moveInDate: "2024-01-01",
    currentRateMonthly: currentRate,
    streetRateMonthly: streetRate,
    isCompanionBed: false,
    weight,
  };
}

function assumptions(overrides: Partial<PlanningAssumptions> = {}): PlanningAssumptions {
  return {
    ...DEFAULT_ASSUMPTIONS,
    rateGrowthTargetPct: 5,
    streetRateEffectiveDate: "2027-01-01",
    inhouseEffectiveDate: "2027-01-01",
    annualTurnoverPct: 30,
    minInhouseIncreasePct: 0,
    maxInhouseIncreasePct: 8,
    equalizationStrength: "medium",
    allowInhouseAboveStreet: true,
    maxStreetIncreasePct: 15,
    maxYoYStreetIncreasePct: 15,
    ...overrides,
  };
}

console.log("\n-- 6b. January-to-January maximum includes street increases already taken --");
{
  const result = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({
      rateGrowthTargetPct: 12,
      maxStreetIncreasePct: 20,
      maxYoYStreetIncreasePct: 10,
    }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5400,
    priorJanuaryStreetRateMonthly: 5000,
  });
  near(
    "proposed January street rate cannot exceed 10% over prior January",
    result.recommendedStreetMonthly,
    5500,
    0.01,
  );
  ok(
    "the cap leaves only the unused portion of the YoY allowance",
    result.streetIncrease * 100 <= (5500 / 5400 - 1) * 100 + 1e-6,
  );
  ok(
    "the street cap does not replace the resident maximum",
    result.allocation.allocations.every((a) => a.increase <= 0.08 + 1e-9),
  );
}

/** Flat prior-year baseline for every horizon quarter. */
function flatBaseline(rate: number): Map<string, BaselineQuarter> {
  const m = new Map<string, BaselineQuarter>();
  for (const q of QUARTERS) {
    const prior = addQuarters(q, -4);
    m.set(q.label, {
      ...prior,
      realizedRateMonthly: rate,
      basis: "actual",
      monthsAvailable: 3,
      monthsExpected: 3,
      residentDays: 9000,
    });
  }
  return m;
}

/** A population well below street, so headroom is never the limit. */
function roomyPopulation(): PlanningResident[] {
  return [
    resident("A", 4000, 5000),
    resident("B", 4200, 5000),
    resident("C", 4400, 5000),
    resident("D", 4600, 5000),
  ];
}

console.log("\n=== In-House Rate Planning Solver ===\n");

console.log("-- Rate basis uses months for senior housing and days for health care --");
ok("AL uses resident-month weighting", realizedRateWeightBasis("AL") === "resident_months");
ok("AL/MC uses resident-month weighting", realizedRateWeightBasis("AL/MC") === "resident_months");
ok("SL uses resident-month weighting", realizedRateWeightBasis("SL") === "resident_months");
ok("VIL uses resident-month weighting", realizedRateWeightBasis("VIL") === "resident_months");
ok("HC uses resident-day weighting", realizedRateWeightBasis("HC") === "resident_days");
ok("HC/MC uses resident-day weighting", realizedRateWeightBasis("HC/MC") === "resident_days");
{
  const q1 = makeQuarterRef(2027, 1);
  const common = {
    anchorMs: isoToMs("2027-01-01"),
    quarters: [q1],
    existingAvgRateMonthly: 100,
    postIncreaseAvgRateMonthly: 200,
    inhouseEffectiveMs: isoToMs("2027-02-01"),
    currentStreetMonthly: 100,
    newStreetMonthly: 100,
    streetEffectiveMs: isoToMs("2027-01-01"),
    annualTurnover: 0,
  };
  const monthly = projectQuarterlyRealizedRates({
    ...common,
    weightBasis: "resident_months",
  }).get(q1.label) ?? 0;
  const daily = projectQuarterlyRealizedRates({
    ...common,
    weightBasis: "resident_days",
  }).get(q1.label) ?? 0;
  near("monthly rates give January, February, and March equal quarter weight", monthly, 500 / 3, 0.0001);
  ok("daily rates still reflect different calendar-day counts", Math.abs(daily - monthly) > 0.5);
}

// ── 0. Missing-quarter projection anchors on latest complete quarter ────────
console.log("-- 0. Missing-quarter projection uses chronological quarter order --");
{
  const q1 = makeQuarterRef(2026, 1);
  const q2 = makeQuarterRef(2026, 2);
  const q4 = makeQuarterRef(2026, 4);
  const known = new Map<string, BaselineQuarter>([
    [q1.label, {
      ...q1,
      realizedRateMonthly: 100,
      basis: "actual",
      monthsAvailable: 3,
      monthsExpected: 3,
      residentDays: 9000,
    }],
    [q2.label, {
      ...q2,
      realizedRateMonthly: 110,
      basis: "actual",
      monthsAvailable: 3,
      monthsExpected: 3,
      residentDays: 9000,
    }],
  ]);
  const result = projectMissingQuarters(known, [q4]);
  near(
    "Q4 projects forward from Q2 using the observed chronological trend",
    result.baselines.get(q4.label)?.realizedRateMonthly ?? 0,
    133.1,
    0.0001,
  );

  const q3 = makeQuarterRef(2026, 3);
  known.set(q3.label, {
    ...q3,
    realizedRateMonthly: 110.2,
    basis: "partial",
    monthsAvailable: 2,
    monthsExpected: 3,
    availableMonths: ["2026-07", "2026-08"],
    residentDays: 6000,
  });
  const withPartialQ3 = projectMissingQuarters(known, [q4]);
  near(
    "Q4 continues the latest Q2-to-partial-Q3 trajectory instead of jumping from an old trend",
    withPartialQ3.baselines.get(q4.label)?.realizedRateMonthly ?? 0,
    110.4003636364,
    0.0001,
  );
}

// ── 1. Zero turnover ───────────────────────────────────────────────────────
console.log("-- 1. Zero turnover: only the in-house increase moves the rate --");
{
  const projected = projectQuarterlyRealizedRates({
    anchorMs: ANCHOR_MS,
    quarters: QUARTERS,
    existingAvgRateMonthly: 4000,
    postIncreaseAvgRateMonthly: 4200,
    inhouseEffectiveMs: isoToMs("2027-01-01"),
    currentStreetMonthly: 6000,
    newStreetMonthly: 6600,
    streetEffectiveMs: isoToMs("2027-01-01"),
    annualTurnover: 0,
  });
  near("Q1 2027 equals the post-increase rate exactly", projected.get("Q1 2027")!, 4200, 0.01);
  near("Q4 2027 equals the post-increase rate exactly", projected.get("Q4 2027")!, 4200, 0.01);
  ok(
    "no drift toward street with nobody moving out",
    Math.abs(projected.get("Q4 2027")! - projected.get("Q1 2027")!) < 0.01,
  );
}

// ── 2. High turnover ───────────────────────────────────────────────────────
console.log("\n-- 2. High turnover: replacements pull the realized rate toward street --");
{
  const base = {
    anchorMs: ANCHOR_MS,
    quarters: QUARTERS,
    existingAvgRateMonthly: 4000,
    postIncreaseAvgRateMonthly: 4200,
    inhouseEffectiveMs: isoToMs("2027-01-01"),
    currentStreetMonthly: 6000,
    newStreetMonthly: 6600,
    streetEffectiveMs: isoToMs("2027-01-01"),
  };
  const low = projectQuarterlyRealizedRates({ ...base, annualTurnover: 0.05 });
  const high = projectQuarterlyRealizedRates({ ...base, annualTurnover: 0.6 });
  ok(
    "60% turnover projects a higher Q4 rate than 5% turnover",
    high.get("Q4 2027")! > low.get("Q4 2027")! + 100,
    `high=${high.get("Q4 2027")!.toFixed(0)} low=${low.get("Q4 2027")!.toFixed(0)}`,
  );
  ok(
    "the rate climbs quarter over quarter as the cohort turns over",
    high.get("Q4 2027")! > high.get("Q1 2027")!,
  );
  ok(
    "and never passes the street rate it is converging on",
    high.get("Q4 2027")! < 6600,
  );
}

// ── 3. Minimum equals maximum ──────────────────────────────────────────────
console.log("\n-- 3. Minimum equals maximum: everyone with headroom gets the same increase --");
{
  const result = allocateIncreases({
    residents: roomyPopulation(),
    targetAvgIncrease: 0.02, // deliberately below the forced floor
    minIncrease: 0.05,
    maxIncrease: 0.05,
    strength: "high",
    allowAboveStreet: false,
    streetMultiplier: 1,
  });
  ok(
    "every resident lands on exactly 5%",
    result.allocations.every((a) => Math.abs(a.increase - 0.05) < 1e-9),
  );
  near("achieved average is 5%", result.achievedAvgIncrease * 100, 5, 1e-6);
  ok("the requested average was reported as clipped", result.clipped);
}

// ── 4. Resident already AT street ──────────────────────────────────────────
console.log("\n-- 4. A resident exactly at street may still receive an increase --");
{
  const result = allocateIncreases({
    residents: [resident("AT", 5000, 5000), resident("BELOW", 4000, 5000)],
    targetAvgIncrease: 0.05,
    minIncrease: 0.01,
    maxIncrease: 0.1,
    strength: "medium",
    allowAboveStreet: false, // legacy input is intentionally ignored
    streetMultiplier: 1,
  });
  const at = result.allocations.find((a) => a.resident.key === "AT")!;
  const below = result.allocations.find((a) => a.resident.key === "BELOW")!;
  ok("the at-street resident receives at least the configured minimum", at.increase >= 0.01);
  ok("the at-street resident is not classified as blocked", at.constraint !== "at_or_above_street");
  ok("the below-street resident still gets an increase", below.increase > 0);
  near("the mixed cohort still reaches the requested weighted average", result.achievedAvgIncrease, 0.05, 1e-9);
}

// ── 5. Resident ABOVE street ───────────────────────────────────────────────
console.log("\n-- 5. A resident above street may still receive an increase --");
{
  const result = allocateIncreases({
    residents: [resident("ABOVE", 5400, 5000), resident("BELOW", 4000, 5000)],
    targetAvgIncrease: 0.05,
    minIncrease: 0.02,
    maxIncrease: 0.1,
    strength: "medium",
    allowAboveStreet: false, // legacy input is intentionally ignored
    streetMultiplier: 1,
  });
  const above = result.allocations.find((a) => a.resident.key === "ABOVE")!;
  ok("the above-street resident receives an increase", above.increase > 0);
  ok("never a negative increase — planning does not cut rates", above.increase >= 0);
  ok("not labelled as blocked by street", above.constraint !== "at_or_above_street");

  const allowed = allocateIncreases({
    residents: [resident("ABOVE", 5400, 5000)],
    targetAvgIncrease: 0.05,
    minIncrease: 0.02,
    maxIncrease: 0.1,
    strength: "medium",
    allowAboveStreet: true,
    streetMultiplier: 1,
  });
  near(
    "legacy allow-above-street setting no longer changes the result",
    allowed.allocations[0].increase,
    0.05,
    1e-9,
  );
}

// ── 6. Achievable target ───────────────────────────────────────────────────
console.log("\n-- 6. An achievable target is balanced across Street and in-house rates --");
{
  const result = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({ rateGrowthTargetPct: 5 }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    enforcePortfolioStreetPremium: true,
  });
  ok("plan is feasible", result.feasible);
  ok(
    "the in-house lever carries at least the growth objective",
    result.requiredAvgIncrease * 100 >= 5 - 0.01,
  );
  ok(
    "Street Rate is not pushed past the objective to do in-house's work",
    result.streetIncrease * 100 <= 5 + 0.01,
  );
  ok(
    "the recommended Street Rate still clears the planned in-house average by 1%",
    result.recommendedStreetMonthly >= result.postIncreaseAvgRateMonthly * 1.01 - 0.01,
  );
  ok("every quarter passes", result.quarterResults.every((q) => q.passes));
  ok("no infeasibility block", result.infeasibility === null);
  ok(
    "the required increase is within the configured maximum",
    result.requiredAvgIncrease * 100 <= 8 + 1e-6,
  );
}

// ── 6a. Street Rate must stay above the in-house average ───────────────────
console.log("\n-- 6a. Street Rate keeps a 1% premium over the planned in-house average --");
{
  // These residents already pay within a whisker of the asking rate, so the
  // in-house increase would otherwise carry the average past it.
  const atStreet = solvePlan({
    residents: [
      resident("A", 4950, 5000),
      resident("B", 4980, 5000),
      resident("C", 5000, 5000),
      resident("D", 5020, 5000),
    ],
    assumptions: assumptions({ rateGrowthTargetPct: 5, minStreetIncreasePct: 0 }),
    baselineByQuarter: flatBaseline(4800),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    enforcePortfolioStreetPremium: true,
  });
  const plannedInhouse = atStreet.postIncreaseAvgRateMonthly;
  ok(
    "the asking rate is lifted above the residents it would otherwise sit under",
    atStreet.recommendedStreetMonthly >= plannedInhouse * 1.01 - 0.01,
  );
  near(
    "the portfolio service-line premium reaches 1%",
    (atStreet.recommendedStreetMonthly / plannedInhouse - 1) * 100,
    1,
    0.001,
  );

  const local = solvePlan({
    residents: [
      resident("A", 4950, 5000),
      resident("B", 4980, 5000),
      resident("C", 5000, 5000),
      resident("D", 5020, 5000),
    ],
    assumptions: assumptions({ rateGrowthTargetPct: 5, minStreetIncreasePct: 0 }),
    baselineByQuarter: flatBaseline(4800),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    enforcePortfolioStreetPremium: false,
  });
  ok(
    "a location-level plan is not pushed up merely to clear its own in-house average",
    local.streetIncrease < atStreet.streetIncrease - 1e-6,
  );

  // With the Street Rate ceiling at zero the premium cannot be honored, and
  // that has to be reported rather than quietly ignored.
  const capped = solvePlan({
    residents: [resident("A", 5000, 5000), resident("B", 5100, 5000)],
    assumptions: assumptions({
      rateGrowthTargetPct: 5,
      maxStreetIncreasePct: 0,
      maxYoYStreetIncreasePct: 0,
    }),
    baselineByQuarter: flatBaseline(4800),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    enforcePortfolioStreetPremium: true,
  });
  near("the ceiling holds Street Rate flat", capped.streetIncrease * 100, 0, 1e-9);
  ok(
    "the hard ceiling still wins when the portfolio premium cannot be reached",
    capped.recommendedStreetMonthly < capped.postIncreaseAvgRateMonthly * 1.01,
  );
}

console.log("\n-- 6c. Calculate Plan combines competitive and minimum Street Rate inputs --");
{
  const minimum = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({
      rateGrowthTargetPct: 2,
      minStreetIncreasePct: 4,
      desiredVarianceToTopCompetitorPct: 0,
    }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    topCompetitorRateMonthly: null,
  });
  near("minimum Street Rate increase is honored", minimum.streetIncrease * 100, 4, 0.01);

  const competitive = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({
      rateGrowthTargetPct: 2,
      minStreetIncreasePct: 0,
      desiredVarianceToTopCompetitorPct: -2,
    }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    topCompetitorRateMonthly: 5500,
  });
  ok(
    "a scope below its desired Top Competitor position moves toward that position",
    competitive.streetIncrease > 0,
  );
  ok(
    "but competitive position cannot push Street Rate past the growth objective",
    competitive.streetIncrease * 100 <= 2 + 0.01,
  );

  // In-house is capped hard, so Street Rate has to carry the objective here.
  const aboveDesired = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({
      rateGrowthTargetPct: 6,
      maxInhouseIncreasePct: 1.5,
      desiredVarianceToTopCompetitorPct: -5,
    }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    topCompetitorRateMonthly: 5000,
  });
  ok(
    "Street Rate still rises when a capped in-house lever cannot reach the objective",
    aboveDesired.streetIncrease * 100 > 6,
  );
  ok("resident increases remain within their configured cap", aboveDesired.requiredAvgIncrease * 100 <= 1.5 + 0.01);

  const noBenchmark = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({
      rateGrowthTargetPct: 3,
      desiredVarianceToTopCompetitorPct: 10,
    }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
    topCompetitorRateMonthly: null,
  });
  near(
    "missing Top Competitor leaves Street Rate on its configured minimum",
    noBenchmark.streetIncrease * 100,
    0,
    0.01,
  );
  ok(
    "and the plan still clears every quarter from in-house increases",
    noBenchmark.feasible && noBenchmark.quarterResults.every((q) => q.passes),
  );
}

// ── 6d. Variance to Top Competitor decides which lever carries the growth ───
console.log("\n-- 6d. Variance to Top Competitor decides Street vs in-house --");
{
  const solveAtVariance = (desiredVarianceToTopCompetitorPct: number) =>
    solvePlan({
      residents: roomyPopulation(),
      assumptions: assumptions({
        rateGrowthTargetPct: 5,
        minStreetIncreasePct: 0,
        desiredVarianceToTopCompetitorPct,
      }),
      baselineByQuarter: flatBaseline(4200),
      quarters: QUARTERS,
      anchorMs: ANCHOR_MS,
      currentStreetRateMonthly: 5000,
      topCompetitorRateMonthly: 5200,
    });

  // Asking rate sits above the desired competitor position, so only the growth
  // preferred growth target moves Street Rate.
  const wellAbove = solveAtVariance(-40);
  // The operator wants to be well above the top competitor, so the asking rate
  // has competitive room and is the lever that moves first.
  const wellBelow = solveAtVariance(40);

  ok(
    "no competitive room leaves Street Rate on its floor",
    wellAbove.streetIncrease * 100 < 1,
  );
  ok(
    "competitive room pulls Street Rate up",
    wellBelow.streetIncrease > wellAbove.streetIncrease + 1e-6,
  );
  ok(
    "but never past the growth objective",
    wellBelow.streetIncrease * 100 <= 5 + 0.01,
  );
  ok(
    "the in-house lever carries the objective in both directions",
    wellAbove.requiredAvgIncrease * 100 >= 5 - 0.01 &&
      wellBelow.requiredAvgIncrease * 100 >= 5 - 0.01,
  );
  ok(
    "both directions still clear every quarter",
    wellAbove.quarterResults.every((q) => q.passes) &&
      wellBelow.quarterResults.every((q) => q.passes),
  );
}

// ── 7. Impossible because the maximum increase is too low ──────────────────
console.log("\n-- 7. An unreachable target is reported, not silently approximated --");
{
  const result = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({ rateGrowthTargetPct: 20, maxInhouseIncreasePct: 1 }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
  });
  ok("plan is reported infeasible", !result.feasible);
  ok("an infeasibility block is returned", result.infeasibility !== null);
  ok(
    "the binding constraint is the maximum increase",
    result.infeasibility?.bindingConstraint === "max_increase",
    `got ${result.infeasibility?.bindingConstraint}`,
  );
  ok(
    "no resident exceeds the 1% maximum despite the plan falling short",
    result.allocation.allocations.every((a) => a.increase <= 0.01 + 1e-9),
  );
  ok(
    "a concrete larger maximum is suggested",
    (result.infeasibility?.minimumChange.maxInhouseIncreasePct ?? 0) > 1,
    `got ${result.infeasibility?.minimumChange.maxInhouseIncreasePct}`,
  );
  ok(
    "the achievable growth is reported and is below the target",
    (result.infeasibility?.minimumChange.achievableGrowthTargetPct ?? 100) < 20,
  );
}

// ── 7b. Impossible because the configured resident maximum is too low ──────
console.log("\n-- 7b. Street position does not replace the resident maximum --");
{
  const atStreet = [
    resident("A", 5000, 5000),
    resident("B", 5100, 5000),
    resident("C", 5000, 5000),
  ];
  const result = solvePlan({
    residents: atStreet,
    assumptions: assumptions({ rateGrowthTargetPct: 12, maxStreetIncreasePct: 0 }),
    baselineByQuarter: flatBaseline(5000),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
  });
  ok("plan is infeasible", !result.feasible);
  ok(
    "the binding constraint is the resident maximum, not Street Rate",
    result.infeasibility?.bindingConstraint === "max_increase",
    `got ${result.infeasibility?.bindingConstraint}`,
  );
  ok(
    "a street increase is offered as the way out",
    (result.infeasibility?.minimumChange.streetIncreasePct ?? 0) > 0,
  );
}

// ── 7c. Mixed service-line submission ─────────────────────────────────────
console.log("\n-- 7c. One infeasible service line does not block a valid submission --");
{
  const feasibleAssumptions = assumptions({ rateGrowthTargetPct: 5 });
  const infeasibleAssumptions = assumptions({
    rateGrowthTargetPct: 20,
    maxInhouseIncreasePct: 1,
  });
  const common = {
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
  };
  const calculated = [
    {
      sl: "AL",
      plan: {
        ...solvePlan({
          ...common,
          residents: roomyPopulation().map((r) => ({ ...r, serviceLine: "AL" })),
          assumptions: feasibleAssumptions,
        }),
        assumptions: feasibleAssumptions,
      },
    },
    {
      sl: "MC",
      plan: {
        ...solvePlan({
          ...common,
          residents: roomyPopulation().map((r) => ({ ...r, serviceLine: "MC" })),
          assumptions: infeasibleAssumptions,
        }),
        assumptions: infeasibleAssumptions,
      },
    },
  ];
  const submittable = selectSubmittablePlans(calculated);
  const hasMixedWarning = calculated.some(({ plan }) => !plan.feasible) && submittable.length > 0;

  ok("the mixed fixture has one feasible line", calculated.filter(({ plan }) => plan.feasible).length === 1);
  ok("the mixed fixture has one infeasible line", calculated.filter(({ plan }) => !plan.feasible).length === 1);
  ok(
    "only the feasible service line is selected for submission",
    submittable.length === 1 && submittable[0].sl === "AL",
  );
  ok("the warning is shown when valid requests remain alongside an infeasible line", hasMixedWarning);
  ok("the submitted count matches the requests that would be sent", submittable.length === 1);

  const changedAssumptions = { ...feasibleAssumptions, maxInhouseIncreasePct: 7 };
  ok(
    "changed assumptions make the existing feasible result stale",
    !planAssumptionsMatch(calculated[0].plan.assumptions, changedAssumptions),
  );
  const recalculated = {
    sl: "AL",
    plan: {
      ...solvePlan({
        ...common,
        residents: roomyPopulation().map((r) => ({ ...r, serviceLine: "AL" })),
        assumptions: changedAssumptions,
      }),
      assumptions: changedAssumptions,
    },
  };
  ok("recalculation replaces the stale result", recalculated.plan !== calculated[0].plan);
  ok(
    "the refreshed result matches the current assumptions",
    planAssumptionsMatch(recalculated.plan.assumptions, changedAssumptions),
  );
  ok(
    "submission is re-enabled after recalculation when the valid line remains feasible",
    selectSubmittablePlans([recalculated, calculated[1]]).length === 1 &&
      recalculated.plan.feasible,
  );
}

// ── 8. Differing street and in-house effective dates ───────────────────────
console.log("\n-- 8. Effective dates are weighted by the part of the quarter they cover --");
{
  const early = projectQuarterlyRealizedRates({
    anchorMs: ANCHOR_MS,
    quarters: QUARTERS,
    existingAvgRateMonthly: 4000,
    postIncreaseAvgRateMonthly: 4400,
    inhouseEffectiveMs: isoToMs("2027-01-01"),
    currentStreetMonthly: 5000,
    newStreetMonthly: 5500,
    streetEffectiveMs: isoToMs("2027-01-01"),
    annualTurnover: 0.3,
  });
  const late = projectQuarterlyRealizedRates({
    anchorMs: ANCHOR_MS,
    quarters: QUARTERS,
    existingAvgRateMonthly: 4000,
    postIncreaseAvgRateMonthly: 4400,
    inhouseEffectiveMs: isoToMs("2027-03-01"), // two thirds of the way into Q1
    currentStreetMonthly: 5000,
    newStreetMonthly: 5500,
    streetEffectiveMs: isoToMs("2027-01-01"),
    annualTurnover: 0.3,
  });
  ok(
    "a March in-house date produces a lower Q1 than a January one",
    late.get("Q1 2027")! < early.get("Q1 2027")! - 50,
    `late=${late.get("Q1 2027")!.toFixed(0)} early=${early.get("Q1 2027")!.toFixed(0)}`,
  );
  near(
    "by Q3 the two converge — the date only shifts when the money starts",
    late.get("Q3 2027")!,
    early.get("Q3 2027")!,
    1,
  );

  const lateStreet = projectQuarterlyRealizedRates({
    anchorMs: ANCHOR_MS,
    quarters: QUARTERS,
    existingAvgRateMonthly: 4000,
    postIncreaseAvgRateMonthly: 4400,
    inhouseEffectiveMs: isoToMs("2027-01-01"),
    currentStreetMonthly: 5000,
    newStreetMonthly: 5500,
    streetEffectiveMs: isoToMs("2027-07-01"),
    annualTurnover: 0.3,
  });
  ok(
    "delaying the street date lowers the projection too",
    lateStreet.get("Q4 2027")! < early.get("Q4 2027")!,
  );

  // A later street date does not impose a resident ceiling.
  const cappedLate = solvePlan({
    residents: [resident("A", 4900, 5000)],
    assumptions: assumptions({
      rateGrowthTargetPct: 8,
      streetRateEffectiveDate: "2027-07-01",
      inhouseEffectiveDate: "2027-01-01",
    }),
    baselineByQuarter: flatBaseline(4900),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
  });
  ok(
    "the resident may be raised above current street up to the configured maximum",
    cappedLate.allocation.allocations[0].increase > 5000 / 4900 - 1,
    `increase=${cappedLate.allocation.allocations[0].increase}`,
  );
}

// ── 9 & 10. Which quarter binds ────────────────────────────────────────────
console.log("\n-- 9. The quarter with the least cushion binds (Q1) --");
{
  const baseline = flatBaseline(4200);
  // Make Q1's prior year unusually high, so Q1 is the hardest to beat.
  const q1 = baseline.get("Q1 2027")!;
  baseline.set("Q1 2027", { ...q1, realizedRateMonthly: 4500 });
  const result = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({ rateGrowthTargetPct: 4 }),
    baselineByQuarter: baseline,
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5200,
  });
  ok("Q1 2027 is reported as binding", result.bindingQuarterLabel === "Q1 2027", `got ${result.bindingQuarterLabel}`);
  ok("exactly one quarter is flagged binding", result.quarterResults.filter((q) => q.isBinding).length === 1);
}

console.log("\n-- 10. The quarter with the least cushion binds (Q4) --");
{
  const baseline = flatBaseline(4200);
  const q4 = baseline.get("Q4 2027")!;
  baseline.set("Q4 2027", { ...q4, realizedRateMonthly: 4600 });
  const result = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({ rateGrowthTargetPct: 4 }),
    baselineByQuarter: baseline,
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5200,
  });
  ok("Q4 2027 is reported as binding", result.bindingQuarterLabel === "Q4 2027", `got ${result.bindingQuarterLabel}`);
  ok(
    "the binding quarter is the one with the smallest margin over target",
    result.quarterResults.find((q) => q.isBinding)!.shortfallPct >=
      Math.max(...result.quarterResults.map((q) => q.shortfallPct)) - 1e-9,
  );
}

// ── 11. Resident-day weighting ─────────────────────────────────────────────
console.log("\n-- 11. Aggregation is resident-day weighted, not headcount --");
{
  const shortStay = resident("SHORT", 6000, 8000, 30);
  const longStay = resident("LONG", 4000, 8000, 270);
  const avg = residentDayWeightedAverageRate([shortStay, longStay]);
  near(
    "the average leans toward the resident who is here longer",
    avg,
    (6000 * 30 + 4000 * 270) / 300,
    0.01,
  );
  ok("and is well below the plain headcount average of $5,000", avg < 4500);

  // The same weighting must drive the allocation's reconciliation.
  const result = allocateIncreases({
    residents: [shortStay, longStay],
    targetAvgIncrease: 0.05,
    minIncrease: 0,
    maxIncrease: 0.2,
    strength: "low",
    allowAboveStreet: false,
    streetMultiplier: 1,
  });
  const before = residentDayWeightedAverageRate([shortStay, longStay]);
  const after = residentDayWeightedAverageRate(
    result.allocations.map((a) => ({
      ...a.resident,
      currentRateMonthly: a.resident.currentRateMonthly * (1 + a.increase),
    })),
  );
  near(
    "the resident-day weighted rate moves by exactly the required average",
    (after / before - 1) * 100,
    5,
    1e-6,
  );
}

// ── 12. Allocation reconciles to the required aggregate ────────────────────
console.log("\n-- 12. Resident allocation reconciles back to the required aggregate --");
{
  const population = [
    resident("A", 3800, 5200, 90),
    resident("B", 4100, 5000, 60),
    resident("C", 4600, 4900, 90),
    resident("D", 4850, 4900, 90),
    resident("E", 5000, 4900, 90), // above street — contributes nothing
    resident("F", 4200, 5300, 45),
  ];
  for (const strength of ["low", "medium", "high"] as const) {
    const result = allocateIncreases({
      residents: population,
      targetAvgIncrease: 0.03,
      minIncrease: 0,
      maxIncrease: 0.08,
      strength,
      allowAboveStreet: false,
      streetMultiplier: 1,
    });
    near(
      `${strength} equalization: achieved average equals the required 3%`,
      result.achievedAvgIncrease * 100,
      3,
      1e-6,
    );
    const before = residentDayWeightedAverageRate(population);
    const after = residentDayWeightedAverageRate(
      result.allocations.map((a) => ({
        ...a.resident,
        currentRateMonthly: a.resident.currentRateMonthly * (1 + a.increase),
      })),
    );
    near(
      `${strength} equalization: the aggregate rate move matches`,
      (after / before - 1) * 100,
      3,
      1e-6,
    );
    ok(
      `${strength} equalization: nobody breaches the 8% maximum`,
      result.allocations.every((a) => a.increase <= 0.08 + 1e-9),
    );
    ok(
      `${strength} equalization: nobody is classified as blocked by Street Rate`,
      result.allocations.every(
        (a) => a.constraint !== "street_cap" && a.constraint !== "at_or_above_street",
      ),
    );
  }

  // Equalization strength must actually change the spread.
  const spreadOf = (strength: "low" | "medium" | "high") => {
    const r = allocateIncreases({
      residents: population,
      targetAvgIncrease: 0.03,
      minIncrease: 0,
      maxIncrease: 0.08,
      strength,
      allowAboveStreet: false,
      streetMultiplier: 1,
    });
    const withRoom = r.allocations.filter((a) => a.headroom > 0.001).map((a) => a.increase);
    return Math.max(...withRoom) - Math.min(...withRoom);
  };
  ok(
    "high equalization spreads increases wider than low",
    spreadOf("high") > spreadOf("low"),
    `high=${spreadOf("high").toFixed(4)} low=${spreadOf("low").toFixed(4)}`,
  );
  ok(
    "medium sits between low and high",
    spreadOf("medium") >= spreadOf("low") - 1e-9 && spreadOf("medium") <= spreadOf("high") + 1e-9,
  );
}

// ── 13. Sanity: the horizon starts where it should ─────────────────────────
console.log("\n-- 13. Projection covers the whole horizon --");
{
  const projected = projectQuarterlyRealizedRates({
    anchorMs: quarterStartMs(QUARTERS[0]),
    quarters: QUARTERS,
    existingAvgRateMonthly: 4000,
    postIncreaseAvgRateMonthly: 4000,
    inhouseEffectiveMs: isoToMs("2027-01-01"),
    currentStreetMonthly: 4000,
    newStreetMonthly: 4000,
    streetEffectiveMs: isoToMs("2027-01-01"),
    annualTurnover: 0.3,
  });
  ok("every horizon quarter has a projection", QUARTERS.every((q) => projected.has(q.label)));
  ok(
    "with street equal to the in-house rate the projection is flat",
    QUARTERS.every((q) => Math.abs(projected.get(q.label)! - 4000) < 0.01),
  );
  const monthly = projectMonthlyRealizedRates(
    {
      anchorMs: quarterStartMs(QUARTERS[0]),
      quarters: QUARTERS,
      existingAvgRateMonthly: 4000,
      postIncreaseAvgRateMonthly: 4400,
      inhouseEffectiveMs: isoToMs("2027-02-01"),
      currentStreetMonthly: 4500,
      newStreetMonthly: 4800,
      streetEffectiveMs: isoToMs("2027-03-01"),
      annualTurnover: 0,
      weightBasis: "resident_months",
    },
    ["2027-01", "2027-02", "2027-03"],
  );
  near("monthly projection shows the pre-increase January rate", monthly.get("2027-01")!, 4000, 0.01);
  near("monthly projection applies the resident increase in February", monthly.get("2027-02")!, 4400, 0.01);
  near("with no turnover, the March Street Rate change does not alter realized rate", monthly.get("2027-03")!, 4400, 0.01);
}

// ── 14. Resident construction from raw rent-roll rows ──────────────────────
console.log("\n-- 14. Move-out dates decide who is in the plan and how much they count --");
{
  const row = (over: Partial<RawResidentRow>): RawResidentRow => ({
    location: "Test Campus",
    service_line: "AL",
    room_number: "101",
    room_type: "Studio",
    care_level: null,
    payor_type: "PRIVATE PAY",
    move_in_date: "1/15/2024", // the rent roll's other date spelling
    move_out_date: null,
    in_house_rate: 4000,
    street_rate: 5000,
    passes_ih_gate: true,
    passes_street_gate: true,
    ...over,
  });

  const horizonStartMs = isoToMs("2027-01-01");
  const horizonEndMs = isoToMs("2028-01-01");
  const horizonDays = (horizonEndMs - horizonStartMs) / 86400000;
  const build = (rows: RawResidentRow[]) =>
    buildResidents(rows, { horizonStartMs, horizonEndMs });

  const staying = build([row({ room_number: "A" })]);
  near(
    "no move-out date means the full horizon",
    staying.residents[0].weight,
    horizonDays,
    0.01,
  );

  const leavingMidway = build([row({ room_number: "B", move_out_date: "2027-07-01" })]);
  near(
    "a mid-horizon move-out counts only the days up to it",
    leavingMidway.residents[0].weight,
    (isoToMs("2027-07-01") - horizonStartMs) / 86400000,
    1,
  );
  ok(
    "and that is materially less than the full horizon",
    leavingMidway.residents[0].weight < horizonDays * 0.6,
  );

  // The bug this guards: a zero-day overlap falling through to full weight.
  const alreadyGone = build([row({ room_number: "C", move_out_date: "2026-11-30" })]);
  ok(
    "someone who leaves before the horizon is dropped, not given full weight",
    alreadyGone.residents.length === 0,
    `got ${alreadyGone.residents.length} residents with weight ${alreadyGone.residents[0]?.weight}`,
  );
  ok(
    "and the drop is reported so it can be warned about",
    alreadyGone.excluded.departingBeforeHorizon === 1,
  );

  // Both rent-roll date spellings must parse.
  const isoMoveIn = build([row({ room_number: "D", move_in_date: "2024-01-15" })]);
  ok(
    "an ISO move-in date parses the same as M/D/YYYY",
    isoMoveIn.residents[0].moveInDate === staying.residents[0].moveInDate,
    `${isoMoveIn.residents[0].moveInDate} vs ${staying.residents[0].moveInDate}`,
  );

  // Daily-billed service lines are normalized into the one monthly space.
  const hc = build([
    row({ room_number: "E", service_line: "HC", in_house_rate: 300, street_rate: 350 }),
  ]);
  ok(
    "an HC daily rate is normalized to monthly for the solver",
    hc.residents[0].currentRateMonthly > 8000 && hc.residents[0].currentRateMonthly < 9500,
    `got ${hc.residents[0].currentRateMonthly}`,
  );

  // A low rate may fail the plausibility gate, but it is still a real resident
  // rate and must remain in the plan.
  const gated = build([row({ room_number: "F", passes_ih_gate: false })]);
  ok("an implausible in-house rate remains in the plan", gated.residents.length === 1);
  ok("it is not reported as an excluded resident", gated.excluded.implausibleRate === 0);

  // A daily Skilled/non-base charge can be attached to a room whose physical
  // service line is monthly AL. When it overwrites BOTH the in-house and street
  // fields, it is not a discounted AL resident and must not enter the
  // single-occupant base cohort.
  const mislabeledSkilled = buildResidents(
    [
      row({
        room_number: "F2",
        service_line: "AL",
        in_house_rate: 189,
        street_rate: 189,
        passes_ih_gate: false,
        passes_street_gate: false,
      }),
    ],
    {
      horizonStartMs,
      horizonEndMs,
      productStreet: () => ({ rate: 4999, source: "product_median" }),
    },
  );
  ok(
    "a daily non-base charge mislabeled as a monthly base rate is excluded",
    mislabeledSkilled.residents.length === 0,
  );
  ok(
    "the mislabeled product is reported as an implausible-rate exclusion",
    mislabeledSkilled.excluded.implausibleRate === 1,
  );

  const legitimateDiscount = buildResidents(
    [
      row({
        room_number: "F3",
        service_line: "AL",
        in_house_rate: 189,
        street_rate: 4999,
        passes_ih_gate: false,
        passes_street_gate: true,
      }),
    ],
    {
      horizonStartMs,
      horizonEndMs,
      productStreet: () => ({ rate: 4999, source: "product_median" }),
    },
  );
  ok(
    "a low resident rate remains when its published base Street Rate is valid",
    legitimateDiscount.residents.length === 1,
  );

  // A failed street gate leaves the resident in, but with no usable street cap.
  const noStreet = build([row({ room_number: "G", passes_street_gate: false })]);
  ok("a failed street gate keeps the resident", noStreet.residents.length === 1);
  near("but zeroes their street rate", noStreet.residents[0].streetRateMonthly, 0, 1e-9);
  ok("and is counted", noStreet.excluded.noStreetRate === 1);
}

// ── 15. Each resident is measured against their own PRODUCT ────────────────
//
// The defect this guards: a companion resident paying $556 against a $3,200
// villa base median failed the plausibility gate, lost their ceiling entirely
// and was then planned as if no street rate existed. The comparison must be
// against the second-occupant rate, which their $556 matches exactly.
console.log("\n-- 15. Product-matched street comparison --");
{
  ok(
    "a senior-housing /B room number is a second occupant",
    classifyRateProduct("VIL", "2427/B", "Villa", "Villa") === "second_occupant",
  );
  ok(
    "the same room number in health care is not, since HC writes the bed as a room type",
    classifyRateProduct("HC", "104/B", "Private", "Private") === "base",
  );
  ok(
    "an HC companion bed type is semi-private",
    classifyRateProduct("HC", "104", "Companion", "Companion Suite") === "semi_private",
  );
  ok(
    "a raw source room type is read even when normalization collapses it",
    classifyRateProduct("HC", "104", "Studio", "TCU - Private") === "rehab_tcu",
  );
  ok(
    "a shared short-stay bed takes the LOWER of the two ceilings",
    classifyRateProduct("HC", "104", "Studio", "TCU - Companion") === "semi_private",
  );
  ok(
    "campus names ending in -ward are not read as ward beds",
    classifyRateProduct("HC", "104", "Private", "Woodward Private") === "base",
  );

  const baselines: ProductStreetBaselines = {
    byLocation: new Map([
      ["Villa Campus||VIL||second_occupant", 560],
      ["Villa Campus||VIL||base", 3200],
    ]),
    byServiceLine: new Map([
      ["VIL||second_occupant", 545],
      ["VIL||base", 3150],
    ]),
  };
  const formulas = [
    {
      rateType: "second_occupant" as const,
      serviceLine: null,
      percentOfBase: 55,
      dollarOffset: 0,
      enabled: true,
    },
  ];
  const resolver = makeProductStreetResolver(baselines, formulas);
  const horizonStartMs = isoToMs("2027-01-01");
  const horizonEndMs = isoToMs("2028-01-01");
  const vil = (over: Partial<RawResidentRow>): RawResidentRow => ({
    location: "Villa Campus",
    service_line: "VIL",
    room_number: "2427",
    room_type: "Villa",
    source_room_type: "Villa",
    care_level: null,
    payor_type: "PRIVATE PAY",
    move_in_date: "1/15/2024",
    move_out_date: null,
    in_house_rate: 480,
    street_rate: 556,
    passes_ih_gate: true,
    passes_street_gate: true,
    ...over,
  });

  // The companion's own rate is plausible FOR A COMPANION even though the
  // base-median gate rejected it, so it stays as the ceiling.
  const companion = buildResidents([vil({ room_number: "2427/B", passes_street_gate: false })], {
    horizonStartMs,
    horizonEndMs,
    productStreet: resolver,
  });
  ok("the companion keeps a usable ceiling", companion.residents[0].streetRateMonthly > 0);
  near("and it is their own asking rate", companion.residents[0].streetRateMonthly, 556, 1e-9);
  ok("reported as coming from the unit", companion.residents[0].streetRateSource === "unit");
  ok("and classified as a second occupant", companion.residents[0].rateProduct === "second_occupant");
  ok("nobody is counted as street-rate-less", companion.excluded.noStreetRate === 0);

  // A missing rate falls back to the product median, not the base median.
  const missing = buildResidents([vil({ room_number: "2428/B", street_rate: 0 })], {
    horizonStartMs,
    horizonEndMs,
    productStreet: resolver,
  });
  near("a missing rate falls back to the product median", missing.residents[0].streetRateMonthly, 560, 1e-9);
  ok("labelled as a median", missing.residents[0].streetRateSource === "product_median");

  // A rate implausible even for the product is replaced, not kept.
  const junk = buildResidents([vil({ room_number: "2429/B", street_rate: 12 })], {
    horizonStartMs,
    horizonEndMs,
    productStreet: resolver,
  });
  near("a rate implausible for the product is replaced", junk.residents[0].streetRateMonthly, 560, 1e-9);

  // With no observed companion rate anywhere, the configured formula prices it.
  const noProduct = makeProductStreetResolver(
    {
      byLocation: new Map([["Villa Campus||VIL||base", 3200]]),
      byServiceLine: new Map([["VIL||base", 3150]]),
    },
    formulas,
  );
  const derived = buildResidents([vil({ room_number: "2430/B", street_rate: 0 })], {
    horizonStartMs,
    horizonEndMs,
    productStreet: noProduct,
  });
  near("an unpriced product uses the derived formula", derived.residents[0].streetRateMonthly, 1760, 1e-9);
  ok("labelled as derived", derived.residents[0].streetRateSource === "derived_formula");

  // A base-product resident is unaffected by any of this.
  const base = buildResidents([vil({ room_number: "2431", street_rate: 3240 })], {
    horizonStartMs,
    horizonEndMs,
    productStreet: resolver,
  });
  near("a single occupant keeps their own street rate", base.residents[0].streetRateMonthly, 3240, 1e-9);
  ok("and stays on the base product", base.residents[0].rateProduct === "base");
}

// ──────────────────────── two-point matched-quarter index ────────────────────
// This engine exists to stop room turnover and eligibility churn from being
// read as price movement, so every case below is built so that a naive average
// gets it WRONG. A test the pooled average would also pass guards nothing.
{
  console.log("\n-- two-point matched-quarter comparison --");

  const room = (
    unitKey: string,
    rateMonthly: number,
    opts: { weight?: number; roomType?: string; careLevel?: string } = {},
  ): RoomQuarterObservation => ({
    unitKey,
    rateMonthly,
    weight: opts.weight ?? 1,
    roomType: opts.roomType ?? "STUDIO",
    careLevel: opts.careLevel ?? "1",
  });
  /** Gates off by default; each case turns on only the one it is about. */
  const thresholds = (o: Partial<CoverageThresholds> = {}): CoverageThresholds => ({
    minMatchedRooms: 1,
    coverageFloorPct: 0,
    percentageGateMinRooms: 100_000,
    minStratumRooms: 1,
    ...o,
  });

  // Prices never move. One room departs and a pricier one arrives, which drags
  // the pooled average up 25% out of thin air.
  const churn = compareQuarters({
    baseQuarterLabel: "Q2 2025",
    endingQuarterLabel: "Q2 2026",
    ending: [room("A", 1000), room("B", 2000), room("C", 2000)],
    base: [room("A", 1000), room("B", 2000), room("D", 1000)],
    rawEndingRate: 5000 / 3,
    rawBaseRate: 4000 / 3,
    thresholds: thresholds(),
  });
  near("flat prices with turnover leave the matched rate flat", churn.rateEffectPct!, 0, 1e-9);
  near("the raw move is still reported", churn.rawChangePct!, 25, 1e-9);
  near("and attributed entirely to mix", churn.mixEffectPct!, 25, 1e-9);
  near(
    "rate effect plus mix effect reconciles to the raw change",
    churn.rateEffectPct! + churn.mixEffectPct!,
    churn.rawChangePct!,
    1e-9,
  );
  ok("only rooms present in both quarters are matched", churn.matchedRooms === 2);
  near("coverage is matched over rooms priced in the ENDING quarter", churn.coverageByCountPct, (2 / 3) * 100, 1e-9);

  // Ratios are computed inside strata and only then combined. Pooling these two
  // room types gives 1.0333; the stratified answer is 1.0342, and the pooled
  // number is wrong because it lets the expensive type dominate the arithmetic
  // rather than only its own share of the weight.
  const stratified = compareQuarters({
    baseQuarterLabel: "Q2 2025",
    endingQuarterLabel: "Q2 2026",
    ending: [room("A", 1100), room("B", 5100, { roomType: "TWO_BR" })],
    base: [room("A", 1000), room("B", 5000, { roomType: "TWO_BR" })],
    rawEndingRate: 3100,
    rawBaseRate: 3000,
    thresholds: thresholds(),
  });
  ok("each unit type is its own stratum", stratified.strata.length === 2);
  near("strata are combined on ending-quarter weights", stratified.ratio!, 6412 / 6200, 1e-12);
  near("and re-combined on base-quarter weights", stratified.baseWeightedRatio!, 6200 / 6000, 1e-12);
  near(
    "the spread between the two weightings is the composition effect",
    stratified.compositionEffectPct!,
    ((6412 / 6200) / (6200 / 6000) - 1) * 100,
    1e-9,
  );

  // A stratum stands in for itself whether two of its rooms matched or all ten.
  // Weighting by matched revenue instead would give 1.0167 here.
  const renormalized = compareQuarters({
    baseQuarterLabel: "Q2 2025",
    endingQuarterLabel: "Q2 2026",
    ending: [
      ...Array.from({ length: 10 }, (_, i) => room(`X${i}`, 1000)),
      ...Array.from({ length: 10 }, (_, i) => room(`Y${i}`, 1000, { roomType: "TWO_BR" })),
    ],
    base: [
      room("X0", 1000 / 1.1),
      room("X1", 1000 / 1.1),
      ...Array.from({ length: 10 }, (_, i) => room(`Y${i}`, 1000, { roomType: "TWO_BR" })),
    ],
    rawEndingRate: null,
    rawBaseRate: null,
    thresholds: thresholds(),
  });
  near(
    "a stratum carries its full weight however few of its rooms matched",
    renormalized.ratio!,
    1.05,
    1e-12,
  );

  // The historical rate is used exactly as recorded. Room B's base rate would
  // fail any plausibility gate; substituting a stratum average for it would
  // erase the very movement the comparison exists to measure.
  const frozen = compareQuarters({
    baseQuarterLabel: "Q2 2025",
    endingQuarterLabel: "Q2 2026",
    ending: [room("A", 1000), room("B", 1000)],
    base: [room("A", 1000), room("B", 100)],
    rawEndingRate: null,
    rawBaseRate: null,
    thresholds: thresholds(),
  });
  near("historical rates are never re-gated or imputed", frozen.ratio!, 2000 / 1100, 1e-12);

  // A stratum with too few matched rooms is not believed, and its weight goes
  // to its siblings in the same unit type rather than taking the scope down.
  const gated = compareQuarters({
    baseQuarterLabel: "Q2 2025",
    endingQuarterLabel: "Q2 2026",
    ending: [
      ...Array.from({ length: 5 }, (_, i) => room(`P${i}`, 1000, { careLevel: "1" })),
      ...Array.from({ length: 5 }, (_, i) => room(`Q${i}`, 1000, { careLevel: "2" })),
    ],
    base: [
      ...Array.from({ length: 5 }, (_, i) => room(`P${i}`, 1000, { careLevel: "1" })),
      room("Q0", 500, { careLevel: "2" }),
    ],
    rawEndingRate: null,
    rawBaseRate: null,
    thresholds: thresholds({ minMatchedRooms: 3 }),
  });
  near("a thin stratum is dropped, not averaged in", gated.ratio!, 1, 1e-12);
  ok(
    "and the reason code names the count that failed",
    gated.suppressedStrata.length === 1 &&
      gated.suppressedStrata[0].reasonCode === "INSUFFICIENT_MATCHED_ROOMS:1<3",
    gated.suppressedStrata[0]?.reasonCode,
  );
  ok(
    "its weight is reassigned inside its own unit type",
    gated.redistributedUnitTypes.join() === "STUDIO" && !gated.redistributedAcrossUnitTypes,
  );

  // The percentage floor is only a fair judge once a stratum is big enough to
  // have one. Below that threshold the matched COUNT is the only gate, because
  // a percentage over a handful of rooms measures portfolio size.
  const thinPct = {
    baseQuarterLabel: "Q2 2025",
    endingQuarterLabel: "Q2 2026",
    ending: Array.from({ length: 30 }, (_, i) => room(`R${i}`, 1000)),
    base: Array.from({ length: 8 }, (_, i) => room(`R${i}`, 1000)),
    rawEndingRate: null,
    rawBaseRate: null,
  };
  const pctApplied = compareQuarters({
    ...thinPct,
    thresholds: thresholds({ minMatchedRooms: 3, coverageFloorPct: 60, percentageGateMinRooms: 20 }),
  });
  const pctWaived = compareQuarters({
    ...thinPct,
    thresholds: thresholds({ minMatchedRooms: 3, coverageFloorPct: 60, percentageGateMinRooms: 40 }),
  });
  ok(
    "a large stratum below the coverage floor is suppressed",
    !pctApplied.usable && pctApplied.reasonCode === "ALL_STRATA_SUPPRESSED",
    pctApplied.reasonCode ?? "usable",
  );
  ok(
    "the same coverage passes when the stratum is too small to judge on a ratio",
    pctWaived.usable,
  );
  near(
    "a fully suppressed comparison still exposes an ungated fallback ratio",
    pctApplied.unsuppressedRatio!,
    1,
    1e-12,
  );

  // Unit type x care level x price band is right for a portfolio and ruinous
  // for one campus, where it can make more strata than rooms. Each room takes
  // the finest key whose group is still big enough to be one.
  const manyTypes = Array.from({ length: 30 }, (_, i) =>
    room(`Z${i}`, 1000, { roomType: `TYPE_${i % 10}` }),
  );
  const coarse = assignStrata(manyTypes, 12);
  ok(
    "over-thin strata coarsen to a single pooled group",
    new Set(coarse.map((a) => a.key)).size === 1 && coarse[0].key === "ALL",
    Array.from(new Set(coarse.map((a) => a.key))).join(","),
  );
  const banded = assignStrata(
    [100, 200, 300, 400, 500, 600, 700, 800].map((r, i) => room(`W${i}`, r)),
    1,
  );
  ok(
    "and split into price bands when there is room to",
    new Set(banded.map((a) => a.key)).size === 4,
    Array.from(new Set(banded.map((a) => a.key))).join(","),
  );
}

console.log("\n=== Summary ===");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
