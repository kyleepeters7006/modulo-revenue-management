/**
 * In-House Rate Planning — the solver.
 *
 * Pure arithmetic. No database, no Express, no formatting decisions beyond the
 * operator-readable explanations, which are generated here on purpose so the
 * words an operator reads cannot drift away from the math that produced them.
 *
 * ── Why street rate and in-house increase are solved TOGETHER ───────────────
 * On real data 44% of AL private-pay residents already sit at or above their
 * street rate (median gap to street 1.1%, p10 −3.3%). With the default rule
 * that an in-house rate may not exceed street, those residents have zero
 * headroom, so the achievable weighted-average increase is a FUNCTION of the
 * street rate. A sequential "pick a street rate, then allocate" approach
 * therefore fails on the normal case, not on an edge case.
 *
 * The search exploits two monotonicities:
 *   • projected realized rate rises with the average in-house increase X
 *   • the achievable X, and the projected rate, both rise with the street
 *     increase g
 * so each dimension can be bisected.
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
  QuarterRef,
  QuarterResult,
  ResidentConstraint,
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
 * proportional to the gap to street. The spread is derived from the
 * configured min/max and the required average — deliberately not from
 * hard-coded percentage bands, which would silently ignore the operator's
 * own bounds.
 */
export const EQUALIZATION_EXPONENT: Record<EqualizationStrength, number> = {
  low: 0,
  medium: 0.5,
  high: 1,
};

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
  } = input;

  const out = new Map<string, number>();
  if (quarters.length === 0) return out;

  const buckets = quarters.map((q) => ({
    label: q.label,
    startMs: quarterStartMs(q),
    endMs: quarterEndMs(q),
    sum: 0,
    days: 0,
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

    for (const b of buckets) {
      if (day >= b.startMs && day < b.endMs) {
        b.sum += dayRate;
        b.days += 1;
        break;
      }
    }
  }

  for (const b of buckets) {
    out.set(b.label, b.days > 0 ? b.sum / b.days : existingAvgRateMonthly);
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
}

interface ResidentBounds {
  resident: PlanningResident;
  headroom: number;
  minEffective: number;
  maxEffective: number;
  shape: number;
}

function computeBounds(input: AllocationInput): ResidentBounds[] {
  const { residents, minIncrease, maxIncrease, allowAboveStreet, streetMultiplier, strength } =
    input;

  const raw = residents.map((r) => {
    const effectiveStreet = r.streetRateMonthly > 0 ? r.streetRateMonthly * streetMultiplier : 0;
    const headroom =
      effectiveStreet > 0 && r.currentRateMonthly > 0
        ? Math.max(0, effectiveStreet / r.currentRateMonthly - 1)
        : // No usable street rate means no evidence of a ceiling. Treat the
          // configured maximum as the only bound rather than inventing one.
          maxIncrease;

    // The may-not-exceed-street rule caps the increase at the headroom. When
    // the rule is off, only the configured maximum binds.
    const cap = allowAboveStreet ? maxIncrease : Math.min(maxIncrease, headroom);
    const maxEffective = Math.max(0, cap);
    // A configured minimum can never push a resident through the street cap.
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
      b.shape = Math.pow(b.headroom / meanHeadroom, exponent);
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

  const target = Math.min(Math.max(input.targetAvgIncrease, minAvg), maxAvg);
  const clipped = Math.abs(target - input.targetAvgIncrease) > 1e-9;

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
  };
}

function classify(
  b: ResidentBounds,
  value: number,
  input: AllocationInput,
): ResidentConstraint {
  const streetBinds = !input.allowAboveStreet && b.headroom < input.maxIncrease - 1e-9;
  if (streetBinds && b.headroom <= 1e-9) return "at_or_above_street";
  if (value >= b.maxEffective - 1e-9) {
    if (streetBinds) return "street_cap";
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
    allowAboveStreet: ctx.input.assumptions.allowInhouseAboveStreet,
    streetMultiplier: streetActiveAtInhouse ? 1 + streetIncrease : 1,
  });
}

function projectFor(ctx: EvalContext, streetIncrease: number, avgIncrease: number) {
  return projectQuarterlyRealizedRates({
    anchorMs: ctx.input.anchorMs,
    quarters: ctx.input.quarters,
    existingAvgRateMonthly: ctx.baseAvg,
    postIncreaseAvgRateMonthly: ctx.baseAvg * (1 + avgIncrease),
    inhouseEffectiveMs: ctx.inhouseMs,
    currentStreetMonthly: ctx.input.currentStreetRateMonthly,
    newStreetMonthly: ctx.input.currentStreetRateMonthly * (1 + streetIncrease),
    streetEffectiveMs: ctx.streetMs,
    annualTurnover: ctx.turnover,
  });
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
function requiredAvgIncreaseAt(ctx: EvalContext, streetIncrease: number, ceiling: number): number {
  const passesAt = (x: number) =>
    worstMargin(ctx, projectFor(ctx, streetIncrease, x)).margin >= 0;
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

export function solvePlan(input: SolveInput): SolveOutput {
  const ctx = buildContext(input);
  // Street rate should grow at least as fast as the objective — otherwise
  // every move-in dilutes the very growth being planned for. But the operator's
  // own street ceiling still wins: setting it to zero means "do not move street".
  const ceilStreet = Math.max(0, input.assumptions.maxStreetIncreasePct / 100);
  const floorStreet = Math.min(Math.max(0, ctx.target), ceilStreet);

  /** Best average increase the guardrails permit at a given street increase. */
  const maxAvgAt = (g: number) => allocationFor(ctx, g, Number.POSITIVE_INFINITY).maxAvgIncrease;
  const feasibleAt = (g: number) =>
    worstMargin(ctx, projectFor(ctx, g, maxAvgAt(g))).margin >= -PASS_EPSILON;

  let streetIncrease = floorStreet;
  let feasible = feasibleAt(floorStreet);

  if (!feasible && ceilStreet > floorStreet && feasibleAt(ceilStreet)) {
    // Monotone in g: the achievable average and the projected rate both rise
    // with the street rate. Bisect for the smallest street move that works,
    // because recommending more increase than necessary is its own error.
    let lo = floorStreet;
    let hi = ceilStreet;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (feasibleAt(mid)) hi = mid;
      else lo = mid;
    }
    streetIncrease = hi;
    feasible = true;
  } else if (!feasible) {
    streetIncrease = ceilStreet;
  }

  const headroomCeiling = maxAvgAt(streetIncrease);
  const rawRequired = feasible
    ? requiredAvgIncreaseAt(ctx, streetIncrease, Math.max(headroomCeiling, ctx.max))
    : headroomCeiling;
  const allocation = allocationFor(ctx, streetIncrease, rawRequired);
  const appliedAvg = allocation.achievedAvgIncrease;

  const projected = projectFor(ctx, streetIncrease, appliedAvg);
  const worst = worstMargin(ctx, projected);
  feasible = worst.label === null ? true : worst.margin >= -PASS_EPSILON;

  const quarterResults = buildQuarterResults(ctx, projected, worst.label, streetIncrease, appliedAvg);

  const infeasibility = feasible
    ? null
    : buildInfeasibility(ctx, streetIncrease, ceilStreet, allocation, projected, worst);

  return {
    feasible,
    streetIncrease,
    recommendedStreetMonthly: input.currentStreetRateMonthly * (1 + streetIncrease),
    requiredAvgIncrease: appliedAvg,
    allocation,
    quarterResults,
    bindingQuarterLabel: worst.label,
    infeasibility,
    existingAvgRateMonthly: ctx.baseAvg,
    postIncreaseAvgRateMonthly: ctx.baseAvg * (1 + appliedAvg),
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
  const basisNote =
    base.basis === "actual"
      ? "All three months of that quarter are in the rent roll."
      : base.basis === "partial"
        ? `Only ${base.monthsAvailable} of 3 months are in the rent roll, so this is a short-window actual.`
        : "No rent roll data exists for that quarter, so the baseline is projected from trend and is not an actual.";

  const steps: CalcExplanation["steps"] = [
    {
      label: `${base.label} realized rate (prior year)`,
      value: prior == null ? "not available" : formatMoney(prior),
      note: basisNote,
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
      growth >= ctx.target - PASS_EPSILON
        ? `That clears the target with ${formatPct((growth - ctx.target) * 100, 2)} to spare.`
        : `That falls ${formatPct((ctx.target - growth) * 100, 2)} short of the target.`,
    );
    if (base.basis !== "actual") {
      narrative.push(
        base.basis === "projected"
          ? "Treat this comparison with care: the prior-year figure is projected, not measured."
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

  // Which bound is actually holding the average down?
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

  // Minimum single change that would make the target reachable.
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
      allowAboveStreet: ctx.input.assumptions.allowInhouseAboveStreet,
      streetMultiplier: streetActiveAtInhouse ? 1 + streetIncrease : 1,
    }).maxAvgIncrease;

  const HARD_CEILING = 1.0; // 100% — beyond this the answer is not a plan
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
      allowAboveStreet: ctx.input.assumptions.allowInhouseAboveStreet,
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
