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
  RateMixComparison,
  RateProduct,
  ResidentRecommendation,
  StreetRateSource,
} from "@shared/inhousePlanning";
import { formatMoney, formatPct } from "@shared/inhousePlanning";
import {
  applyOccupancyTier,
  occupancyTierRangeLabel,
  tierForOccupancy,
  OCCUPANCY_TIER_IDS,
  type OccupancyTierGuardrails,
  type OccupancyTierId,
  type OccupancyTierPlanCell,
  type OccupancyTierPolicy,
} from "@shared/inhousePlanning";
import {
  fetchOccupancyByServiceLine,
  type OccupancySource,
  type ServiceLineOccupancy,
} from "./dataAccess";
import { DAYS_PER_MONTH } from "@shared/careRates";
import { isDailyRateServiceLine } from "../rateNormalization";
import {
  buildResidents,
  fetchMixStandardizedStreetComparison,
  fetchTopCompetitorRate,
  fetchQuarterRoomRates,
  fetchRecordedMonths,
  fetchMonthlyRealizedRates,
  fetchProductStreetBaselines,
  fetchResidentRows,
  getLatestMonthsForScopes,
  expectedMonths,
  getLatestMonthForScope,
  horizonQuarters,
  makeProductStreetResolver,
  projectMissingQuarters,
  realizedRateWeightBasis,
  rollMonthsIntoQuarters,
  standardizeMonthlyToCurrentMix,
  type MonthlyRealized,
  type ScopeFilter,
} from "./dataAccess";
import {
  DEFAULT_THRESHOLDS,
  compareQuarters,
  type QuarterComparison,
} from "./twoPointIndex";
import { pool } from "../../db";
import {
  getDerivedRateFormulas,
  type StoredFormula,
} from "../derivedRateFormulasService";
import { RATE_PRODUCT_LABEL } from "@shared/rateProduct";
import {
  addMonths,
  addQuarters,
  isoToMs,
  monthBoundsMs,
  quarterEndMs,
  quarterOfMonthKey,
  quarterStartMs,
} from "./dates";
import {
  EQUALIZATION_EXPONENT,
  projectMonthlyRealizedRates,
  projectQuarterlyRealizedRates,
  residentDayWeightedAverageRate,
  residentWeightedAverageStreetRate,
  solvePlan,
  type ResidentAllocation,
} from "./solver";

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

/** Gates a stratum must clear before its measured ratio is believed. */
export const STANDARDIZATION_THRESHOLDS = DEFAULT_THRESHOLDS;

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
  /** Full realized-rate history, oldest first, exactly as the rent roll reports it. */
  monthlyRealized: MonthlyRealized[];
  /**
   * The same months restated against today's unit mix on a constant room
   * cohort. This — not the raw history above — is what quarter baselines and
   * the growth target are built from, so the export can reconcile them.
   */
  monthlyStandardized: MonthlyRealized[];
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
    /** Which product the street rate below is the asking rate for. */
    rateProduct: RateProduct;
    /** Whether that rate came from the unit, a product median or a formula. */
    streetRateSource: StreetRateSource;
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
  return (await preparePlan(input)).solve();
}

/** A service line's data, loaded once and solvable under many guardrails. */
export interface PreparedPlan {
  /** The line's assumptions with effective dates resolved. */
  assumptions: PlanningAssumptions;
  /** Latest rent-roll month the plan is built from. */
  sourceMonth: string;
  /**
   * Solve under one set of tier guardrails, or under the line's own
   * assumptions when omitted. Every database read already happened during
   * preparation, so this is cheap enough to call once per occupancy tier.
   */
  solve(
    guardrails?: OccupancyTierGuardrails,
    tierContext?: OccupancyTierSolveContext,
  ): { plan: PlanResult; audit: PlanAudit };
}

export interface PlanPreparationShared {
  /**
   * Derived-rate formulas are client-wide policy. A portfolio batch should
   * read them once and pass the immutable snapshot to every line.
   */
  formulas: StoredFormula[];
  /**
   * A batch can also resolve each line's latest occupied month with one
   * grouped rent-roll query. `null` is intentional and lets preparePlan
   * report the line-specific missing-data error without another query.
   */
  sourceMonth?: string | null;
}

interface OccupancyTierSolveContext {
  tier: OccupancyTierId;
  rangeLabel: string;
  occupancyPct: number;
}

/**
 * Load everything a service line's plan depends on, without solving it.
 *
 * The split exists because the occupancy-tier grid solves each line three
 * times. A tier may only vary guardrails — never the effective dates, growth
 * target or turnover — so the residents, the standardized history and the
 * quarter baselines are identical across all three tiers of a line. Loading
 * them once turns three plan builds into one.
 */
export async function preparePlan(
  input: CalculatePlanInput,
  shared?: PlanPreparationShared,
): Promise<PreparedPlan> {
  const scope: ScopeFilter = {
    clientId: input.clientId,
    location: input.location,
    serviceLine: input.serviceLine,
  };

  const hasSharedSourceMonth = shared != null && "sourceMonth" in shared;
  const latestMonth = hasSharedSourceMonth
    ? shared.sourceMonth ?? null
    : await getLatestMonthForScope(scope);
  if (!latestMonth) {
    throw new PlanningDataError(
      `No occupied ${input.serviceLine} rent-roll rows found for ${input.location ?? "this portfolio"}.`,
    );
  }
  // Re-bound as a typed const: the solve closure below does not inherit the
  // non-null narrowing the guard above establishes.
  const sourceMonth: string = latestMonth;

  const resolvedAssumptions = withResolvedDates(input.assumptions, sourceMonth);
  const quarters = horizonQuarters(resolvedAssumptions.inhouseEffectiveDate);
  // Prior-year quarters are what the horizon is judged against, and their
  // months define the window the standardization cohort must be stable across.
  const priorYearQuarters = quarters.map((q) => addQuarters(q, -4));
  const horizonStartMs = quarterStartMs(quarters[0]);
  const horizonEndMs = quarterEndMs(quarters[quarters.length - 1]);

  // Simulation starts the day after live data ends, so turnover between now
  // and the plan's first quarter is modelled rather than ignored.
  const anchorMs = monthBoundsMs(addMonths(sourceMonth, 1)).startMs;

  // The Street Rate may take effect in the fall before the in-house plan year.
  // Its annual ceiling still compares the plan year with the January immediately
  // preceding that plan year. Using the Street effective-date year minus one
  // incorrectly sent an October 2026 change back to January 2025.
  const priorJanuaryMonth = `${quarters[0].year - 1}-01`;
  const [rawRows, priorJanuaryComparison, topCompetitorRateMonthly, productBaselines, formulas] =
    await Promise.all([
      fetchResidentRows(scope, sourceMonth),
      fetchMixStandardizedStreetComparison(scope, priorJanuaryMonth, sourceMonth),
      fetchTopCompetitorRate(scope, sourceMonth),
      fetchProductStreetBaselines(scope, sourceMonth),
      shared?.formulas ??
        getDerivedRateFormulas((s, p) => pool.query(s, p), input.clientId),
    ]);

  const { residents, excluded } = buildResidents(rawRows, {
    horizonStartMs: Math.min(anchorMs, horizonStartMs),
    horizonEndMs,
    // The SQL population is base-rate-only; resolve the matching base-product
    // Street Rate for fallback and ceiling diagnostics.
    productStreet: makeProductStreetResolver(productBaselines, formulas),
  });

  if (residents.length === 0) {
    throw new PlanningDataError(
      `No private-pay ${input.serviceLine} residents with a usable in-house rate at ${input.location ?? "this portfolio"} in ${sourceMonth}.`,
    );
  }

  // Compare Street and in-house rates over one identical private-pay room mix.
  // Each resident already carries the asking rate for their own product (with a
  // product-matched fallback when the row itself is missing or implausible), so
  // this uses the same rooms and horizon weights as the in-house population.
  const currentStreetRateMonthly =
    residentWeightedAverageStreetRate(residents);
  if (!(currentStreetRateMonthly > 0)) {
    throw new PlanningDataError(
      `No private-pay ${input.serviceLine} resident room has a usable product-matched Street Rate at ${input.location ?? "this portfolio"} in ${sourceMonth}.`,
    );
  }

  // Standardize every historical month to today's exact base-rate unit mix.
  // For each month, compare historical and current rates on the same rooms,
  // then apply that measured relationship to today's full planning average.
  // This preserves true price movement without letting occupancy/mix changes
  // manufacture a gain or shortfall.
  const unitMixByKey = new Map<string, number>();
  for (const resident of residents) {
    unitMixByKey.set(
      `${resident.location ?? ""}\x1f${resident.roomNumber ?? ""}`,
      resident.currentRateMonthly,
    );
  }
  const unitMix = Array.from(unitMixByKey, ([key, currentRateMonthly]) => ({
    key,
    currentRateMonthly,
  }));
  // The divisor above only cancels composition if the same rooms qualify every
  // month, and they do not: payer scope, base-rate exclusions and the outlier
  // gate move rooms in and out while occupancy is flat. Requiring survival
  // across the whole window removed that churn but kept only a biased remnant
  // of the portfolio, and chain-linking adjacent months made every level
  // hostage to the worst month between it and today. Comparing two quarters
  // directly has neither weakness — see twoPointIndex.ts.
  const [monthly, recordedMonths] = await Promise.all([
    fetchMonthlyRealizedRates(scope, "2000-01", unitMix),
    fetchRecordedMonths(scope, priorYearQuarters.flatMap((q) => expectedMonths(q))),
  ]);
  const currentPlanningAverage = residentDayWeightedAverageRate(residents);
  const standardize = (rows: MonthlyRealized[]) =>
    standardizeMonthlyToCurrentMix(rows, currentPlanningAverage);

  // The ending quarter is the latest one the rent roll actually covers in full.
  // Requiring all three months present rules out both the quarter in progress
  // and any quarter with a missing upload, either of which would leave the
  // matched set empty rather than merely thin.
  const rawByMonth = new Map(monthly.map((m) => [m.month, m]));
  let endingQuarter: QuarterRef | null = null;
  for (let back = 0; back < 12 && endingQuarter == null; back += 1) {
    const candidate = addQuarters(quarterOfMonthKey(sourceMonth), -back);
    if (expectedMonths(candidate).every((m) => rawByMonth.has(m))) endingQuarter = candidate;
  }

  // Every historical quarter is compared against that one quarter, and the
  // strict four-quarters-apart pair is computed alongside as the headline
  // year-over-year figure. Three of the four prior-year quarters are not four
  // quarters from the ending one; the four-quarter gap is what makes a YoY
  // number meaningful, but it is the matched pairing — not the gap — that does
  // the standardizing, so the shorter spans are measured the same way.
  const rawQuarterRate = (q: QuarterRef): number | null => {
    let revenue = 0;
    let days = 0;
    for (const month of expectedMonths(q)) {
      const row = rawByMonth.get(month);
      if (!row) continue;
      revenue += row.rateMonthly * row.residentDays;
      days += row.residentDays;
    }
    return days > 0 ? revenue / days : null;
  };
  const yoyBaseQuarter = endingQuarter ? addQuarters(endingQuarter, -4) : null;
  const baseQuarters = new Map<string, QuarterRef>();
  for (const q of priorYearQuarters) {
    if (q.label !== endingQuarter?.label) baseQuarters.set(q.label, q);
  }
  if (yoyBaseQuarter && yoyBaseQuarter.label !== endingQuarter?.label) {
    baseQuarters.set(yoyBaseQuarter.label, yoyBaseQuarter);
  }
  const baseQuarterList = Array.from(baseQuarters.values());

  const [endingRooms, baseRoomSets] = await Promise.all([
    endingQuarter
      ? fetchQuarterRoomRates(scope, expectedMonths(endingQuarter), { adjudicate: true })
      : Promise.resolve(null),
    Promise.all(
      baseQuarterList.map((q) =>
        // Never adjudicated: the historical side is taken as recorded.
        fetchQuarterRoomRates(scope, expectedMonths(q), { adjudicate: false }),
      ),
    ),
  ]);

  const comparisons = new Map<string, QuarterComparison>();
  if (endingQuarter && endingRooms) {
    baseQuarterList.forEach((q, i) => {
      comparisons.set(
        q.label,
        compareQuarters({
          baseQuarterLabel: q.label,
          endingQuarterLabel: endingQuarter!.label,
          ending: endingRooms.rooms,
          base: baseRoomSets[i].rooms,
          rawEndingRate: rawQuarterRate(endingQuarter!),
          rawBaseRate: rawQuarterRate(q),
          thresholds: DEFAULT_THRESHOLDS,
        }),
      );
    });
  }

  const yoyComparison = yoyBaseQuarter ? (comparisons.get(yoyBaseQuarter.label) ?? null) : null;

  // Only the price RELATIONSHIP comes from the matched rooms; the level stays
  // anchored to today's full planning average, exactly as before.
  const weightBasis = realizedRateWeightBasis(input.serviceLine);
  const quarterWeight = (q: QuarterRef) =>
    expectedMonths(q).reduce((sum, m) => sum + (rawByMonth.get(m)?.residentDays ?? 0), 0);
  const asBaseline = (
    q: QuarterRef,
    rateMonthly: number,
    basis: BaselineQuarter["basis"] = "actual",
  ): BaselineQuarter => ({
    ...q,
    realizedRateMonthly: rateMonthly,
    basis,
    monthsAvailable: 3,
    monthsExpected: 3,
    availableMonths: expectedMonths(q),
    residentDays: quarterWeight(q),
  });
  // Partial quarters cannot use the strict three-month matched-room comparison,
  // but they still must use the same current-mix level as complete baselines.
  // Rolling the raw occupied-resident average here makes turnover/composition
  // look like price growth and then compounds that false jump into projections.
  const observedQuarters = rollMonthsIntoQuarters(standardize(monthly));

  // A percentage coverage floor is a poor judge of a small campus: at seven
  // rooms one turnover costs fourteen points, so it ends up measuring portfolio
  // size rather than data quality. The stratum gates already lead with a
  // matched-room COUNT for that reason, but a scope small enough can still lose
  // every quarter. Withholding a number is right; refusing to plan at all is
  // not, so such a scope falls back to the ungated ratio and is told plainly.
  const measurable = priorYearQuarters.filter((q) => {
    if (q.label === endingQuarter?.label) return true;
    return comparisons.get(q.label)?.usable === true;
  });
  const anyRecorded = priorYearQuarters.some(
    (q) =>
      q.label === endingQuarter?.label ||
      (comparisons.get(q.label)?.unsuppressedRatio ?? 0) > 0,
  );
  const suppressionWouldEmptyScope = measurable.length === 0 && anyRecorded;

  const knownQuarters = new Map<string, BaselineQuarter>();
  const suppressedQuarters = new Map<string, string>();
  if (endingQuarter) {
    knownQuarters.set(endingQuarter.label, asBaseline(endingQuarter, currentPlanningAverage));
  }
  for (const q of baseQuarterList) {
    const observed = observedQuarters.get(q.label);
    if (
      observed?.basis === "partial" &&
      observed.realizedRateMonthly != null &&
      observed.realizedRateMonthly > 0
    ) {
      // A partial quarter is still real prior-rate evidence. Preserve its
      // measured months and label instead of replacing it with a projected
      // placeholder; the UI keeps it distinct from a complete YoY quarter.
      knownQuarters.set(q.label, observed);
      continue;
    }
    const comparison = comparisons.get(q.label);
    const gated = comparison?.usable === true;
    const ratio = gated
      ? comparison!.ratio
      : suppressionWouldEmptyScope
        ? (comparison?.unsuppressedRatio ?? null)
        : null;
    if (ratio != null && ratio > 0) {
      knownQuarters.set(
        q.label,
        asBaseline(q, currentPlanningAverage / ratio, gated ? "actual" : "ungated_fallback"),
      );
      continue;
    }
    // A quarter the rent roll never recorded is projected, not suppressed:
    // projection is for quarters that were never measured, suppression for
    // quarters that were measured and cannot be believed. Presence is read from
    // the raw upload, never from the eligibility-filtered series — otherwise a
    // quarter whose rows all failed the gate would be quietly extrapolated as
    // though it had never been uploaded.
    const recorded = expectedMonths(q).some((m) => recordedMonths.has(m));
    if (!recorded || !priorYearQuarters.some((p) => p.label === q.label)) continue;
    suppressedQuarters.set(q.label, comparison?.reasonCode ?? "NO_MATCHED_ROOMS");
  }

  // The model has no resolution below a quarter, so the monthly view of the
  // standardized series is a step function by construction. It exists for the
  // export's rate-history sheet, never as an input to a baseline.
  const mixStandardizedMonthly: MonthlyRealized[] = Array.from(knownQuarters.values())
    .flatMap((q) =>
      (q.availableMonths ?? []).map((month) => ({
        month,
        weightBasis,
        residentDays: rawByMonth.get(month)?.residentDays ?? 0,
        rateMonthly: q.realizedRateMonthly ?? 0,
      })),
    )
    .filter((m) => m.residentDays > 0 && m.rateMonthly > 0)
    .sort((a, b) => a.month.localeCompare(b.month));

  const { baselines, quarterlyGrowthPct } = projectMissingQuarters(
    knownQuarters,
    priorYearQuarters.filter((q) => !suppressedQuarters.has(q.label)),
  );
  for (const label of Array.from(suppressedQuarters.keys())) baselines.delete(label);

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
  // Both sides of the January comparison are averaged over the same matched
  // rooms, so their RATIO is the like-for-like price movement. Anchor that
  // ratio to today's full planning street rate rather than handing the solver a
  // January average drawn from a different room population.
  if (
    priorJanuaryComparison.matchedRooms === 0 ||
    priorJanuaryComparison.priorMatchedMonthly <= 0 ||
    priorJanuaryComparison.currentMatchedMonthly <= 0
  ) {
    throw new PlanningDataError(
      `No room in ${sourceMonth} can be matched back to a usable ${priorJanuaryMonth} street rate at ${input.location ?? "this portfolio"}, so the January-to-January street increase maximum cannot be enforced.`,
    );
  }
  const priorJanuaryStreetRateMonthly =
    currentStreetRateMonthly *
    (priorJanuaryComparison.priorMatchedMonthly / priorJanuaryComparison.currentMatchedMonthly);

  const matchCoverage =
    priorJanuaryComparison.currentRooms > 0
      ? priorJanuaryComparison.matchedRooms / priorJanuaryComparison.currentRooms
      : 0;

  /**
   * Everything above is tier-invariant and already in memory; everything below
   * depends on the guardrails. `assumptions` shadows the prepared set on
   * purpose so the solve body reads exactly as it did before the split.
   */
  function solveWith(
    assumptions: PlanningAssumptions,
    tierContext?: OccupancyTierSolveContext,
  ): { plan: PlanResult; audit: PlanAudit } {
    const daily = isDailyRateServiceLine(input.serviceLine);
    const solved = solvePlan({
      residents,
      assumptions,
      baselineByQuarter,
      quarters,
      anchorMs,
      currentStreetRateMonthly,
      priorJanuaryStreetRateMonthly,
      topCompetitorRateMonthly,
      enforcePortfolioStreetPremium: input.location == null && input.locationId == null,
      rateWeightBasis: daily ? "resident_days" : "resident_months",
    });

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
        tierContext,
        toDisplay,
      }),
    );

    const projectionCommon = {
      anchorMs,
      quarters,
      inhouseEffectiveMs: isoToMs(assumptions.inhouseEffectiveDate),
      currentStreetMonthly: currentStreetRateMonthly,
      newStreetMonthly: solved.recommendedStreetMonthly,
      streetEffectiveMs: isoToMs(assumptions.streetRateEffectiveDate),
      annualTurnover: assumptions.annualTurnoverPct / 100,
      weightBasis: daily ? "resident_days" as const : "resident_months" as const,
    };
    const firstHorizonMonth = `${quarters[0].year}-${String((quarters[0].quarter - 1) * 3 + 1).padStart(2, "0")}`;
    const lastHorizonMonth = addMonths(firstHorizonMonth, quarters.length * 3 - 1);
    const streetEffectiveMonth = assumptions.streetRateEffectiveDate.slice(0, 7);
    // Include the month immediately before the Street Rate change so the chart
    // visibly steps from the current rate to the recommendation.
    const preStreetMonth = addMonths(streetEffectiveMonth, -1);
    const chartStartMonth = preStreetMonth < firstHorizonMonth ? preStreetMonth : firstHorizonMonth;
    const horizonMonths: string[] = [];
    for (let month = chartStartMonth; month <= lastHorizonMonth; month = addMonths(month, 1)) {
      horizonMonths.push(month);
    }
    const monthlyProjected = projectMonthlyRealizedRates(
      {
        ...projectionCommon,
        existingAvgRateMonthly: solved.existingAvgRateMonthly,
        postIncreaseAvgRateMonthly: solved.postIncreaseAvgRateMonthly,
      },
      horizonMonths,
    );
    const monthlyRateProjection = horizonMonths.map((month) => {
      const projectedRateMonthly = monthlyProjected.get(month) ?? solved.existingAvgRateMonthly;
      const monthEndMs = monthBoundsMs(month).endMs - 1;
      const streetRateMonthly =
        monthEndMs >= isoToMs(assumptions.streetRateEffectiveDate)
          ? solved.recommendedStreetMonthly
          : currentStreetRateMonthly;
      return {
        month,
        projectedRateMonthly,
        streetRateMonthly,
        growthFromCurrentPct:
          solved.existingAvgRateMonthly > 0
            ? (projectedRateMonthly / solved.existingAvgRateMonthly - 1) * 100
            : 0,
      };
    });
    // A unit-rate projection isolates the expected future-move-in share. A
    // street-rate projection then supplies the exact replacement contribution
    // used by every room. Future people are unknowable, so this is deliberately
    // labelled as a modeled share rather than inventing resident identities.
    const replacementShareByQuarter = projectQuarterlyRealizedRates({
      ...projectionCommon,
      existingAvgRateMonthly: 0,
      postIncreaseAvgRateMonthly: 0,
      currentStreetMonthly: 1,
      newStreetMonthly: 1,
    });
    const replacementContributionByQuarter = projectQuarterlyRealizedRates({
      ...projectionCommon,
      existingAvgRateMonthly: 0,
      postIncreaseAvgRateMonthly: 0,
    });
    const recommendationByKey = new Map(recommendations.map((r) => [r.key, r]));
    const roomProjectionByKey = new Map(
      recommendations.map((r) => [
        r.key,
        projectQuarterlyRealizedRates({
          ...projectionCommon,
          existingAvgRateMonthly: r.currentRateMonthly,
          postIncreaseAvgRateMonthly: r.newRateMonthly,
        }),
      ]),
    );
    const residentWeightByKey = new Map(residents.map((r) => [r.key, r.weight]));
    const quartersWithRoomDetail = solved.quarterResults.map((quarter) => {
      const replacementShare = replacementShareByQuarter.get(quarter.label) ?? 0;
      const existingShare = Math.max(0, 1 - replacementShare);
      const replacementContribution = replacementContributionByQuarter.get(quarter.label) ?? 0;
      const replacementRate = replacementShare > 0
        ? replacementContribution / replacementShare
        : 0;
      const roomDetails = residents.map((resident) => {
        const recommendation = recommendationByKey.get(resident.key)!;
        const projectedRate = roomProjectionByKey.get(resident.key)?.get(quarter.label)
          ?? resident.currentRateMonthly;
        const existingRateUsed = existingShare > 0
          ? (projectedRate - replacementContribution) / existingShare
          : 0;
        return {
          key: resident.key,
          location: resident.location,
          roomNumber: resident.roomNumber,
          roomType: resident.roomType,
          moveInDate: resident.moveInDate,
          currentRateMonthly: resident.currentRateMonthly,
          plannedExistingRateMonthly: recommendation.newRateMonthly,
          existingRateUsedMonthly: existingRateUsed,
          existingSharePct: existingShare * 100,
          replacementSharePct: replacementShare * 100,
          replacementRateMonthly: replacementRate,
          projectedRateMonthly: projectedRate,
          changeMonthly: projectedRate - resident.currentRateMonthly,
        };
      });
      let weightedCurrent = 0;
      let weightedExisting = 0;
      let weightedProjected = 0;
      let weight = 0;
      for (const room of roomDetails) {
        const roomWeight = residentWeightByKey.get(room.key) ?? 0;
        weightedCurrent += room.currentRateMonthly * roomWeight;
        weightedExisting += room.existingRateUsedMonthly * roomWeight;
        weightedProjected += room.projectedRateMonthly * roomWeight;
        weight += roomWeight;
      }
      const currentTotal = weight > 0 ? weightedCurrent / weight : 0;
      const existingTotal = weight > 0 ? weightedExisting / weight : 0;
      const projectedTotal = weight > 0 ? weightedProjected / weight : 0;
      return {
        ...quarter,
        roomDetails,
        roomDetailProjectedRateMonthly: projectedTotal,
        roomDetailTotals: {
          currentRateMonthly: currentTotal,
          existingRateUsedMonthly: existingTotal,
          existingSharePct: existingShare * 100,
          replacementSharePct: replacementShare * 100,
          replacementRateMonthly: replacementRate,
          projectedRateMonthly: projectedTotal,
          changeMonthly: projectedTotal - currentTotal,
        },
      };
    });

    const summary = summarize(residents, recommendations, solved.existingAvgRateMonthly);

    const warnings = buildWarnings({
      sourceMonth,
      excluded,
      baselineByQuarter,
      quarters,
      quarterlyGrowthPct,
      residentsWithoutStreet: residents.filter((r) => r.streetRateMonthly <= 0).length,
      residentCount: residents.length,
      priorJanuaryMonth,
      januaryMatchCoverage: matchCoverage,
      suppressedQuarters,
      thinComparisons: Array.from(comparisons.values()).filter(
        (c) => c.usable && c.suppressedStrata.length > 0,
      ),
      crossUnitRedistribution: Array.from(comparisons.values())
        .filter((c) => c.usable && c.redistributedAcrossUnitTypes)
        .map((c) => c.baseQuarterLabel),
      minMatchedRooms: DEFAULT_THRESHOLDS.minMatchedRooms,
      coverageFloorPct: DEFAULT_THRESHOLDS.coverageFloorPct,
    });
    if (suppressionWouldEmptyScope) {
      warnings.push(
        `No prior-year quarter for this scope had enough matched rooms to measure price movement to the usual standard, so the baselines below are the best available rather than measurements that met it. A service line this small turns over a large share of its rooms in a year — treat the year-over-year figures as indicative.`,
      );
    }
    if (
      input.location == null &&
      input.locationId == null &&
      solved.recommendedStreetMonthly < solved.postIncreaseAvgRateMonthly * 1.01 - 0.01
    ) {
      const premiumPct =
        solved.postIncreaseAvgRateMonthly > 0
          ? (solved.recommendedStreetMonthly / solved.postIncreaseAvgRateMonthly - 1) * 100
          : 0;
      warnings.push(
        `${input.serviceLine} portfolio Street Rate ends ${premiumPct.toFixed(1)}% above its planned average in-house rate, below the 1.0% floor because the configured Street Rate ceiling or January-to-January limit binds.`,
      );
    }

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
      adjustedTopCompetitorRateMonthly: topCompetitorRateMonthly,

      requiredWeightedAvgIncreasePct: solved.requiredAvgIncrease * 100,

      quarters: quartersWithRoomDetail,
      monthlyRateProjection,
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
      standardization: {
        method: "two_point_matched_quarter",
        endingQuarterLabel: endingQuarter?.label ?? "",
        minMatchedRooms: DEFAULT_THRESHOLDS.minMatchedRooms,
        coverageFloorPct: DEFAULT_THRESHOLDS.coverageFloorPct,
        comparisons: Array.from(comparisons.values())
          .map(describeComparison)
          .sort((a, b) => a.baseQuarterLabel.localeCompare(b.baseQuarterLabel)),
        yearOverYear: yoyComparison ? describeComparison(yoyComparison) : null,
        yearOverYearStrata: (yoyComparison?.strata ?? []).map((s) => ({
          key: s.key,
          unitType: s.unitType,
          careLevel: s.careLevel,
          priceBand: s.priceBand,
          matchedRooms: s.matchedRooms,
          endingRooms: s.endingRooms,
          coverageByCountPct: s.coverageByCountPct,
          coverageByRevenuePct: s.coverageByRevenuePct,
          rateEffectPct: s.ratio != null ? (s.ratio - 1) * 100 : null,
          endingWeightSharePct: s.endingWeightShare * 100,
          baseWeightSharePct: s.baseWeightShare * 100,
          suppressed: s.suppressed,
          reasonCode: s.reasonCode,
        })),
        suppressedQuarters: Array.from(suppressedQuarters, ([label, reasonCode]) => ({
          label,
          reasonCode,
        })),
        parallelRun: priorYearQuarters.map((q) => {
          const matched = baselines.get(q.label)?.realizedRateMonthly ?? null;
          return {
            label: q.label,
            matchedPairRateMonthly: matched,
            // The balanced-panel method was retired from interactive runs:
            // its six historical cohort queries dominated request latency.
            balancedPanelRateMonthly: null,
            differencePct: null,
          };
        }),
      },
    };

    const audit: PlanAudit = {
      lambda: solved.allocation.lambda,
      equalizationExponent: EQUALIZATION_EXPONENT[assumptions.equalizationStrength] ?? 0.5,
      streetMultiplierAtInhouse,
      minEffectiveFloor: assumptions.minInhouseIncreasePct / 100,
      maxEffectiveCeiling: assumptions.maxInhouseIncreasePct / 100,
      allowAboveStreet: true,
      currentStreetRateMonthly,
      recommendedStreetRateMonthly: solved.recommendedStreetMonthly,
      monthlyRealized: monthly,
      monthlyStandardized: mixStandardizedMonthly,
      residents: solved.allocation.allocations.map((a) => ({
        key: a.resident.key,
        location: a.resident.location,
        serviceLine: a.resident.serviceLine,
        roomNumber: a.resident.roomNumber,
        roomType: a.resident.roomType,
        careLevel: a.resident.careLevel,
        payorType: a.resident.payorType,
        moveInDate: a.resident.moveInDate,
        rateProduct: a.resident.rateProduct,
        streetRateSource: a.resident.streetRateSource,
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

  return {
    assumptions: resolvedAssumptions,
    sourceMonth,
    solve: (guardrails, tierContext) =>
      solveWith(
        guardrails ? applyOccupancyTier(resolvedAssumptions, guardrails) : resolvedAssumptions,
        tierContext,
      ),
  };
}

/* ── Occupancy-tier what-if grid ───────────────────────────────────────────── */

export interface CalculatePlanTiersInput {
  clientId: string;
  locationId: string | null;
  location: string | null;
  serviceLine: string;
  /** Service-line-level assumptions: effective dates, growth target, turnover. */
  assumptions: PlanningAssumptions;
  tierPolicy: OccupancyTierPolicy;
}

export interface CalculatePlanTiersResult {
  serviceLine: string;
  /** Measured occupancy percent, or null when it could not be read. */
  occupancyPct: number | null;
  occupancyMonth: string | null;
  /** Which table the reading came from; null when the line has no reading. */
  occupancySource: OccupancySource | null;
  /** Tier the measured occupancy falls in; null when occupancy is unknown. */
  currentTier: OccupancyTierId | null;
  /** Full recommendation solved under the measured tier's guardrails. */
  currentPlan: PlanResult;
  cells: OccupancyTierPlanCell[];
  warnings: string[];
}

export interface CalculatePlanBatchLine {
  serviceLine: string;
  assumptions: PlanningAssumptions;
}

export interface CalculatePlanBatchInput {
  clientId: string;
  locationId: string | null;
  location: string | null;
  lines: CalculatePlanBatchLine[];
}

export interface BatchPlanFailure {
  serviceLine: string;
  message: string;
}

export interface CalculatePlanBatchResult {
  plans: Array<{ serviceLine: string; plan: PlanResult }>;
  skipped: BatchPlanFailure[];
}

export interface CalculatePlanTiersBatchLine extends CalculatePlanBatchLine {
  tierPolicy: OccupancyTierPolicy;
}

export interface CalculatePlanTiersBatchInput {
  clientId: string;
  locationId: string | null;
  location: string | null;
  lines: CalculatePlanTiersBatchLine[];
}

export interface CalculatePlanTiersBatchResult {
  lines: CalculatePlanTiersResult[];
  skipped: BatchPlanFailure[];
}

function planningErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

/**
 * Calculate several ordinary plans from one request. The solver remains
 * line-scoped, but client-wide policy is loaded once and a failed line is
 * reported without cancelling valid siblings.
 */
export async function calculatePlanBatch(
  input: CalculatePlanBatchInput,
): Promise<CalculatePlanBatchResult> {
  const [formulas, sourceMonths] = await Promise.all([
    getDerivedRateFormulas((s, p) => pool.query(s, p), input.clientId),
    getLatestMonthsForScopes(
      input.clientId,
      input.location,
      input.lines.map((line) => line.serviceLine),
    ),
  ]);
  const settled = await Promise.allSettled(
    input.lines.map(async (line) => {
      const prepared = await preparePlan(
        {
          clientId: input.clientId,
          locationId: input.locationId,
          location: input.location,
          serviceLine: line.serviceLine,
          assumptions: line.assumptions,
        },
        {
          formulas,
          sourceMonth: sourceMonths.get(line.serviceLine) ?? null,
        },
      );
      return { serviceLine: line.serviceLine, plan: prepared.solve().plan };
    }),
  );
  const plans: CalculatePlanBatchResult["plans"] = [];
  const skipped: BatchPlanFailure[] = [];
  settled.forEach((outcome, index) => {
    const serviceLine = input.lines[index].serviceLine;
    if (outcome.status === "fulfilled") plans.push(outcome.value);
    else skipped.push({
      serviceLine,
      message: planningErrorMessage(outcome.reason, `No plan could be calculated for ${serviceLine}.`),
    });
  });
  return { plans, skipped };
}

function solvePreparedPlanTiers(
  input: CalculatePlanTiersBatchLine,
  prepared: PreparedPlan,
  reading: ServiceLineOccupancy | null,
): CalculatePlanTiersResult {
  const occupancyPct = reading?.occupancyPct ?? null;
  const currentTier = tierForOccupancy(input.tierPolicy, occupancyPct);
  const warnings: string[] = [];
  if (reading == null) {
    warnings.push(
      `No occupancy reading for ${input.serviceLine}, so none of its tiers is marked as the one in force. The three plans below are still valid what-ifs.`,
    );
  } else if (reading.source === "rent_roll") {
    warnings.push(
      `Occupancy for ${input.serviceLine} came from the rent roll because occupancy history does not cover this service line. Rent-roll occupancy under-reports wherever companion beds exist, so confirm the tier it selected.`,
    );
  }

  let currentPlan: PlanResult | null = null;
  const cells: OccupancyTierPlanCell[] = OCCUPANCY_TIER_IDS.map((tier) => {
    const identity = {
      serviceLine: input.serviceLine,
      tier,
      rangeLabel: occupancyTierRangeLabel(input.tierPolicy, tier),
      isCurrent: tier === currentTier,
    };
    try {
      const tierContext =
        tier === currentTier && occupancyPct != null
          ? {
              tier,
              rangeLabel: identity.rangeLabel,
              occupancyPct,
            }
          : undefined;
      const { plan } = prepared.solve(input.tierPolicy.tiers[tier], tierContext);
      if (tier === currentTier) currentPlan = plan;
      return {
        ...identity,
        inhouseIncreasePct: plan.summary.weightedAvgIncreasePct,
        streetIncreasePct: plan.streetIncreasePct,
        feasible: plan.feasible,
      };
    } catch (err) {
      return {
        ...identity,
        inhouseIncreasePct: null,
        streetIncreasePct: null,
        feasible: null,
        error: planningErrorMessage(err, `Tier ${tier} could not be solved.`),
      };
    }
  });

  if (currentPlan == null) currentPlan = prepared.solve().plan;
  return {
    serviceLine: input.serviceLine,
    occupancyPct,
    occupancyMonth: reading?.month ?? null,
    occupancySource: reading?.source ?? null,
    currentTier,
    currentPlan,
    cells,
    warnings,
  };
}

/**
 * Batch form of the occupancy-tier calculation. Occupancy and derived-rate
 * policy are scope-wide inputs, so they are read once before line preparation.
 */
export async function calculatePlanTiersBatch(
  input: CalculatePlanTiersBatchInput,
): Promise<CalculatePlanTiersBatchResult> {
  const [occupancy, formulas, sourceMonths] = await Promise.all([
    fetchOccupancyByServiceLine(input.clientId, input.location),
    getDerivedRateFormulas((s, p) => pool.query(s, p), input.clientId),
    getLatestMonthsForScopes(
      input.clientId,
      input.location,
      input.lines.map((line) => line.serviceLine),
    ),
  ]);
  const settled = await Promise.allSettled(
    input.lines.map(async (line) => {
      const prepared = await preparePlan(
        {
          clientId: input.clientId,
          locationId: input.locationId,
          location: input.location,
          serviceLine: line.serviceLine,
          assumptions: line.assumptions,
        },
        {
          formulas,
          sourceMonth: sourceMonths.get(line.serviceLine) ?? null,
        },
      );
      return solvePreparedPlanTiers(
        line,
        prepared,
        occupancy.byServiceLine.get(line.serviceLine) ?? null,
      );
    }),
  );
  const lines: CalculatePlanTiersResult[] = [];
  const skipped: BatchPlanFailure[] = [];
  settled.forEach((outcome, index) => {
    const serviceLine = input.lines[index].serviceLine;
    if (outcome.status === "fulfilled") lines.push(outcome.value);
    else skipped.push({
      serviceLine,
      message: planningErrorMessage(
        outcome.reason,
        `No tier grid could be built for ${serviceLine}.`,
      ),
    });
  });
  return { lines, skipped };
}

/**
 * Solve one service line under all three of its occupancy tiers.
 *
 * The line's data is loaded once and solved three times, so this costs roughly
 * one plan build rather than three. Callers fan out across service lines the
 * same way they already do for single plans.
 */
export async function calculatePlanTiers(
  input: CalculatePlanTiersInput,
): Promise<CalculatePlanTiersResult> {
  const result = await calculatePlanTiersBatch({
    clientId: input.clientId,
    locationId: input.locationId,
    location: input.location,
    lines: [{
      serviceLine: input.serviceLine,
      assumptions: input.assumptions,
      tierPolicy: input.tierPolicy,
    }],
  });
  if (result.lines[0]) return result.lines[0];
  throw new PlanningDataError(result.skipped[0]?.message ?? "No tier grid could be built.");
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
    tierContext?: OccupancyTierSolveContext;
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
    rateProduct: r.rateProduct,
    streetRateSource: r.streetRateSource,
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
    weight: r.weight,
    explanation: explainResident(a, effectiveStreet, ctx.assumptions, ctx.tierContext),
  };
}

/**
 * Say where the comparison rate came from whenever it is not the resident's
 * own unit. A measured product median and a formula-derived rate are both
 * legitimate ceilings, but the operator is entitled to know which one is
 * holding their recommendation down.
 */
function streetSourceNote(r: PlanningResident): string | undefined {
  const product = RATE_PRODUCT_LABEL[r.rateProduct].toLowerCase();
  switch (r.streetRateSource) {
    case "product_median":
      return `This unit has no usable asking rate of its own, so the median ${product} rate at this campus is used instead.`;
    case "service_line_median":
      return `No ${product} rate is priced at this campus, so the median across every campus in this service line is used instead.`;
    case "derived_formula":
      return `No ${product} rate is priced anywhere in this service line, so the configured ${product} formula is applied to the campus base rate.`;
    default:
      return undefined;
  }
}

function streetRiseNote(r: PlanningResident, effectiveStreet: number): string | undefined {
  if (!(effectiveStreet > r.streetRateMonthly)) return undefined;
  return `Rises to ${formatMoney(effectiveStreet)} once the recommended street increase takes effect, which is the ceiling that applies on the in-house effective date.`;
}

function explainResident(
  a: ResidentAllocation,
  effectiveStreet: number,
  assumptions: PlanningAssumptions,
  tierContext?: OccupancyTierSolveContext,
): CalcExplanation {
  const r = a.resident;
  const newRate = r.currentRateMonthly * (1 + a.increase);
  const steps: CalcExplanation["steps"] = [
    ...(tierContext
      ? [{
          label: "Occupancy tier",
          value: `${tierContext.tier[0].toUpperCase()}${tierContext.tier.slice(1)} (${tierContext.rangeLabel})`,
          note: `${r.serviceLine} occupancy is ${formatPct(tierContext.occupancyPct)}. This tier sets the resident and Street Rate guardrails used below.`,
        }]
      : []),
    { label: "Current in-house rate", value: formatMoney(r.currentRateMonthly) },
    {
      label: `Street rate — ${RATE_PRODUCT_LABEL[r.rateProduct].toLowerCase()}`,
      value: r.streetRateMonthly > 0 ? formatMoney(r.streetRateMonthly) : "not available",
      note: [streetSourceNote(r), streetRiseNote(r, effectiveStreet)]
        .filter(Boolean)
        .join(" "),
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
  if (tierContext) {
    narrative.push(
      `${formatPct(tierContext.occupancyPct)} occupancy places ${r.serviceLine} in its ${tierContext.tier} tier. This recommendation uses that tier's ${formatPct(assumptions.minInhouseIncreasePct)} to ${formatPct(assumptions.maxInhouseIncreasePct)} resident increase range.`,
    );
  }
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
  const currentStreetPremiumPct =
    summary.currentAvgInhouseRateMonthly > 0
      ? (ctx.currentStreetRateMonthly / summary.currentAvgInhouseRateMonthly - 1) * 100
      : 0;
  const recommendedStreetPremiumPct =
    summary.newAvgInhouseRateMonthly > 0
      ? (solved.recommendedStreetMonthly / summary.newAvgInhouseRateMonthly - 1) * 100
      : 0;
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
      label: "In-house rate · current → recommended",
      value: `${formatMoney(summary.currentAvgInhouseRateMonthly)} → ${formatMoney(summary.newAvgInhouseRateMonthly)}`,
      note: `${formatPct(solved.requiredAvgIncrease * 100, 2)} increase, effective ${a.inhouseEffectiveDate}. Both values use the same private-pay resident rooms and resident-day weights.`,
    },
    {
      label: "Street Rate · current → recommended",
      value: `${formatMoney(ctx.currentStreetRateMonthly)} → ${formatMoney(solved.recommendedStreetMonthly)}`,
      note: `${formatPct(solved.streetIncrease * 100)} increase, effective ${a.streetRateEffectiveDate}. Both values use the same private-pay room and payer mix as the in-house comparison.`,
    },
    {
      label: "Street premium over in-house · current → recommended",
      value: `${formatPct(currentStreetPremiumPct, 2)} → ${formatPct(recommendedStreetPremiumPct, 2)}`,
      note: "Current is compared with current and recommended with recommended, using the same matched resident-room cohort.",
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

function describeComparison(c: QuarterComparison): RateMixComparison {
  return {
    baseQuarterLabel: c.baseQuarterLabel,
    endingQuarterLabel: c.endingQuarterLabel,
    rawChangePct: c.rawChangePct,
    rateEffectPct: c.rateEffectPct,
    mixEffectPct: c.mixEffectPct,
    baseWeightedRateEffectPct:
      c.baseWeightedRatio != null ? (c.baseWeightedRatio - 1) * 100 : null,
    compositionEffectPct: c.compositionEffectPct,
    matchedRooms: c.matchedRooms,
    endingRooms: c.endingRooms,
    coverageByCountPct: c.coverageByCountPct,
    coverageByRevenuePct: c.coverageByRevenuePct,
    suppressedStrata: c.suppressedStrata,
    usable: c.usable,
    reasonCode: c.reasonCode,
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
  priorJanuaryMonth: string;
  januaryMatchCoverage: number;
  /** Prior-year quarters withheld because no stratum in them could be believed. */
  suppressedQuarters: Map<string, string>;
  /** Comparisons that stand, but with part of the portfolio unmeasured. */
  thinComparisons: Array<{
    baseQuarterLabel: string;
    suppressedStrata: Array<{ key: string; reasonCode: string }>;
    coverageByCountPct: number;
  }>;
  /** Quarters where a whole room type went unmeasured and others stood in. */
  crossUnitRedistribution: string[];
  minMatchedRooms: number;
  coverageFloorPct: number;
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
    const describePartial = (p: BaselineQuarter) => {
      const expected = Array.from({ length: 3 }, (_, offset) => {
        const month = (p.quarter - 1) * 3 + offset + 1;
        return `${p.year}-${String(month).padStart(2, "0")}`;
      });
      const available = new Set(p.availableMonths ?? []);
      const missing = expected.filter((month) => !available.has(month));
      const missingLabel = missing.length > 0 ? `; no qualifying rows for ${missing.join(", ")}` : "";
      return `${p.label} (${p.monthsAvailable} of 3 months${missingLabel})`;
    };
    warnings.push(
      `Prior-year baseline for ${partial
        .map(describePartial)
        .join(", ")} is based only on months with qualifying imported planning rows.`,
    );
  }
  if (ctx.suppressedQuarters.size > 0) {
    const detail = Array.from(ctx.suppressedQuarters)
      .map(([label, code]) => `${label} (${code})`)
      .join(", ");
    warnings.push(
      `No prior-year rate is reported for ${detail}. Too few of the rooms priced today could be matched back to a rate in those quarters to measure price movement, so the number is withheld rather than shown with a caveat.`,
    );
  }
  if (ctx.thinComparisons.length > 0) {
    const detail = ctx.thinComparisons
      .map(
        (c) =>
          `${c.baseQuarterLabel} (${c.suppressedStrata.length} of the room groups, ${Math.round(c.coverageByCountPct)}% of rooms matched overall)`,
      )
      .join(", ");
    warnings.push(
      `Part of the portfolio could not be matched back to ${detail}. Those room groups were left out of the comparison and their share reassigned to comparable groups, so the prior-year rate rests on the rooms that could be matched.`,
    );
  }
  if (ctx.crossUnitRedistribution.length > 0) {
    warnings.push(
      `For ${ctx.crossUnitRedistribution.join(", ")}, an entire room type went unmeasured and its share was carried by different room types. A studio standing in for a two-bedroom is a weaker comparison than one room type standing in for its own price bands — read those quarters as indicative.`,
    );
  }
  if (ctx.januaryMatchCoverage < 0.8) {
    warnings.push(
      `Only ${Math.round(ctx.januaryMatchCoverage * 100)}% of today's priced rooms could be matched back to a comparable ${ctx.priorJanuaryMonth} room, so the January-to-January Street Rate maximum is measured on that subset.`,
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
