/**
 * In-House Rate Planning — orchestration.
 *
 * Pulls the population and the history out of the database, hands pure
 * numbers to the solver, and assembles the operator-facing result. No pricing
 * is written here: calculating a plan is always read-only, and applying one is
 * a separate, explicit step.
 */
import type {
  BaselineQuarter,
  CalcExplanation,
  PlanResult,
  PlanScope,
  PlanSummary,
  PlanningAssumptions,
  PlanningResident,
  QuarterRef,
  ResidentRecommendation,
} from "@shared/inhousePlanning";
import { formatMoney, formatPct } from "@shared/inhousePlanning";
import { DAYS_PER_MONTH } from "@shared/careRates";
import { isDailyRateServiceLine } from "../rateNormalization";
import {
  buildResidents,
  fetchCurrentStreetRate,
  fetchMonthlyRealizedRates,
  fetchResidentRows,
  getLatestMonthForScope,
  horizonQuarters,
  projectMissingQuarters,
  rollMonthsIntoQuarters,
  type MonthlyRealized,
  type ScopeFilter,
} from "./dataAccess";
import {
  addMonths,
  addQuarters,
  isoToMs,
  monthBoundsMs,
  quarterEndMs,
  quarterStartMs,
} from "./dates";
import { EQUALIZATION_EXPONENT, solvePlan, type ResidentAllocation } from "./solver";

export * from "./dates";
export * from "./solver";
export * from "./dataAccess";

export interface CalculatePlanInput {
  clientId: string;
  locationId: string | null;
  /** Campus name as stored in `rent_roll_data.location`. */
  location: string | null;
  serviceLine: string;
  assumptions: PlanningAssumptions;
}

export class PlanningDataError extends Error {}

/**
 * Everything the solver knew but the operator-facing result does not carry.
 *
 * `PlanResult` deliberately publishes conclusions, not machinery — it crosses
 * the wire to the browser on every keystroke-driven recalculation, so widening
 * it with per-resident solver internals would cost real bandwidth for a payload
 * the UI never reads. The Excel export is the one consumer that needs the
 * derivation itself, so it takes this side channel instead.
 */
export interface PlanAudit {
  /** Calibration scalar; `increase = clamp(lambda * shape, min, max)`. */
  lambda: number;
  /** Equalization curve exponent implied by the configured strength. */
  equalizationExponent: number;
  /** Street multiplier in force on the in-house effective date, e.g. 1.05. */
  streetMultiplierAtInhouse: number;
  minEffectiveFloor: number;
  maxEffectiveCeiling: number;
  allowAboveStreet: boolean;
  currentStreetRateMonthly: number;
  recommendedStreetRateMonthly: number;
  /** Full realized-rate history, oldest first — the trend the target is built on. */
  monthlyRealized: MonthlyRealized[];
  residents: Array<{
    key: string;
    location: string;
    serviceLine: string;
    roomNumber: string;
    roomType: string | null;
    careLevel: string | null;
    payorType: string | null;
    moveInDate: string | null;
    isCompanionBed: boolean;
    /** Resident-day weight over the measurement window. */
    weight: number;
    currentRateMonthly: number;
    streetRateMonthly: number;
    headroom: number;
    shape: number;
    minEffective: number;
    maxEffective: number;
    increase: number;
    constraint: string;
  }>;
}

export async function calculatePlan(input: CalculatePlanInput): Promise<PlanResult> {
  return (await calculatePlanDetailed(input)).plan;
}

/**
 * Same calculation as `calculatePlan`, plus the solver internals needed to
 * reconstruct each resident's number from first principles.
 */
export async function calculatePlanDetailed(
  input: CalculatePlanInput,
): Promise<{ plan: PlanResult; audit: PlanAudit }> {
  const scope: ScopeFilter = {
    clientId: input.clientId,
    location: input.location,
    serviceLine: input.serviceLine,
  };

  const sourceMonth = await getLatestMonthForScope(scope);
  if (!sourceMonth) {
    throw new PlanningDataError(
      `No occupied ${input.serviceLine} rent-roll rows found for ${input.location ?? "this portfolio"}.`,
    );
  }

  const assumptions = withResolvedDates(input.assumptions, sourceMonth);
  const quarters = horizonQuarters(assumptions.inhouseEffectiveDate);
  const horizonStartMs = quarterStartMs(quarters[0]);
  const horizonEndMs = quarterEndMs(quarters[quarters.length - 1]);

  // Simulation starts the day after live data ends, so turnover between now
  // and the plan's first quarter is modelled rather than ignored.
  const anchorMs = monthBoundsMs(addMonths(sourceMonth, 1)).startMs;

  const [rawRows, currentStreetRateMonthly, monthly] = await Promise.all([
    fetchResidentRows(scope, sourceMonth),
    fetchCurrentStreetRate(scope, sourceMonth),
    fetchMonthlyRealizedRates(scope, "2000-01"),
  ]);

  const { residents, excluded } = buildResidents(rawRows, {
    horizonStartMs: Math.min(anchorMs, horizonStartMs),
    horizonEndMs,
  });

  if (residents.length === 0) {
    throw new PlanningDataError(
      `No private-pay ${input.serviceLine} residents with a usable in-house rate at ${input.location ?? "this portfolio"} in ${sourceMonth}.`,
    );
  }

  // Prior-year quarters are what the horizon is judged against.
  const priorYearQuarters = quarters.map((q) => addQuarters(q, -4));
  const knownQuarters = rollMonthsIntoQuarters(monthly);
  const { baselines, quarterlyGrowthPct } = projectMissingQuarters(
    knownQuarters,
    priorYearQuarters,
  );

  // Re-key the baselines by the HORIZON quarter they serve, which is what the
  // solver compares against.
  const baselineByQuarter = new Map<string, BaselineQuarter>();
  quarters.forEach((q, i) => {
    const prior = baselines.get(priorYearQuarters[i].label);
    if (prior) baselineByQuarter.set(q.label, prior);
  });

  // A quarter with no prior-year rate cannot be tested against the target, so
  // it contributes nothing to feasibility. If NONE of them can be tested the
  // plan is unverifiable, and reporting it as "feasible" would be a lie the
  // operator could then approve.
  const testableQuarters = quarters.filter((q) => {
    const b = baselineByQuarter.get(q.label);
    return !!b && (b.realizedRateMonthly ?? 0) > 0;
  });
  if (testableQuarters.length === 0) {
    throw new PlanningDataError(
      `There is no prior-year rent roll for ${input.serviceLine} at ${input.location ?? "this portfolio"}, so year-over-year growth cannot be measured. Import the rent roll for ${priorYearQuarters.map((q) => q.label).join(", ")} to plan against a target.`,
    );
  }

  const solved = solvePlan({
    residents,
    assumptions,
    baselineByQuarter,
    quarters,
    anchorMs,
    currentStreetRateMonthly,
  });

  const daily = isDailyRateServiceLine(input.serviceLine);
  const toDisplay = (monthlyValue: number) =>
    daily ? Math.round((monthlyValue / DAYS_PER_MONTH) * 100) / 100 : Math.round(monthlyValue);

  const streetMultiplierAtInhouse =
    isoToMs(assumptions.streetRateEffectiveDate) <= isoToMs(assumptions.inhouseEffectiveDate)
      ? 1 + solved.streetIncrease
      : 1;

  const recommendations = solved.allocation.allocations.map((a) =>
    toRecommendation(a, {
      daily,
      streetMultiplierAtInhouse,
      assumptions,
      toDisplay,
    }),
  );

  const summary = summarize(residents, recommendations, solved.existingAvgRateMonthly);

  const warnings = buildWarnings({
    sourceMonth,
    excluded,
    baselineByQuarter,
    quarters,
    quarterlyGrowthPct,
    residentsWithoutStreet: residents.filter((r) => r.streetRateMonthly <= 0).length,
    residentCount: residents.length,
  });

  const planScope: PlanScope = {
    clientId: input.clientId,
    locationId: input.locationId,
    location: input.location,
    serviceLine: input.serviceLine,
    sourceMonth,
  };

  const plan: PlanResult = {
    scope: planScope,
    assumptions,
    feasible: solved.feasible,
    rateBasis: daily ? "daily" : "monthly",

    currentStreetRateMonthly,
    recommendedStreetRateMonthly: solved.recommendedStreetMonthly,
    streetIncreasePct: solved.streetIncrease * 100,
    streetIncreaseDollarsMonthly: solved.recommendedStreetMonthly - currentStreetRateMonthly,
    currentStreetRateDisplay: toDisplay(currentStreetRateMonthly),
    recommendedStreetRateDisplay: toDisplay(solved.recommendedStreetMonthly),

    requiredWeightedAvgIncreasePct: solved.requiredAvgIncrease * 100,

    quarters: solved.quarterResults,
    bindingQuarterLabel: solved.bindingQuarterLabel,

    summary,
    residents: recommendations,

    infeasibility: solved.infeasibility,
    explanation: explainPlan({
      planScope,
      assumptions,
      solved,
      summary,
      currentStreetRateMonthly,
    }),
    warnings,
  };

  const audit: PlanAudit = {
    lambda: solved.allocation.lambda,
    equalizationExponent: EQUALIZATION_EXPONENT[assumptions.equalizationStrength] ?? 0.5,
    streetMultiplierAtInhouse,
    minEffectiveFloor: assumptions.minInhouseIncreasePct / 100,
    maxEffectiveCeiling: assumptions.maxInhouseIncreasePct / 100,
    allowAboveStreet: assumptions.allowInhouseAboveStreet,
    currentStreetRateMonthly,
    recommendedStreetRateMonthly: solved.recommendedStreetMonthly,
    monthlyRealized: monthly,
    residents: solved.allocation.allocations.map((a) => ({
      key: a.resident.key,
      location: a.resident.location,
      serviceLine: a.resident.serviceLine,
      roomNumber: a.resident.roomNumber,
      roomType: a.resident.roomType,
      careLevel: a.resident.careLevel,
      payorType: a.resident.payorType,
      moveInDate: a.resident.moveInDate,
      isCompanionBed: a.resident.isCompanionBed,
      weight: a.resident.weight,
      currentRateMonthly: a.resident.currentRateMonthly,
      streetRateMonthly: a.resident.streetRateMonthly,
      headroom: a.headroom,
      shape: a.shape,
      minEffective: a.minEffective,
      maxEffective: a.maxEffective,
      increase: a.increase,
      constraint: a.constraint,
    })),
  };

  return { plan, audit };
}

/**
 * Effective dates default to the start of the quarter after the data ends,
 * which is the earliest date a plan could realistically take effect.
 */
function withResolvedDates(a: PlanningAssumptions, sourceMonth: string): PlanningAssumptions {
  if (a.streetRateEffectiveDate && a.inhouseEffectiveDate) return a;
  const nextMonth = addMonths(sourceMonth, 1);
  const [y, m] = nextMonth.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  const startMonth = (q - 1) * 3 + 1;
  const fallback = `${y}-${String(startMonth).padStart(2, "0")}-01`;
  return {
    ...a,
    streetRateEffectiveDate: a.streetRateEffectiveDate || fallback,
    inhouseEffectiveDate: a.inhouseEffectiveDate || fallback,
  };
}

function toRecommendation(
  a: ResidentAllocation,
  ctx: {
    daily: boolean;
    streetMultiplierAtInhouse: number;
    assumptions: PlanningAssumptions;
    toDisplay: (v: number) => number;
  },
): ResidentRecommendation {
  const r = a.resident;
  const effectiveStreet = r.streetRateMonthly * ctx.streetMultiplierAtInhouse;
  const newRate = r.currentRateMonthly * (1 + a.increase);
  const increaseDollars = newRate - r.currentRateMonthly;

  return {
    key: r.key,
    location: r.location,
    roomNumber: r.roomNumber,
    roomType: r.roomType,
    careLevel: r.careLevel,
    moveInDate: r.moveInDate,
    isCompanionBed: r.isCompanionBed,
    currentRateMonthly: r.currentRateMonthly,
    streetRateMonthly: r.streetRateMonthly,
    gapToStreetPct:
      r.streetRateMonthly > 0 ? (r.streetRateMonthly / r.currentRateMonthly - 1) * 100 : 0,
    gapToStreetDollarsMonthly:
      r.streetRateMonthly > 0 ? r.streetRateMonthly - r.currentRateMonthly : 0,
    increasePct: a.increase * 100,
    increaseDollarsMonthly: increaseDollars,
    newRateMonthly: newRate,
    newGapToStreetPct: effectiveStreet > 0 ? (effectiveStreet / newRate - 1) * 100 : 0,
    constraint: a.constraint,
    rateBasis: ctx.daily ? "daily" : "monthly",
    currentRateDisplay: ctx.toDisplay(r.currentRateMonthly),
    newRateDisplay: ctx.toDisplay(newRate),
    increaseDollarsDisplay: ctx.toDisplay(newRate) - ctx.toDisplay(r.currentRateMonthly),
    explanation: explainResident(a, effectiveStreet, ctx.assumptions),
  };
}

function explainResident(
  a: ResidentAllocation,
  effectiveStreet: number,
  assumptions: PlanningAssumptions,
): CalcExplanation {
  const r = a.resident;
  const newRate = r.currentRateMonthly * (1 + a.increase);
  const steps: CalcExplanation["steps"] = [
    { label: "Current in-house rate", value: formatMoney(r.currentRateMonthly) },
    {
      label: "Street rate for this unit",
      value: r.streetRateMonthly > 0 ? formatMoney(r.streetRateMonthly) : "not available",
      note:
        effectiveStreet > r.streetRateMonthly
          ? `Rises to ${formatMoney(effectiveStreet)} once the recommended street increase takes effect, which is the ceiling that applies on the in-house effective date.`
          : undefined,
    },
    {
      label: "Room to street",
      value: formatPct(a.headroom * 100, 2),
      note: "How far this rate could rise before it reaches street.",
    },
    {
      label: "Allowed range for this resident",
      value: `${formatPct(a.minEffective * 100, 2)} to ${formatPct(a.maxEffective * 100, 2)}`,
      note:
        a.maxEffective < assumptions.maxInhouseIncreasePct / 100 - 1e-9
          ? `Narrower than the ${formatPct(assumptions.maxInhouseIncreasePct)} maximum because the new rate may not pass street.`
          : undefined,
    },
    { label: "Recommended increase", value: formatPct(a.increase * 100, 2) },
    {
      label: "New in-house rate",
      value: formatMoney(newRate),
      note: `${formatMoney(r.currentRateMonthly)} + ${formatMoney(newRate - r.currentRateMonthly)}`,
    },
  ];

  const narrative: string[] = [];
  switch (a.constraint) {
    case "at_or_above_street":
      narrative.push(
        `This resident already pays at or above the street rate, so there is no room to increase them while in-house rates are capped at street. They contribute nothing to this plan's growth.`,
      );
      break;
    case "street_cap":
      narrative.push(
        `This resident was moved all the way up to street rate. The ${formatPct(assumptions.maxInhouseIncreasePct)} maximum was not the limit here — street was.`,
      );
      break;
    case "max":
      narrative.push(
        `This resident sits far enough below street to take the full ${formatPct(assumptions.maxInhouseIncreasePct)} maximum increase.`,
      );
      break;
    case "min":
      narrative.push(
        `This resident is close to street, so the formula would have given them less. The ${formatPct(assumptions.minInhouseIncreasePct)} minimum increase applies instead.`,
      );
      break;
    default:
      narrative.push(
        `With ${formatPct(a.headroom * 100, 2)} of room to street, this resident lands at ${formatPct(a.increase * 100, 2)} — ${
          assumptions.equalizationStrength === "low"
            ? "close to the portfolio average, because equalization is set to low"
            : assumptions.equalizationStrength === "high"
              ? "scaled aggressively with their distance from street, because equalization is set to high"
              : "scaled with their distance from street"
        }.`,
      );
  }
  if (r.isCompanionBed) {
    narrative.push(
      "This is a companion (second occupant) bed. Companion rows are left out of street-rate averages, but the resident is billed and receives an increase like anyone else.",
    );
  }
  if (r.streetRateMonthly <= 0) {
    narrative.push(
      "No usable street rate is on file for this unit, so only the configured maximum limits the increase.",
    );
  }

  return {
    headline: `Room ${r.roomNumber} — ${formatPct(a.increase * 100, 2)} increase`,
    steps,
    narrative,
  };
}

function summarize(
  residents: PlanningResident[],
  recs: ResidentRecommendation[],
  currentAvg: number,
): PlanSummary {
  let totalMonthly = 0;
  let minPct = Number.POSITIVE_INFINITY;
  let maxPct = Number.NEGATIVE_INFINITY;
  let receiving = 0;
  let atMin = 0;
  let atMax = 0;
  let blocked = 0;
  let weightedNew = 0;
  let weightTotal = 0;

  const byKey = new Map(residents.map((r) => [r.key, r]));
  for (const rec of recs) {
    totalMonthly += rec.increaseDollarsMonthly;
    minPct = Math.min(minPct, rec.increasePct);
    maxPct = Math.max(maxPct, rec.increasePct);
    if (rec.increasePct > 1e-9) receiving++;
    if (rec.constraint === "min") atMin++;
    if (rec.constraint === "max") atMax++;
    if (rec.constraint === "street_cap" || rec.constraint === "at_or_above_street") blocked++;
    const w = byKey.get(rec.key)?.weight ?? 1;
    weightedNew += w * rec.newRateMonthly;
    weightTotal += w;
  }

  return {
    residentCount: recs.length,
    residentsReceivingIncrease: receiving,
    residentsAtMin: atMin,
    residentsAtMax: atMax,
    residentsBlockedByStreet: blocked,
    weightedAvgIncreasePct: currentAvg > 0 ? (weightedNew / weightTotal / currentAvg - 1) * 100 : 0,
    minIncreasePct: Number.isFinite(minPct) ? minPct : 0,
    maxIncreasePct: Number.isFinite(maxPct) ? maxPct : 0,
    totalMonthlyIncreaseDollars: totalMonthly,
    totalAnnualIncreaseDollars: totalMonthly * 12,
    currentAvgInhouseRateMonthly: currentAvg,
    newAvgInhouseRateMonthly: weightTotal > 0 ? weightedNew / weightTotal : currentAvg,
  };
}

function explainPlan(ctx: {
  planScope: PlanScope;
  assumptions: PlanningAssumptions;
  solved: ReturnType<typeof solvePlan>;
  summary: PlanSummary;
  currentStreetRateMonthly: number;
}): CalcExplanation {
  const { assumptions: a, solved, summary } = ctx;
  const steps: CalcExplanation["steps"] = [
    {
      label: "Growth target",
      value: formatPct(a.rateGrowthTargetPct),
      note: "Year-over-year growth in realized rate, tested quarter by quarter.",
    },
    {
      label: "Residents in scope",
      value: `${summary.residentCount}`,
      note: `Private-pay ${ctx.planScope.serviceLine} residents occupied in ${ctx.planScope.sourceMonth}.`,
    },
    {
      label: "Current average in-house rate",
      value: formatMoney(summary.currentAvgInhouseRateMonthly),
      note: "Resident-day weighted.",
    },
    {
      label: "Current street rate",
      value: formatMoney(ctx.currentStreetRateMonthly),
    },
    {
      label: "Recommended street rate",
      value: formatMoney(solved.recommendedStreetMonthly),
      note: `${formatPct(solved.streetIncrease * 100)} increase, effective ${a.streetRateEffectiveDate}. Every move-in from that date pays the new rate, and it is also the ceiling in-house rates may rise to.`,
    },
    {
      label: "Required average in-house increase",
      value: formatPct(solved.requiredAvgIncrease * 100, 2),
      note: `Effective ${a.inhouseEffectiveDate}. Weighted by resident-days and by each resident's current rate, so it reconciles exactly to the aggregate rate move.`,
    },
    {
      label: "Turnover assumption",
      value: formatPct(a.annualTurnoverPct),
      note: `Roughly ${(a.annualTurnoverPct / 12).toFixed(1)}% of residents replaced each month, entering at the street rate in force that day.`,
    },
    {
      label: "Total monthly increase",
      value: formatMoney(summary.totalMonthlyIncreaseDollars),
      note: `${formatMoney(summary.totalAnnualIncreaseDollars)} annualized.`,
    },
  ];

  const narrative: string[] = [];
  narrative.push(
    `Realized rate is projected forward from ${ctx.planScope.sourceMonth} as two groups: today's residents, who shrink at the turnover rate and receive the in-house increase on ${a.inhouseEffectiveDate}, and their replacements, who enter at whatever street rate applies on the day they move in.`,
  );
  narrative.push(
    `Each quarter's projection is compared with the same quarter a year earlier. The quarter with the least cushion sets the answer${solved.bindingQuarterLabel ? ` — here that is ${solved.bindingQuarterLabel}` : ""}.`,
  );
  if (summary.residentsBlockedByStreet > 0) {
    narrative.push(
      `${summary.residentsBlockedByStreet} of ${summary.residentCount} residents are held back by the street-rate ceiling rather than by the maximum increase. That is why the street rate and the in-house increase are solved together: lifting street is what creates room for them.`,
    );
  }
  if (!solved.feasible && solved.infeasibility) {
    narrative.push(solved.infeasibility.message);
  }
  return {
    headline: solved.feasible
      ? `${formatPct(a.rateGrowthTargetPct)} growth is achievable`
      : `${formatPct(a.rateGrowthTargetPct)} growth cannot be reached with these assumptions`,
    steps,
    narrative,
  };
}

function buildWarnings(ctx: {
  sourceMonth: string;
  excluded: { noRate: number; implausibleRate: number; noStreetRate: number; departingBeforeHorizon: number };
  baselineByQuarter: Map<string, BaselineQuarter>;
  quarters: QuarterRef[];
  quarterlyGrowthPct: number | null;
  residentsWithoutStreet: number;
  residentCount: number;
}): string[] {
  const warnings: string[] = [];
  const quarterMonthRanges = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];
  const describeQuarter = (q: BaselineQuarter) =>
    `${q.label} (${quarterMonthRanges[q.quarter - 1]} ${q.year})`;
  const [sourceYear, sourceMonthNumber] = ctx.sourceMonth.split("-").map(Number);
  const sourceMonthLabel =
    sourceYear && sourceMonthNumber
      ? `${new Date(Date.UTC(sourceYear, sourceMonthNumber - 1, 1)).toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC",
        })} ${sourceYear}`
      : ctx.sourceMonth;

  const projected = Array.from(ctx.baselineByQuarter.values()).filter((b) => b.basis === "projected");
  const partial = Array.from(ctx.baselineByQuarter.values()).filter((b) => b.basis === "partial");
  if (projected.length > 0) {
    warnings.push(
      `Prior-year baseline for ${projected.map(describeQuarter).join(", ")} is projected, not measured — the latest rent roll available for this scope is ${sourceMonthLabel}, before ${projected.length === 1 ? "that quarter" : "those quarters"}. Growth against ${projected.length === 1 ? "it" : "them"} is an estimate.`,
    );
  }
  if (partial.length > 0) {
    warnings.push(
      `Prior-year baseline for ${partial
        .map((p) => `${p.label} (${p.monthsAvailable} of 3 months)`)
        .join(", ")} is measured over an incomplete quarter.`,
    );
  }
  const untestable = ctx.quarters.filter((q) => {
    const b = ctx.baselineByQuarter.get(q.label);
    return !b || (b.realizedRateMonthly ?? 0) <= 0;
  });
  if (untestable.length > 0) {
    warnings.push(
      `${untestable.map((q) => q.label).join(", ")} ${untestable.length === 1 ? "has" : "have"} no prior-year rate to compare against and ${untestable.length === 1 ? "was" : "were"} left out of the feasibility test entirely.`,
    );
  }
  if (ctx.excluded.departingBeforeHorizon > 0) {
    warnings.push(
      `${ctx.excluded.departingBeforeHorizon} resident${ctx.excluded.departingBeforeHorizon === 1 ? " has a move-out date" : "s have move-out dates"} before the increase takes effect and ${ctx.excluded.departingBeforeHorizon === 1 ? "was" : "were"} left out of the plan.`,
    );
  }
  if (ctx.excluded.implausibleRate > 0) {
    warnings.push(
      `${ctx.excluded.implausibleRate} occupied row${ctx.excluded.implausibleRate === 1 ? "" : "s"} were excluded for an implausibly low in-house rate.`,
    );
  }
  if (ctx.excluded.noRate > 0) {
    warnings.push(
      `${ctx.excluded.noRate} occupied row${ctx.excluded.noRate === 1 ? "" : "s"} had no in-house rate and were excluded.`,
    );
  }
  if (ctx.residentsWithoutStreet > 0) {
    const share = Math.round((ctx.residentsWithoutStreet / ctx.residentCount) * 100);
    warnings.push(
      `${ctx.residentsWithoutStreet} resident${ctx.residentsWithoutStreet === 1 ? " has" : "s have"} no usable street rate (${share}%), so only the maximum increase limits them.`,
    );
  }
  return warnings;
}
