/**
 * Regression tests for the in-house rate planning solver.
 *
 * The solver has no database dependency by design, so every case here is a
 * synthetic population with hand-checkable arithmetic. What is being guarded:
 *
 *   • turnover really moves the projection (0% vs 60% must differ)
 *   • min == max degenerates to a flat increase for everyone
 *   • the may-not-exceed-street rule genuinely zeroes residents at or above
 *     street, rather than quietly letting them through
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
import { DEFAULT_ASSUMPTIONS } from "../shared/inhousePlanning";
import {
  allocateIncreases,
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
  type ProductStreetBaselines,
  type RawResidentRow,
} from "../server/services/inhouseRatePlanning/dataAccess";
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
): PlanningResident {
  return {
    key: id,
    location: "Test Campus",
    serviceLine: "AL",
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
    allowInhouseAboveStreet: false,
    maxStreetIncreasePct: 15,
    ...overrides,
  };
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
console.log("\n-- 4. A resident exactly at street receives nothing --");
{
  const result = allocateIncreases({
    residents: [resident("AT", 5000, 5000), resident("BELOW", 4000, 5000)],
    targetAvgIncrease: 0.05,
    minIncrease: 0.01,
    maxIncrease: 0.1,
    strength: "medium",
    allowAboveStreet: false,
    streetMultiplier: 1,
  });
  const at = result.allocations.find((a) => a.resident.key === "AT")!;
  const below = result.allocations.find((a) => a.resident.key === "BELOW")!;
  near("the at-street resident gets 0%", at.increase, 0, 1e-9);
  ok("and is labelled as having no headroom", at.constraint === "at_or_above_street");
  ok("the configured 1% minimum does NOT override the street cap", at.increase === 0);
  ok("the below-street resident still gets an increase", below.increase > 0);
}

// ── 5. Resident ABOVE street ───────────────────────────────────────────────
console.log("\n-- 5. A resident above street receives nothing and is never cut --");
{
  const result = allocateIncreases({
    residents: [resident("ABOVE", 5400, 5000), resident("BELOW", 4000, 5000)],
    targetAvgIncrease: 0.05,
    minIncrease: 0.02,
    maxIncrease: 0.1,
    strength: "medium",
    allowAboveStreet: false,
    streetMultiplier: 1,
  });
  const above = result.allocations.find((a) => a.resident.key === "ABOVE")!;
  near("the above-street resident gets 0%", above.increase, 0, 1e-9);
  ok("never a negative increase — planning does not cut rates", above.increase >= 0);
  ok("labelled as having no headroom", above.constraint === "at_or_above_street");

  const allowed = allocateIncreases({
    residents: [resident("ABOVE", 5400, 5000)],
    targetAvgIncrease: 0.05,
    minIncrease: 0.02,
    maxIncrease: 0.1,
    strength: "medium",
    allowAboveStreet: true,
    streetMultiplier: 1,
  });
  ok(
    "with allow-above-street ON the same resident can be increased",
    allowed.allocations[0].increase > 0,
  );
}

// ── 6. Achievable target ───────────────────────────────────────────────────
console.log("\n-- 6. An achievable target is solved without touching the street ceiling --");
{
  const result = solvePlan({
    residents: roomyPopulation(),
    assumptions: assumptions({ rateGrowthTargetPct: 5 }),
    baselineByQuarter: flatBaseline(4200),
    quarters: QUARTERS,
    anchorMs: ANCHOR_MS,
    currentStreetRateMonthly: 5000,
  });
  ok("plan is feasible", result.feasible);
  near("street recommendation sits at the target growth, not above", result.streetIncrease * 100, 5, 0.01);
  ok("every quarter passes", result.quarterResults.every((q) => q.passes));
  ok("no infeasibility block", result.infeasibility === null);
  ok(
    "the required increase is within the configured maximum",
    result.requiredAvgIncrease * 100 <= 8 + 1e-6,
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

// ── 7b. Impossible because nobody has headroom ─────────────────────────────
console.log("\n-- 7b. A population with no headroom names the street cap --");
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
    "the binding constraint is a lack of headroom",
    result.infeasibility?.bindingConstraint === "no_headroom",
    `got ${result.infeasibility?.bindingConstraint}`,
  );
  ok(
    "a street increase is offered as the way out",
    (result.infeasibility?.minimumChange.streetIncreasePct ?? 0) > 0,
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

  // A street date AFTER the in-house date cannot raise the in-house ceiling.
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
    "a street increase landing after the in-house date gives no extra headroom",
    cappedLate.allocation.allocations[0].increase <= 5000 / 4900 - 1 + 1e-9,
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
      `${strength} equalization: nobody is pushed past street`,
      result.allocations.every(
        (a) =>
          a.resident.currentRateMonthly * (1 + a.increase) <=
          Math.max(a.resident.streetRateMonthly, a.resident.currentRateMonthly) + 1e-6,
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

console.log("\n=== Summary ===");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
