/**
 * In-House Rate Planning — the solver.
 *
 * Pure arithmetic. No database, no Express, no formatting decisions beyond the
 * operator-readable explanations, which are generated here on purpose so the
 * words an operator reads cannot drift away from the math that produced them.
 *
 * ── Joint optimization policy ────────────────────────────────────────────────
 * For every allowed Street-rate candidate, the solver finds the smallest
 * revenue-weighted in-house average that lets every measurable quarter reach
 * the growth target. It then selects the minimum combined Street and in-house
 * increase, subject to configured floors, ceilings, and portfolio guardrails.
 * The same objective applies to every service line; only the billing weight
 * basis differs between monthly senior housing and daily health care.
 *
 * ── Rate space ─────────────────────────────────────────────────────────────
 * Every rate in this file is a normalized MONTHLY rate. Callers convert HC and
 * HC/MC daily rates on the way in and back on the way out.
 */
import type {
  BaselineQuarter,
  CalcExplanation,
  EqualizationStrength,
  Infeasibility,
  PlanningAssumptions,
  PlanningResident,
  PlanningSignalAssessments,
  QuarterRef,
  QuarterResult,
  ResidentConstraint,
  TargetDeviationDiagnostic,
  TargetDeviationDriver,
  TargetDeviationQuarter,
} from "@shared/inhousePlanning";
import { formatMoney, formatPct } from "@shared/inhousePlanning";
import {
  MS_PER_DAY,
  isoToMs,
  quarterEndMs,
  quarterStartMs,
} from "./dates";

/** Percentage-point tolerance for "this quarter passes". */
const PASS_EPSILON = 1e-6;

/**
 * How far the allocation curve tilts toward residents with more headroom.
 * 0 gives every resident the same percentage; 1 makes the increase directly
 * proportional to the gap to street, closing one common share of every
 * resident's dollar gap. Values above 1 favor the deepest discounts more
 * aggressively. The spread is derived from the
 * configured min/max and the required average — deliberately not from
 * hard-coded percentage bands, which would silently ignore the operator's
 * own bounds.
 */
export const EQUALIZATION_EXPONENT: Record<EqualizationStrength, number> = {
  low: 0,
  // Medium now has a visible, centered spread too, so existing saved
  // service-line policies do not stay uniform just because they predate the
  // wider default. Low remains the explicit flat-allocation option.
  medium: 1.5,
  // The default policy uses high equalization so the resident increases have
  // a wider, still deterministic spread around the solved average. The
  // exponent only changes distribution; the calibration step below still
  // reconciles the weighted average exactly.
  high: 2,
};

/**
 * High equalization is meant to produce a visible catch-up curve, not merely
 * select the configured minimum when turnover makes that minimum sufficient
 * to clear the growth target. Use only a quarter of the remaining range in
 * that specific case; the tier maximum remains the hard ceiling and normal
 * target-fitting behavior is unchanged when the required average is above the
 * minimum.
 */
export const HIGH_EQUALIZATION_SPREAD_SHARE = 0.25;

// ───────────────────────────────────────────────────────────── projection ──

export interface ProjectionInput {
  /** First day the simulation runs, UTC ms. Normally the day after live data ends. */
  anchorMs: number;
  quarters: QuarterRef[];
  /** Resident-day-weighted average in-house rate of today's residents. */
  existingAvgRateMonthly: number;
  /** The same average after the planned increases land. */
  postIncreaseAvgRateMonthly: number;
  inhouseEffectiveMs: number;
  currentStreetMonthly: number;
  newStreetMonthly: number;
  streetEffectiveMs: number;
  /** Annual turnover as a fraction, e.g. 0.35. */
  annualTurnover: number;
  /** Monthly senior-housing rates weight each month equally; HC rates weight days. */
  weightBasis?: "resident_months" | "resident_days";
}

/**
 * Project the realized rate for each horizon quarter with a daily two-cohort
 * simulation: the residents who are here today, decaying at the turnover rate,
 * plus replacements entering at whatever street rate applies on the day they
 * move in.
 *
 * Census is held constant — every departure is backfilled the same day. This
 * is a rate-planning model, not an occupancy forecast, and letting census
 * drift would mix an occupancy assumption into a rate answer.
 *
 * Replacements do NOT receive the in-house increase: they enter at street,
 * which is already the higher number. That is the conservative reading and it
 * keeps the model honest about where the growth actually comes from.
 */
export function projectQuarterlyRealizedRates(
  input: ProjectionInput,
): Map<string, number> {
  const {
    anchorMs,
    quarters,
    existingAvgRateMonthly,
    postIncreaseAvgRateMonthly,
    inhouseEffectiveMs,
    currentStreetMonthly,
    newStreetMonthly,
    streetEffectiveMs,
    annualTurnover,
    weightBasis = "resident_days",
  } = input;

  const out = new Map<string, number>();
  if (quarters.length === 0) return out;

  const buckets = quarters.map((q) => ({
    label: q.label,
    startMs: quarterStartMs(q),
    endMs: quarterEndMs(q),
    sum: 0,
    weight: 0,
  }));

  const finalMs = Math.max(...buckets.map((b) => b.endMs));
  const startMs = Math.min(anchorMs, ...buckets.map((b) => b.startMs));

  // Turnover is an annual fraction; convert to a daily survival probability so
  // a mid-quarter effective date is weighted by the days it actually applies.
  const clampedTurnover = Math.min(Math.max(annualTurnover, 0), 0.999);
  const dailySurvival = Math.pow(1 - clampedTurnover, 1 / 365);

  let existingShare = 1;
  let existingRate = existingAvgRateMonthly;
  let replacementShare = 0;
  let replacementRate = 0;
  let increaseApplied = false;

  for (let day = startMs; day < finalMs; day += MS_PER_DAY) {
    if (!increaseApplied && day >= inhouseEffectiveMs) {
      existingRate = postIncreaseAvgRateMonthly;
      increaseApplied = true;
    }
    const streetToday = day >= streetEffectiveMs ? newStreetMonthly : currentStreetMonthly;

    const survivingExisting = existingShare * dailySurvival;
    const survivingReplacement = replacementShare * dailySurvival;
    const movedIn = Math.max(0, 1 - survivingExisting - survivingReplacement);

    const newReplacementShare = survivingReplacement + movedIn;
    replacementRate =
      newReplacementShare > 0
        ? (survivingReplacement * replacementRate + movedIn * streetToday) / newReplacementShare
        : 0;
    existingShare = survivingExisting;
    replacementShare = newReplacementShare;

    const dayRate = existingShare * existingRate + replacementShare * replacementRate;
    const dayDate = new Date(day);
    const daysInMonth = new Date(Date.UTC(
      dayDate.getUTCFullYear(),
      dayDate.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    // A monthly rate contributes one resident-month per calendar month. Daily
    // simulation is retained for turnover/effective-date precision, but the
    // month's daily slices sum to one rather than 28, 30, or 31.
    const observationWeight = weightBasis === "resident_months" ? 1 / daysInMonth : 1;

    for (const b of buckets) {
      if (day >= b.startMs && day < b.endMs) {
        b.sum += dayRate * observationWeight;
        b.weight += observationWeight;
        break;
      }
    }
  }

  for (const b of buckets) {
    out.set(b.label, b.weight > 0 ? b.sum / b.weight : existingAvgRateMonthly);
  }
  return out;
}

/**
 * The same simulation as projectQuarterlyRealizedRates, bucketed by calendar
 * month for the operator-facing trajectory chart.
 */
export function projectMonthlyRealizedRates(
  input: ProjectionInput,
  months: string[],
): Map<string, number> {
  const {
    anchorMs,
    existingAvgRateMonthly,
    postIncreaseAvgRateMonthly,
    inhouseEffectiveMs,
    currentStreetMonthly,
    newStreetMonthly,
    streetEffectiveMs,
    annualTurnover,
    weightBasis = "resident_days",
  } = input;
  const out = new Map<string, number>();
  if (months.length === 0) return out;
  const buckets = months.map((month) => {
    const [year, monthNumber] = month.split("-").map(Number);
    return {
      month,
      startMs: Date.UTC(year, monthNumber - 1, 1),
      endMs: Date.UTC(year, monthNumber, 1),
      sum: 0,
      weight: 0,
    };
  });
  const finalMs = Math.max(...buckets.map((b) => b.endMs));
  const startMs = Math.min(anchorMs, ...buckets.map((b) => b.startMs));
  const clampedTurnover = Math.min(Math.max(annualTurnover, 0), 0.999);
  const dailySurvival = Math.pow(1 - clampedTurnover, 1 / 365);
  let existingShare = 1;
  let existingRate = existingAvgRateMonthly;
  let replacementShare = 0;
  let replacementRate = 0;
  let increaseApplied = false;

  for (let day = startMs; day < finalMs; day += MS_PER_DAY) {
    if (!increaseApplied && day >= inhouseEffectiveMs) {
      existingRate = postIncreaseAvgRateMonthly;
      increaseApplied = true;
    }
    const streetToday = day >= streetEffectiveMs ? newStreetMonthly : currentStreetMonthly;
    const survivingExisting = existingShare * dailySurvival;
    const survivingReplacement = replacementShare * dailySurvival;
    const movedIn = Math.max(0, 1 - survivingExisting - survivingReplacement);
    const newReplacementShare = survivingReplacement + movedIn;
    replacementRate =
      newReplacementShare > 0
        ? (survivingReplacement * replacementRate + movedIn * streetToday) / newReplacementShare
        : 0;
    existingShare = survivingExisting;
    replacementShare = newReplacementShare;
    const dayRate = existingShare * existingRate + replacementShare * replacementRate;
    const date = new Date(day);
    const daysInMonth = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    const observationWeight = weightBasis === "resident_months" ? 1 / daysInMonth : 1;
    const bucket = buckets.find((b) => day >= b.startMs && day < b.endMs);
    if (bucket) {
      bucket.sum += dayRate * observationWeight;
      bucket.weight += observationWeight;
    }
  }
  for (const bucket of buckets) {
    out.set(
      bucket.month,
      bucket.weight > 0 ? bucket.sum / bucket.weight : existingAvgRateMonthly,
    );
  }
  return out;
}

// ───────────────────────────────────────────────────────────── allocation ──

export interface AllocationInput {
  residents: PlanningResident[];
  /** Weighted-average increase to reconcile to, as a fraction. */
  targetAvgIncrease: number;
  minIncrease: number;
  maxIncrease: number;
  strength: EqualizationStrength;
  allowAboveStreet: boolean;
  /** Street multiplier in force on the in-house effective date, e.g. 1.05. */
  streetMultiplier: number;
}

export interface ResidentAllocation {
  resident: PlanningResident;
  increase: number;
  constraint: ResidentConstraint;
  /** Headroom to street as a fraction of the current rate, floored at 0. */
  headroom: number;
  minEffective: number;
  maxEffective: number;
  /**
   * This resident's position on the equalization curve,
   * `(headroom / mean headroom) ^ exponent`. Exposed so an export can show the
   * increase as a derivation rather than an unexplained number.
   */
  shape: number;
}

export interface AllocationResult {
  allocations: ResidentAllocation[];
  /**
   * The calibration scalar the bisection settled on. Every resident's increase
   * is `clamp(lambda * shape, min, max)`, so this single number is what turns
   * the shape curve into actual percentages. Exposed because it is the one
   * value in the chain that has no closed form — an export can publish it as a
   * solved input and derive everything else from it.
   */
  lambda: number;
  /** Revenue-weighted average increase actually achieved, as a fraction. */
  achievedAvgIncrease: number;
  /** Smallest average the constraints permit (everyone at their floor). */
  minAvgIncrease: number;
  /** Largest average the constraints permit (everyone at their ceiling). */
  maxAvgIncrease: number;
  /** True when the achieved average could not reach the requested one. */
  clipped: boolean;
  /** True when high equalization intentionally moved off a binding minimum. */
  equalizationSpreadApplied: boolean;
}

interface ResidentBounds {
  resident: PlanningResident;
  headroom: number;
  minEffective: number;
  maxEffective: number;
  shape: number;
}

function computeBounds(input: AllocationInput): ResidentBounds[] {
  const { residents, minIncrease, maxIncrease, streetMultiplier, strength } = input;

  const raw = residents.map((r) => {
    const effectiveStreet = r.streetRateMonthly > 0 ? r.streetRateMonthly * streetMultiplier : 0;
    const headroom =
      effectiveStreet > 0 && r.currentRateMonthly > 0
        ? Math.max(0, effectiveStreet / r.currentRateMonthly - 1)
        : // No usable street rate means no evidence of a ceiling. Treat the
          // configured maximum as the only bound rather than inventing one.
          maxIncrease;

    // Street variance shapes the allocation but is not a ceiling: an existing
    // resident's contracted rate may legitimately finish above current street.
    const maxEffective = Math.max(0, maxIncrease);
    const minEffective = Math.min(Math.max(0, minIncrease), maxEffective);
    return { resident: r, headroom, minEffective, maxEffective, shape: 0 };
  });

  // Shape factor: how much more than average a resident's increase leans on
  // their headroom. Normalized by the revenue-weighted mean headroom so the
  // curve is scale-free and `lambda` reads as "the average increase".
  const exponent = EQUALIZATION_EXPONENT[strength] ?? 0.5;
  let weightedHeadroom = 0;
  let weightBase = 0;
  for (const b of raw) {
    const w = b.resident.weight * b.resident.currentRateMonthly;
    weightedHeadroom += w * b.headroom;
    weightBase += w;
  }
  const meanHeadroom = weightBase > 0 ? weightedHeadroom / weightBase : 0;

  for (const b of raw) {
    if (exponent === 0 || meanHeadroom <= 0) {
      b.shape = 1;
    } else {
      // Street variance controls who receives the larger increase; it is not
      // an eligibility gate. A literal zero shape made residents at/above
      // street permanently unable to move beyond the minimum while the solver
      // still counted their configured maximum as achievable. Keep a tiny
      // positive weight so the allocation can reach every resident's allowed
      // maximum when the aggregate target requires it.
      b.shape = Math.max(1e-6, Math.pow(b.headroom / meanHeadroom, exponent));
    }
  }
  return raw;
}

function weightedAverage(
  bounds: ResidentBounds[],
  valueOf: (b: ResidentBounds) => number,
): number {
  let num = 0;
  let den = 0;
  for (const b of bounds) {
    // Revenue weighting, so the average reconciles to the aggregate rate move:
    //   Rbar_after / Rbar_before - 1 = Σ w·r·x / Σ w·r
    const w = b.resident.weight * b.resident.currentRateMonthly;
    num += w * valueOf(b);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Spread a required aggregate increase across residents.
 *
 * Residents further below street receive the larger percentages, but the
 * curve is calibrated by a single scalar so the resident-day, revenue-weighted
 * result reconciles back to the required aggregate. Mapping the biggest gap
 * straight to the maximum would overshoot the aggregate and quietly change the
 * answer the operator was shown.
 */
export function allocateIncreases(input: AllocationInput): AllocationResult {
  const bounds = computeBounds(input);
  const minAvg = weightedAverage(bounds, (b) => b.minEffective);
  const maxAvg = weightedAverage(bounds, (b) => b.maxEffective);

  const boundedRequestedTarget = Math.min(
    Math.max(input.targetAvgIncrease, minAvg),
    maxAvg,
  );
  const equalizationSpreadApplied =
    input.strength === "high" &&
    maxAvg > minAvg + 1e-12 &&
    boundedRequestedTarget <= minAvg + 1e-9;
  const target = equalizationSpreadApplied
    ? minAvg + (maxAvg - minAvg) * HIGH_EQUALIZATION_SPREAD_SHARE
    : boundedRequestedTarget;
  const clipped = Math.abs(boundedRequestedTarget - input.targetAvgIncrease) > 1e-9;

  const avgAt = (lambda: number) =>
    weightedAverage(bounds, (b) => clamp(lambda * b.shape, b.minEffective, b.maxEffective));

  let lambda = 0;
  if (maxAvg > minAvg + 1e-12 && target > minAvg + 1e-12) {
    let lo = 0;
    let hi = Math.max(input.maxIncrease, 0.01);
    let guard = 0;
    while (avgAt(hi) < target && guard++ < 60) hi *= 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (avgAt(mid) < target) lo = mid;
      else hi = mid;
    }
    lambda = (lo + hi) / 2;
  }

  const allocations: ResidentAllocation[] = bounds.map((b) => {
    const value = clamp(lambda * b.shape, b.minEffective, b.maxEffective);
    return {
      resident: b.resident,
      increase: value,
      constraint: classify(b, value, input),
      headroom: b.headroom,
      minEffective: b.minEffective,
      maxEffective: b.maxEffective,
      shape: b.shape,
    };
  });

  return {
    allocations,
    lambda,
    achievedAvgIncrease: weightedAverage(bounds, (b) =>
      clamp(lambda * b.shape, b.minEffective, b.maxEffective),
    ),
    minAvgIncrease: minAvg,
    maxAvgIncrease: maxAvg,
    clipped,
    equalizationSpreadApplied,
  };
}

function classify(
  b: ResidentBounds,
  value: number,
  input: AllocationInput,
): ResidentConstraint {
  if (value >= b.maxEffective - 1e-9) {
    return "max";
  }
  if (value <= b.minEffective + 1e-9 && b.minEffective > 0) return "min";
  return "none";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ─────────────────────────────────────────────────────────────── the solve ──

export interface SolveInput {
  residents: PlanningResident[];
  assumptions: PlanningAssumptions;
  /** Prior-year realized rate for each horizon quarter, keyed by the horizon quarter's label. */
  baselineByQuarter: Map<string, BaselineQuarter>;
  quarters: QuarterRef[];
  anchorMs: number;
  currentStreetRateMonthly: number;
  /** Average street rate in January of the year before the proposal. */
  priorJanuaryStreetRateMonthly?: number;
  /** Matched Top Competitor benchmark for this exact scope, normalized monthly. */
  topCompetitorRateMonthly?: number | null;
  /** Enforce a 1% Street-over-in-house floor for a portfolio service-line aggregate. */
  enforcePortfolioStreetPremium?: boolean;
  /** Monthly for AL/AL-MC/SL/VIL, daily for HC/HC-MC. */
  rateWeightBasis?: "resident_months" | "resident_days";
  /**
   * Validated provenance is carried through the solve so explanations can
   * disclose it. Both signals are intentionally neutral until a documented
   * pricing effect exists; raw feed values never alter recommendations.
   */
  planningSignals?: PlanningSignalAssessments;
}

export interface SolveOutput {
  feasible: boolean;
  streetIncrease: number;
  recommendedStreetMonthly: number;
  requiredAvgIncrease: number;
  allocation: AllocationResult;
  quarterResults: QuarterResult[];
  bindingQuarterLabel: string | null;
  infeasibility: Infeasibility | null;
  existingAvgRateMonthly: number;
  postIncreaseAvgRateMonthly: number;
  /** Plain-language reason when guardrails or market preferences affect the fit. */
  optimizationNote: string | null;
  targetDeviationDiagnostic: TargetDeviationDiagnostic;
  /** Performance diagnostics for the bounded joint search. */
  jointCandidateCount: number;
  projectionModelCount: number;
}

interface EvalContext {
  input: SolveInput;
  min: number;
  max: number;
  target: number;
  inhouseMs: number;
  streetMs: number;
  turnover: number;
  baseAvg: number;
}

interface DeviationSummary {
  quarters: TargetDeviationQuarter[];
  maximumQuarterDeviationPct: number;
  maximumQuarterLabel: string | null;
  cumulativeDeviationPct: number;
}

function buildContext(input: SolveInput): EvalContext {
  const a = input.assumptions;
  const baseAvg = residentDayWeightedAverageRate(input.residents);
  return {
    input,
    min: a.minInhouseIncreasePct / 100,
    max: a.maxInhouseIncreasePct / 100,
    target: a.rateGrowthTargetPct / 100,
    inhouseMs: isoToMs(a.inhouseEffectiveDate),
    streetMs: isoToMs(a.streetRateEffectiveDate),
    turnover: a.annualTurnoverPct / 100,
    baseAvg,
  };
}

/** Resident-day-weighted average of the current in-house rates. */
export function residentDayWeightedAverageRate(residents: PlanningResident[]): number {
  let num = 0;
  let den = 0;
  for (const r of residents) {
    num += r.weight * r.currentRateMonthly;
    den += r.weight;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Asking-rate average over the exact resident cohort and weights used by the
 * in-house average. A zero result means at least one resident has no usable
 * product-matched Street Rate; callers must not silently change the denominator
 * by dropping that room from only the Street side.
 */
export function residentWeightedAverageStreetRate(
  residents: PlanningResident[],
): number {
  let num = 0;
  let den = 0;
  for (const r of residents) {
    if (!(r.streetRateMonthly > 0)) return 0;
    num += r.weight * r.streetRateMonthly;
    den += r.weight;
  }
  return den > 0 ? num / den : 0;
}

function allocationFor(ctx: EvalContext, streetIncrease: number, avgIncrease: number) {
  // The cap a resident faces is the street rate in force on the day their
  // in-house increase lands — which is why the street effective date matters
  // to the allocation and not only to the projection.
  const streetActiveAtInhouse = ctx.streetMs <= ctx.inhouseMs;
  return allocateIncreases({
    residents: ctx.input.residents,
    targetAvgIncrease: avgIncrease,
    minIncrease: ctx.min,
    maxIncrease: ctx.max,
    strength: ctx.input.assumptions.equalizationStrength,
    allowAboveStreet: true,
    streetMultiplier: streetActiveAtInhouse ? 1 + streetIncrease : 1,
  });
}

interface ProjectionCoefficient {
  label: string;
  existingBeforeIncrease: number;
  existingAfterIncrease: number;
  currentStreet: number;
  newStreet: number;
}

/**
 * The daily cohort simulation is affine in the pre/post in-house rates and
 * the current/proposed Street rates. Build those coefficients once per Street
 * candidate so the in-house bisection is arithmetic-only.
 */
function buildProjectionModel(ctx: EvalContext, streetIncrease: number): ProjectionCoefficient[] {
  const buckets = ctx.input.quarters.map((q) => ({
    label: q.label,
    startMs: quarterStartMs(q),
    endMs: quarterEndMs(q),
    existingBeforeIncrease: 0,
    existingAfterIncrease: 0,
    currentStreet: 0,
    newStreet: 0,
    weight: 0,
  }));
  if (buckets.length === 0) return [];
  const finalMs = Math.max(...buckets.map((b) => b.endMs));
  const startMs = Math.min(ctx.input.anchorMs, ...buckets.map((b) => b.startMs));
  const dailySurvival = Math.pow(1 - Math.min(Math.max(ctx.turnover, 0), 0.999), 1 / 365);
  let existingShare = 1;
  let replacementShare = 0;
  let replacementCurrentStreet = 0;
  let replacementNewStreet = 0;
  let increaseApplied = false;

  for (let day = startMs; day < finalMs; day += MS_PER_DAY) {
    if (!increaseApplied && day >= ctx.inhouseMs) increaseApplied = true;
    const survivingExisting = existingShare * dailySurvival;
    const survivingReplacement = replacementShare * dailySurvival;
    const movedIn = Math.max(0, 1 - survivingExisting - survivingReplacement);
    const newReplacementShare = survivingReplacement + movedIn;
    const entersAtNewStreet = day >= ctx.streetMs;
    replacementCurrentStreet =
      newReplacementShare > 0
        ? (survivingReplacement * replacementCurrentStreet + (entersAtNewStreet ? 0 : movedIn)) /
          newReplacementShare
        : 0;
    replacementNewStreet =
      newReplacementShare > 0
        ? (survivingReplacement * replacementNewStreet + (entersAtNewStreet ? movedIn : 0)) /
          newReplacementShare
        : 0;
    existingShare = survivingExisting;
    replacementShare = newReplacementShare;

    const date = new Date(day);
    const daysInMonth = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    const observationWeight = ctx.input.rateWeightBasis === "resident_months" ? 1 / daysInMonth : 1;
    for (const bucket of buckets) {
      if (day < bucket.startMs || day >= bucket.endMs) continue;
      if (increaseApplied) bucket.existingAfterIncrease += existingShare * observationWeight;
      else bucket.existingBeforeIncrease += existingShare * observationWeight;
      bucket.currentStreet += replacementShare * replacementCurrentStreet * observationWeight;
      bucket.newStreet += replacementShare * replacementNewStreet * observationWeight;
      bucket.weight += observationWeight;
      break;
    }
  }

  return buckets.map(({ label, weight, existingBeforeIncrease, existingAfterIncrease, currentStreet, newStreet }) => ({
    label,
    existingBeforeIncrease: weight > 0 ? existingBeforeIncrease / weight : 1,
    existingAfterIncrease: weight > 0 ? existingAfterIncrease / weight : 0,
    currentStreet: weight > 0 ? currentStreet / weight : 0,
    newStreet: weight > 0 ? newStreet / weight : 0,
  }));
}

function projectFromModel(
  ctx: EvalContext,
  streetIncrease: number,
  avgIncrease: number,
  model: ProjectionCoefficient[],
) {
  const postIncreaseRate = ctx.baseAvg * (1 + avgIncrease);
  const newStreetRate = ctx.input.currentStreetRateMonthly * (1 + streetIncrease);
  return new Map(
    model.map((coefficient) => [
      coefficient.label,
      coefficient.existingBeforeIncrease * ctx.baseAvg +
        coefficient.existingAfterIncrease * postIncreaseRate +
        coefficient.currentStreet * ctx.input.currentStreetRateMonthly +
        coefficient.newStreet * newStreetRate,
    ]),
  );
}

function projectFor(ctx: EvalContext, streetIncrease: number, avgIncrease: number) {
  return projectFromModel(ctx, streetIncrease, avgIncrease, buildProjectionModel(ctx, streetIncrease));
}

/** Worst (most negative) margin of projected growth over the target, in fractions. */
function worstMargin(
  ctx: EvalContext,
  projected: Map<string, number>,
): { margin: number; label: string | null } {
  let worst = Number.POSITIVE_INFINITY;
  let label: string | null = null;
  for (const q of ctx.input.quarters) {
    const base = ctx.input.baselineByQuarter.get(q.label);
    if (!base || base.realizedRateMonthly == null || base.realizedRateMonthly <= 0) continue;
    const proj = projected.get(q.label);
    if (proj == null) continue;
    const growth = proj / base.realizedRateMonthly - 1;
    const margin = growth - ctx.target;
    if (margin < worst) {
      worst = margin;
      label = q.label;
    }
  }
  if (!Number.isFinite(worst)) return { margin: 0, label: null };
  return { margin: worst, label };
}

/**
 * Smallest average increase that clears the target at this street increase.
 *
 * Solved against the target EXACTLY, with no tolerance: the reporting
 * tolerance is applied later, and letting it leak in here returns an answer
 * that then re-projects a hair short and reads as infeasible.
 */
function requiredAvgIncreaseAt(
  ctx: EvalContext,
  streetIncrease: number,
  ceiling: number,
  model = buildProjectionModel(ctx, streetIncrease),
): number {
  const passesAt = (x: number) =>
    worstMargin(ctx, projectFromModel(ctx, streetIncrease, x, model)).margin >= 0;
  if (passesAt(0)) return 0;
  let lo = 0;
  let hi = Math.max(ceiling, 0.01);
  let guard = 0;
  while (!passesAt(hi) && guard++ < 40) hi *= 2;
  if (!passesAt(hi)) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (passesAt(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

interface JointCandidate {
  streetIncrease: number;
  allocation: AllocationResult;
  projected: Map<string, number>;
  worst: { margin: number; label: string | null };
  feasible: boolean;
  overshoot: number;
  maxOvershoot: number;
  shortfall: number;
  marketPenalty: number;
  portfolioPremiumDeficit: number;
}

/**
 * Evaluate one complete in-house/Street combination. The in-house value is
 * solved from the projected quarterly result, not from a zero-turnover
 * approximation. This is the unit the joint optimizer compares.
 */
function evaluateJointCandidate(
  ctx: EvalContext,
  streetIncrease: number,
  marketPenalty: (g: number, avg: number) => number,
): JointCandidate {
  const model = buildProjectionModel(ctx, streetIncrease);
  const requiredResidentAvg = requiredAvgIncreaseAt(ctx, streetIncrease, ctx.max, model);
  const residentTargetAvg = Math.max(ctx.min, Math.min(ctx.max, requiredResidentAvg));
  const allocation = allocationFor(ctx, streetIncrease, residentTargetAvg);
  const projected = projectFromModel(ctx, streetIncrease, allocation.achievedAvgIncrease, model);
  const worst = worstMargin(ctx, projected);
  const portfolioPremiumDeficit =
    ctx.input.enforcePortfolioStreetPremium && ctx.input.currentStreetRateMonthly > 0
      ? Math.max(
          0,
          (ctx.baseAvg * (1 + allocation.achievedAvgIncrease) * 1.01) /
              ctx.input.currentStreetRateMonthly -
            1 -
            streetIncrease,
        )
      : 0;
  let overshoot = 0;
  let maxOvershoot = 0;
  let shortfall = 0;
  for (const q of ctx.input.quarters) {
    const base = ctx.input.baselineByQuarter.get(q.label);
    const projectedRate = projected.get(q.label);
    if (!base || base.realizedRateMonthly == null || base.realizedRateMonthly <= 0 || projectedRate == null) {
      continue;
    }
    const deviation = projectedRate / base.realizedRateMonthly - 1 - ctx.target;
    if (deviation >= 0) {
      overshoot += deviation;
      maxOvershoot = Math.max(maxOvershoot, deviation);
    }
    else shortfall += -deviation;
  }
  return {
    streetIncrease,
    allocation,
    projected,
    worst,
    feasible: worst.label === null || worst.margin >= -PASS_EPSILON,
    overshoot,
    maxOvershoot,
    shortfall,
    marketPenalty: marketPenalty(streetIncrease, allocation.achievedAvgIncrease),
    portfolioPremiumDeficit,
  };
}

function summarizeDeviations(
  ctx: EvalContext,
  projected: Map<string, number>,
): DeviationSummary {
  let maximumQuarterDeviationPct = 0;
  let maximumQuarterLabel: string | null = null;
  let cumulativeDeviationPct = 0;
  const quarters = ctx.input.quarters.map((q): TargetDeviationQuarter => {
    const base = ctx.input.baselineByQuarter.get(q.label);
    const prior = base?.realizedRateMonthly ?? null;
    const projectedRate = projected.get(q.label) ?? 0;
    const requiredRate = prior != null ? prior * (1 + ctx.target) : 0;
    const testable = prior != null && prior > 0 && projected.has(q.label);
    const deviationPct = testable
      ? (projectedRate / prior! - 1 - ctx.target) * 100
      : null;
    const overshootPct = deviationPct != null ? Math.max(0, deviationPct) : 0;
    const shortfallPct = deviationPct != null ? Math.min(0, deviationPct) : 0;
    if (overshootPct > maximumQuarterDeviationPct) {
      maximumQuarterDeviationPct = overshootPct;
      maximumQuarterLabel = q.label;
    }
    cumulativeDeviationPct += overshootPct;
    return {
      label: q.label,
      priorYearRateMonthly: prior,
      requiredRateMonthly: requiredRate,
      projectedRateMonthly: projectedRate,
      deviationPct,
      overshootPct,
      shortfallPct,
      testable,
    };
  });
  return {
    quarters,
    maximumQuarterDeviationPct,
    maximumQuarterLabel,
    cumulativeDeviationPct,
  };
}

function differenceBetween(
  actual: DeviationSummary,
  counterfactual: DeviationSummary,
): Pick<TargetDeviationDriver, "maximumQuarterContributionPct" | "cumulativeContributionPct"> {
  return {
    maximumQuarterContributionPct:
      (actual.maximumQuarterDeviationPct - counterfactual.maximumQuarterDeviationPct),
    cumulativeContributionPct:
      (actual.cumulativeDeviationPct - counterfactual.cumulativeDeviationPct),
  };
}

function counterfactualDriver(
  id: TargetDeviationDriver["id"],
  label: string,
  actual: DeviationSummary,
  counterfactual: DeviationSummary | null,
  status: TargetDeviationDriver["status"],
  note: string,
): TargetDeviationDriver {
  const contribution = counterfactual ? differenceBetween(actual, counterfactual) : null;
  return {
    id,
    label,
    status,
    maximumQuarterContributionPct: contribution?.maximumQuarterContributionPct ?? null,
    cumulativeContributionPct: contribution?.cumulativeContributionPct ?? null,
    note,
  };
}

function directionalEffectStatus(
  actual: DeviationSummary,
  counterfactual: DeviationSummary | null,
  applicable: boolean,
): TargetDeviationDriver["status"] {
  if (!applicable) return "not_applicable";
  if (!counterfactual) return "not_binding";
  const cumulativeContribution =
    actual.cumulativeDeviationPct - counterfactual.cumulativeDeviationPct;
  if (cumulativeContribution > 1e-6) return "contributing";
  if (cumulativeContribution < -1e-6) return "mitigating";
  return "not_binding";
}

function buildTargetDeviationDiagnostic(
  ctx: EvalContext,
  streetIncrease: number,
  allocation: AllocationResult,
  projected: Map<string, number>,
  configuredMinimum: number,
  ordinaryCeiling: number,
  ceilStreet: number,
  competitivePreference: number,
): TargetDeviationDiagnostic {
  const actual = summarizeDeviations(ctx, projected);
  const model = buildProjectionModel(ctx, streetIncrease);
  const maxAvgAt = allocationFor(ctx, streetIncrease, Number.POSITIVE_INFINITY).maxAvgIncrease;
  const requiredWithoutResidentGuardrails = requiredAvgIncreaseAt(
    ctx,
    streetIncrease,
    Math.max(maxAvgAt, ctx.max),
    model,
  );
  const withoutResidentGuardrails = summarizeDeviations(
    ctx,
    projectFromModel(ctx, streetIncrease, requiredWithoutResidentGuardrails, model),
  );
  const guardrailsBinding =
    allocation.clipped ||
    maxAvgAt < ctx.max - 1e-6 ||
    allocation.allocations.some((a) => a.constraint !== "none");

  const streetBoundsBinding =
    (configuredMinimum > 0 && Math.abs(streetIncrease - configuredMinimum) < 1e-6) ||
    (Math.abs(streetIncrease - ceilStreet) < 1e-6 &&
      (ceilStreet < ordinaryCeiling - 1e-6 || ordinaryCeiling <= ceilStreet + 1e-6));
  const withoutStreetMinimum =
    configuredMinimum > 0 && Math.abs(streetIncrease - configuredMinimum) < 1e-6
      ? summarizeDeviations(
          ctx,
          projectFromModel(
            ctx,
            0,
            allocation.achievedAvgIncrease,
            buildProjectionModel(ctx, 0),
          ),
        )
      : null;

  const timingCounterfactual = summarizeDeviations(
    ctx,
    new Map(
      projectQuarterlyRealizedRates({
        anchorMs: ctx.input.anchorMs,
        quarters: ctx.input.quarters,
        existingAvgRateMonthly: ctx.baseAvg,
        postIncreaseAvgRateMonthly: ctx.baseAvg * (1 + allocation.achievedAvgIncrease),
        // "No timing effect" means both changes happen as soon as the
        // projection starts, not at an arbitrary quarter boundary. This
        // preserves the plan's pre-horizon history while removing only the
        // delay represented by the two effective dates.
        inhouseEffectiveMs: ctx.input.anchorMs,
        currentStreetMonthly: ctx.input.currentStreetRateMonthly,
        newStreetMonthly: ctx.input.currentStreetRateMonthly * (1 + streetIncrease),
        streetEffectiveMs: ctx.input.anchorMs,
        annualTurnover: ctx.turnover,
        weightBasis: ctx.input.rateWeightBasis,
      }),
    ),
  );

  const turnoverCounterfactual = summarizeDeviations(
    ctx,
    new Map(
      projectQuarterlyRealizedRates({
        anchorMs: ctx.input.anchorMs,
        quarters: ctx.input.quarters,
        existingAvgRateMonthly: ctx.baseAvg,
        postIncreaseAvgRateMonthly: ctx.baseAvg * (1 + allocation.achievedAvgIncrease),
        inhouseEffectiveMs: ctx.inhouseMs,
        currentStreetMonthly: ctx.input.currentStreetRateMonthly,
        newStreetMonthly: ctx.input.currentStreetRateMonthly * (1 + streetIncrease),
        streetEffectiveMs: ctx.streetMs,
        annualTurnover: 0,
        weightBasis: ctx.input.rateWeightBasis,
      }),
    ),
  );

  const competitionApplies =
    ctx.input.topCompetitorRateMonthly != null &&
    ctx.input.topCompetitorRateMonthly > 0 &&
    competitivePreference > configuredMinimum + 1e-6 &&
    Math.abs(streetIncrease - competitivePreference) < 1e-6;
  const withoutCompetition = competitionApplies
    ? summarizeDeviations(
        ctx,
        projectFromModel(
          ctx,
          configuredMinimum,
          allocation.achievedAvgIncrease,
          buildProjectionModel(ctx, configuredMinimum),
        ),
      )
    : null;

  const drivers: TargetDeviationDriver[] = [
    counterfactualDriver(
      "resident_guardrails",
      "Resident increase guardrails",
      actual,
      withoutResidentGuardrails,
      guardrailsBinding ? "binding" : "not_binding",
      guardrailsBinding
        ? "At least one resident floor or ceiling changes the aggregate increase available to the quarterly projection."
        : "The selected average increase is reachable without clipping against a resident floor or ceiling.",
    ),
    counterfactualDriver(
      "street_bounds",
      "Street minimum / ceiling",
      actual,
      withoutStreetMinimum,
      streetBoundsBinding ? "binding" : "not_binding",
      streetBoundsBinding
        ? streetIncrease <= configuredMinimum + 1e-6
          ? `The configured Street minimum of ${formatPct(configuredMinimum * 100, 2)} sets the selected Street path.`
          : `The Street ceiling of ${formatPct(ceilStreet * 100, 2)} sets the selected Street path.`
        : "Neither the configured Street minimum nor the effective Street ceiling sets the selected candidate.",
    ),
    counterfactualDriver(
      "effective_date_timing",
      "Effective-date timing",
      actual,
      timingCounterfactual,
      directionalEffectStatus(actual, timingCounterfactual, true),
      `The in-house change starts ${ctx.input.assumptions.inhouseEffectiveDate}; the Street change starts ${ctx.input.assumptions.streetRateEffectiveDate}. The comparison removes only their delay from the modeled start date.`,
    ),
    counterfactualDriver(
      "competition",
      "Competitive-position preference",
      actual,
      withoutCompetition,
      directionalEffectStatus(
        actual,
        withoutCompetition,
        ctx.input.topCompetitorRateMonthly != null,
      ),
      competitionApplies
        ? `The selected Street increase follows the matched Top Competitor preference of ${formatPct(competitivePreference * 100, 2)}.`
        : ctx.input.topCompetitorRateMonthly == null
          ? "No matched Top Competitor benchmark applies to this scope."
          : "The competitive preference did not set the selected Street candidate.",
    ),
    counterfactualDriver(
      "turnover_replacement_street",
      "Turnover / replacement Street Rates",
      actual,
      turnoverCounterfactual,
      directionalEffectStatus(actual, turnoverCounterfactual, ctx.turnover > 0),
      ctx.turnover > 0
        ? `Replacements enter at the Street Rate in force on each modeled move-in date under ${formatPct(ctx.input.assumptions.annualTurnoverPct, 2)} annual turnover.`
        : "No turnover is modeled, so replacements do not contribute to the projection.",
    ),
  ];

  return {
    maximumQuarterDeviationPct: actual.maximumQuarterDeviationPct,
    maximumQuarterLabel: actual.maximumQuarterLabel,
    cumulativeDeviationPct: actual.cumulativeDeviationPct,
    quarters: actual.quarters,
    drivers,
  };
}

/**
 * Compare complete Street/in-house combinations:
 *   1. achieve every testable quarter when possible;
 *   2. minimize the combined Street and in-house increases;
 *   3. minimize any unavoidable excess above target;
 *   4. preserve supported market positioning.
 */
function betterJointCandidate(a: JointCandidate, b: JointCandidate): boolean {
  if (a.feasible !== b.feasible) return a.feasible;
  if (!a.feasible && Math.abs(a.worst.margin - b.worst.margin) > 1e-8) {
    return a.worst.margin > b.worst.margin;
  }
  if (a.feasible) {
    const premiumA = a.portfolioPremiumDeficit <= 1e-8;
    const premiumB = b.portfolioPremiumDeficit <= 1e-8;
    if (premiumA !== premiumB) return premiumA;
    if (!premiumA && Math.abs(a.portfolioPremiumDeficit - b.portfolioPremiumDeficit) > 1e-8) {
      return a.portfolioPremiumDeficit < b.portfolioPremiumDeficit;
    }
    const combinedA = a.streetIncrease + a.allocation.achievedAvgIncrease;
    const combinedB = b.streetIncrease + b.allocation.achievedAvgIncrease;
    if (Math.abs(combinedA - combinedB) > 1e-8) return combinedA < combinedB;
  }
  if (a.feasible && Math.abs(a.maxOvershoot - b.maxOvershoot) > 0.0005) {
    return a.maxOvershoot < b.maxOvershoot;
  }
  const fitA = a.feasible ? a.overshoot : a.shortfall;
  const fitB = b.feasible ? b.overshoot : b.shortfall;
  const TARGET_FIT_TOLERANCE = 0.0025;
  if (Math.abs(fitA - fitB) > TARGET_FIT_TOLERANCE) return fitA < fitB;
  if (Math.abs(a.marketPenalty - b.marketPenalty) > 1e-8) {
    return a.marketPenalty < b.marketPenalty;
  }
  return a.streetIncrease < b.streetIncrease - 1e-8;
}

export function solvePlan(input: SolveInput): SolveOutput {
  const ctx = buildContext(input);
  const currentStreet = input.currentStreetRateMonthly;
  const ordinaryCeiling = Math.max(0, input.assumptions.maxStreetIncreasePct / 100);
  const priorJanuaryStreet = input.priorJanuaryStreetRateMonthly;
  // Translate the absolute January-to-January ceiling into the maximum additional
  // increase available from today's rate. If today's rate is already at or
  // above that ceiling, the solver gets no permission to push it further.
  const yoyCeiling =
    priorJanuaryStreet != null && priorJanuaryStreet > 0 && currentStreet > 0
      ? Math.max(
          0,
          (priorJanuaryStreet * (1 + input.assumptions.maxYoYStreetIncreasePct / 100)) /
              currentStreet -
            1,
        )
      : ordinaryCeiling;
  const ceilStreet = Math.min(ordinaryCeiling, yoyCeiling);
  const configuredMinimum = Math.max(0, input.assumptions.minStreetIncreasePct / 100);
  const desiredCompetitiveRate =
    input.topCompetitorRateMonthly != null && input.topCompetitorRateMonthly > 0
      ? input.topCompetitorRateMonthly *
        (1 + input.assumptions.desiredVarianceToTopCompetitorPct / 100)
      : null;
  // The competitor position is a directional floor, never a ceiling. A scope
  // further below its desired position is pushed more; a scope already above
  // it is not reduced or prevented from increasing further when the growth
  // objective requires it.
  const competitivePush =
    desiredCompetitiveRate != null && currentStreet > 0
      ? Math.max(0, desiredCompetitiveRate / currentStreet - 1)
      : 0;
  // Competitive position may pull the asking rate up, but only as far as the
  // growth objective. Chasing a competitive gap beyond the objective is what
  // let Street Rate run away from the in-house increase and left the
  // guaranteed lever sitting on its configured minimum.
  const competitivePreference = Math.min(competitivePush, Math.max(0, ctx.target));
  const marketFloor = Math.min(
    Math.max(0, configuredMinimum, competitivePreference),
    ceilStreet,
  );

  /** Best average increase the guardrails permit at a given street increase. */
  const maxAvgAt = (g: number) => allocationFor(ctx, g, Number.POSITIVE_INFINITY).maxAvgIncrease;
  const marketPenalty = (g: number, avg: number): number => {
    // Competitive position and the portfolio premium are preferences. They are
    // deliberately scaled below the target-fit objective so neither can create
    // unsupported growth merely to make a relationship look tidy.
    const competitorPenalty =
      input.topCompetitorRateMonthly != null && input.topCompetitorRateMonthly > 0
        ? Math.abs(g - competitivePreference) * 0.5
        : 0;
    const premiumDeficit =
      input.enforcePortfolioStreetPremium && currentStreet > 0
        ? Math.max(0, (ctx.baseAvg * (1 + avg) * 1.01) / currentStreet - 1 - g)
        : 0;
    return competitorPenalty + premiumDeficit;
  };

  const SEARCH_STEPS = 300;
  const searchStart = Math.min(Math.max(0, configuredMinimum), ceilStreet);
  const candidates = new Set<number>([
    searchStart,
    Math.max(searchStart, Math.min(marketFloor, ceilStreet)),
    Math.max(searchStart, Math.min(competitivePreference, ceilStreet)),
    Math.max(searchStart, Math.min(competitivePush, ceilStreet)),
    Math.max(0, ceilStreet),
  ]);
  for (let i = 0; i <= SEARCH_STEPS; i++) {
    candidates.add(searchStart + ((ceilStreet - searchStart) * i) / SEARCH_STEPS);
  }
  let best: JointCandidate | null = null;
  for (const streetIncrease of Array.from(candidates)) {
    const candidate = evaluateJointCandidate(
      ctx,
      streetIncrease,
      marketPenalty,
    );
    if (best == null || betterJointCandidate(candidate, best)) best = candidate;
  }
  // The candidate set always contains at least the configured minimum and the
  // hard ceiling. This guard keeps the failure explicit if that invariant ever
  // changes during a future refactor.
  if (!best) throw new Error("Rate planning Street optimization produced no candidates.");

  const streetIncrease = best.streetIncrease;
  const finalAllocation = best.allocation;
  const projected = best.projected;
  const feasible = best.feasible;
  const appliedAvg = finalAllocation.achievedAvgIncrease;
  const worst = best.worst;

  const quarterResults = buildQuarterResults(ctx, projected, worst.label, streetIncrease, appliedAvg);
  const targetDeviationDiagnostic = buildTargetDeviationDiagnostic(
    ctx,
    streetIncrease,
    finalAllocation,
    projected,
    configuredMinimum,
    ordinaryCeiling,
    ceilStreet,
    competitivePreference,
  );

  const infeasibility = feasible
    ? null
    : buildInfeasibility(ctx, streetIncrease, ceilStreet, finalAllocation, projected, worst);
  const optimizationDrivers: string[] = [];
  const maxAllowedAvg = maxAvgAt(streetIncrease);
  if (finalAllocation.clipped || maxAllowedAvg < ctx.max - 1e-6) {
    optimizationDrivers.push("resident increase guardrails");
  }
  if (finalAllocation.equalizationSpreadApplied) {
    optimizationDrivers.push("high equalization catch-up spread");
  }
  if (configuredMinimum > 0 && Math.abs(streetIncrease - configuredMinimum) < 1e-6) {
    optimizationDrivers.push("the configured Street minimum");
  }
  if (Math.abs(streetIncrease - ceilStreet) < 1e-6) {
    optimizationDrivers.push("the Street or January-to-January ceiling");
  }
  if (ctx.turnover > 0 && input.currentStreetRateMonthly > 0) {
    optimizationDrivers.push("turnover and replacement Street Rates");
  }
  if (ctx.streetMs !== ctx.inhouseMs) {
    optimizationDrivers.push("the effective-date timing");
  }
  if (
    input.topCompetitorRateMonthly != null &&
    input.topCompetitorRateMonthly > 0 &&
    Math.abs(streetIncrease - competitivePreference) < 1e-6
  ) {
    optimizationDrivers.push("the competitive-position preference");
  }
  const driverText = optimizationDrivers.length
    ? ` Drivers: ${optimizationDrivers.join(", ")}.`
    : "";

  return {
    feasible,
    streetIncrease,
    recommendedStreetMonthly: input.currentStreetRateMonthly * (1 + streetIncrease),
    requiredAvgIncrease: appliedAvg,
    allocation: finalAllocation,
    quarterResults,
    bindingQuarterLabel: worst.label,
    infeasibility,
    existingAvgRateMonthly: ctx.baseAvg,
    postIncreaseAvgRateMonthly: ctx.baseAvg * (1 + appliedAvg),
    targetDeviationDiagnostic,
    jointCandidateCount: candidates.size,
    projectionModelCount: candidates.size,
    optimizationNote:
      feasible && targetDeviationDiagnostic.cumulativeDeviationPct > PASS_EPSILON
        ? `The minimum combined solution uses a ${formatPct(appliedAvg * 100, 2)} in-house average and meets the target with ${formatPct(targetDeviationDiagnostic.maximumQuarterDeviationPct, 2)} maximum-quarter and ${formatPct(targetDeviationDiagnostic.cumulativeDeviationPct, 2)} cumulative modeled overshoot.${driverText}`
        : !feasible
          ? `The best combined solution uses a ${formatPct(appliedAvg * 100, 2)} in-house average, but still misses at least one quarter because configured guardrails are binding.${driverText}`
          : null,
  };
}

function buildQuarterResults(
  ctx: EvalContext,
  projected: Map<string, number>,
  bindingLabel: string | null,
  streetIncrease: number,
  avgIncrease: number,
): QuarterResult[] {
  return ctx.input.quarters.map((q) => {
    const base =
      ctx.input.baselineByQuarter.get(q.label) ??
      ({
        ...q,
        realizedRateMonthly: null,
        basis: "projected" as const,
        monthsAvailable: 0,
        monthsExpected: 3,
        residentDays: 0,
      } satisfies BaselineQuarter);
    const prior = base.realizedRateMonthly ?? 0;
    const required = prior * (1 + ctx.target);
    const proj = projected.get(q.label) ?? 0;
    const growth = prior > 0 ? (proj / prior - 1) * 100 : 0;
    const shortfall = ctx.target * 100 - growth;
    return {
      ...q,
      priorYear: base,
      requiredRateMonthly: required,
      projectedRateMonthly: proj,
      yoyGrowthPct: growth,
      passes: prior <= 0 ? true : growth >= ctx.target * 100 - 1e-6,
      shortfallPct: prior <= 0 ? 0 : shortfall,
      isBinding: q.label === bindingLabel,
      explanation: explainQuarter(ctx, q, base, proj, required, streetIncrease, avgIncrease),
    };
  });
}

function explainQuarter(
  ctx: EvalContext,
  q: QuarterRef,
  base: BaselineQuarter,
  projectedRate: number,
  requiredRate: number,
  streetIncrease: number,
  avgIncrease: number,
): CalcExplanation {
  const prior = base.realizedRateMonthly;
  const priorQuarterIsIncomplete = quarterEndMs(base) > ctx.input.anchorMs;
  const partialCoverageNote = (() => {
    const available = new Set(base.availableMonths ?? []);
    const startMonth = (base.quarter - 1) * 3 + 1;
    const quarterMonths = Array.from({ length: 3 }, (_, index) => {
      const monthNumber = startMonth + index;
      const key = `${base.year}-${String(monthNumber).padStart(2, "0")}`;
      const label = new Date(Date.UTC(base.year, monthNumber - 1, 1))
        .toLocaleString("en-US", { month: "long", timeZone: "UTC" });
      return { key, label };
    });
    const usable = quarterMonths.filter(({ key }) => available.has(key)).map(({ label }) => label);
    const missing = quarterMonths.filter(({ key }) => !available.has(key)).map(({ label }) => label);
    return `Usable resident rows are present for ${usable.join(" and ") || "none of the quarter"}; ${missing.join(" and ")} ${missing.length === 1 ? "has" : "have"} no usable rows in current Rent Roll storage. A file upload record alone cannot supply a realized rate, so this is a short-window actual.`;
  })();
  const basisNote =
    base.basis === "actual"
      ? "All three months of that quarter are in the rent roll."
      : base.basis === "partial"
        ? partialCoverageNote
        : base.basis === "ungated_fallback"
          ? "Too few rooms could be matched back to that quarter to meet the usual standard, so this is the best available measurement rather than a confirmed one."
          : priorQuarterIsIncomplete
          ? "That quarter is not complete yet, so its baseline is projected from the available rate trend and is not an actual."
          : "No rent roll data exists for that completed quarter, so the baseline is projected from trend and is not an actual.";

  const steps: CalcExplanation["steps"] = [
    {
      label: `${base.label} realized rate (prior year)`,
      value: prior == null ? "not available" : formatMoney(prior),
      note: basisNote,
    },
    {
      label: "Current in-house rate before this plan",
      value: formatMoney(ctx.baseAvg),
      note:
        prior == null || prior <= 0
          ? "Today’s resident-weighted rate, before the proposed annual increase."
          : `${formatPct((ctx.baseAvg / prior - 1) * 100, 2)} above ${base.label}. This growth is already in today’s rate from earlier pricing actions, including dynamic pricing, and resident-mix changes; it is not created by this plan.`,
    },
    {
      label: "Current Street Rate vs current in-house",
      value: formatMoney(ctx.input.currentStreetRateMonthly),
      note:
        ctx.baseAvg > 0
          ? `${formatPct((ctx.input.currentStreetRateMonthly / ctx.baseAvg - 1) * 100, 2)} variance. Turnover moves part of the quarter from today’s in-house rate toward the Street Rate in force when replacements move in.`
          : "No current in-house rate is available for the variance calculation.",
    },
    {
      label: "Growth target",
      value: formatPct(ctx.target * 100),
    },
    {
      label: `Rate needed in ${q.label}`,
      value: prior == null ? "n/a" : formatMoney(requiredRate),
      note: prior == null ? undefined : `${formatMoney(prior)} × ${(1 + ctx.target).toFixed(4)}`,
    },
    {
      label: `Projected ${q.label} realized rate`,
      value: formatMoney(projectedRate),
      note: `Existing residents at ${formatPct(avgIncrease * 100)} average increase, blended with replacements entering at the ${formatPct(streetIncrease * 100)} higher street rate as turnover runs at ${formatPct(ctx.input.assumptions.annualTurnoverPct)} a year.`,
    },
  ];

  const narrative: string[] = [];
  if (prior == null || prior <= 0) {
    narrative.push(
      `There is no prior-year rate for ${base.label}, so ${q.label} cannot be tested against the growth target. It is shown for reference only.`,
    );
  } else {
    const growth = projectedRate / prior - 1;
    narrative.push(
      `${q.label} is projected to realize ${formatMoney(projectedRate)} against ${formatMoney(prior)} a year earlier — ${formatPct(growth * 100)} growth against a ${formatPct(ctx.target * 100)} target.`,
    );
    narrative.push(
      `The YoY result is not the ${formatPct(avgIncrease * 100)} in-house increase plus the ${formatPct(streetIncrease * 100)} Street increase. Today’s in-house rate is already ${formatPct((ctx.baseAvg / prior - 1) * 100, 2)} above ${base.label}; the model then blends continuing residents with replacements entering at Street as turnover occurs.`,
    );
    narrative.push(
      growth >= ctx.target - PASS_EPSILON
        ? `That clears the target with ${formatPct((growth - ctx.target) * 100, 2)} to spare.`
        : `That falls ${formatPct((ctx.target - growth) * 100, 2)} short of the target.`,
    );
    if (base.basis !== "actual") {
      narrative.push(
        base.basis === "projected"
          ? "Treat this comparison with care: the prior-year figure is projected, not measured."
          : base.basis === "ungated_fallback"
            ? "Treat this comparison with care: the prior-year figure rests on fewer matched rooms than the standard requires."
            : "The prior-year figure covers only part of the quarter, so the comparison is approximate.",
      );
    }
  }

  return {
    headline: `How ${q.label} was tested`,
    steps,
    narrative,
  };
}

function buildInfeasibility(
  ctx: EvalContext,
  streetIncrease: number,
  ceilStreet: number,
  allocation: AllocationResult,
  projected: Map<string, number>,
  worst: { margin: number; label: string | null },
): Infeasibility {
  const requiredAvg = requiredAvgIncreaseAt(ctx, streetIncrease, Math.max(ctx.max, 1));
  const achievable = allocation.maxAvgIncrease;

  let streetCappedWeight = 0;
  let maxCappedWeight = 0;
  let noHeadroomWeight = 0;
  let totalWeight = 0;
  for (const a of allocation.allocations) {
    const w = a.resident.weight * a.resident.currentRateMonthly;
    totalWeight += w;
    if (a.constraint === "at_or_above_street") noHeadroomWeight += w;
    else if (a.constraint === "street_cap") streetCappedWeight += w;
    else if (a.constraint === "max") maxCappedWeight += w;
  }

  let bindingConstraint: Infeasibility["bindingConstraint"];
  if (totalWeight > 0 && noHeadroomWeight / totalWeight >= 0.5) bindingConstraint = "no_headroom";
  else if (streetCappedWeight + noHeadroomWeight > maxCappedWeight) bindingConstraint = "street_cap";
  else if (maxCappedWeight > 0) bindingConstraint = "max_increase";
  else bindingConstraint = "street_ceiling";

  const neededMaxPct = findMinimumMaxIncrease(ctx, streetIncrease, requiredAvg);
  const neededStreetPct = findMinimumStreetIncrease(ctx);

  const achievableGrowth = (() => {
    let worstGrowth = Number.POSITIVE_INFINITY;
    for (const q of ctx.input.quarters) {
      const base = ctx.input.baselineByQuarter.get(q.label);
      if (!base?.realizedRateMonthly) continue;
      const proj = projected.get(q.label);
      if (proj == null) continue;
      worstGrowth = Math.min(worstGrowth, proj / base.realizedRateMonthly - 1);
    }
    return Number.isFinite(worstGrowth) ? worstGrowth * 100 : 0;
  })();

  const parts: string[] = [];
  parts.push(
    `The ${formatPct(ctx.target * 100)} target needs a ${formatPct(requiredAvg * 100)} weighted-average in-house increase, but the current settings only permit ${formatPct(achievable * 100)}.`,
  );
  if (bindingConstraint === "no_headroom") {
    const share = totalWeight > 0 ? (noHeadroomWeight / totalWeight) * 100 : 0;
    parts.push(
      `${share.toFixed(0)}% of in-house revenue sits with residents already at or above their street rate, so they cannot be increased at all while in-house rates are held to street.`,
    );
  } else if (bindingConstraint === "street_cap") {
    parts.push(
      "Most of the shortfall comes from residents who hit their street rate before reaching the maximum increase. Raising the street rate is what creates the room.",
    );
  } else if (bindingConstraint === "max_increase") {
    parts.push(
      `The ${formatPct(ctx.max * 100)} maximum increase is the binding limit — residents have headroom to street but are not allowed to use it.`,
    );
  } else {
    parts.push(
      `Even at the ${formatPct(ceilStreet * 100)} street-increase ceiling the target cannot be reached.`,
    );
  }

  return {
    bindingConstraint,
    message: parts.join(" "),
    bindingQuarterLabel: worst.label,
    requiredAvgIncreasePct: requiredAvg * 100,
    achievableAvgIncreasePct: achievable * 100,
    minimumChange: {
      maxInhouseIncreasePct: neededMaxPct,
      streetIncreasePct: neededStreetPct,
      achievableGrowthTargetPct: achievableGrowth,
    },
  };
}

/** Smallest max-increase setting whose ceiling reaches `requiredAvg`. Null if none does. */
function findMinimumMaxIncrease(
  ctx: EvalContext,
  streetIncrease: number,
  requiredAvg: number,
): number | null {
  const streetActiveAtInhouse = ctx.streetMs <= ctx.inhouseMs;
  const ceilingAt = (maxPct: number) =>
    allocateIncreases({
      residents: ctx.input.residents,
      targetAvgIncrease: Number.POSITIVE_INFINITY,
      minIncrease: Math.min(ctx.min, maxPct),
      maxIncrease: maxPct,
      strength: ctx.input.assumptions.equalizationStrength,
      allowAboveStreet: true,
      streetMultiplier: streetActiveAtInhouse ? 1 + streetIncrease : 1,
    }).maxAvgIncrease;

  const HARD_CEILING = 1.0;
  if (ceilingAt(HARD_CEILING) < requiredAvg - 1e-9) return null;
  let lo = ctx.max;
  let hi = HARD_CEILING;
  if (ceilingAt(lo) >= requiredAvg) return lo * 100;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (ceilingAt(mid) >= requiredAvg) hi = mid;
    else lo = mid;
  }
  return hi * 100;
}

/** Smallest street increase at which the target becomes reachable. Null if none is. */
function findMinimumStreetIncrease(ctx: EvalContext): number | null {
  const HARD_CEILING = 1.0;
  const streetActiveAtInhouse = ctx.streetMs <= ctx.inhouseMs;
  const feasibleAt = (g: number) => {
    const ceiling = allocateIncreases({
      residents: ctx.input.residents,
      targetAvgIncrease: Number.POSITIVE_INFINITY,
      minIncrease: ctx.min,
      maxIncrease: ctx.max,
      strength: ctx.input.assumptions.equalizationStrength,
      allowAboveStreet: true,
      streetMultiplier: streetActiveAtInhouse ? 1 + g : 1,
    }).maxAvgIncrease;
    return worstMargin(ctx, projectFor(ctx, g, ceiling)).margin >= -PASS_EPSILON;
  };
  if (!feasibleAt(HARD_CEILING)) return null;
  let lo = 0;
  let hi = HARD_CEILING;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (feasibleAt(mid)) hi = mid;
    else lo = mid;
  }
  return hi * 100;
}
