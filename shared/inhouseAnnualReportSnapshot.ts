import type { PlanResult, QuarterResult } from "./inhousePlanning";

export interface IncreaseDistributionBand {
  label: string;
  count: number;
}

export const RESIDENT_INCREASE_TIER_LABELS = [
  "<3%",
  "3.0%",
  "3.5%",
  "4.0%",
  "4.5%",
  "5.0%",
  "5.5%",
  "6.0%",
  "6.5%",
  "7.0%",
  "7.5%",
  "8.0%",
  "8.5%",
  "9.0%+",
] as const;

export type ResidentIncreaseTierLabel = typeof RESIDENT_INCREASE_TIER_LABELS[number];

export function residentIncreaseTier(value: number): ResidentIncreaseTierLabel {
  if (!Number.isFinite(value) || value < 3) return "<3%";
  if (value >= 9) return "9.0%+";
  const halfPoint = Math.floor(value * 2 + 1e-9) / 2;
  return `${halfPoint.toFixed(1)}%` as ResidentIncreaseTierLabel;
}

export function residentIncreaseDistribution(
  residents: ReadonlyArray<{ increasePct: number }>,
): IncreaseDistributionBand[] {
  const counts = new Map<ResidentIncreaseTierLabel, number>(
    RESIDENT_INCREASE_TIER_LABELS.map((label) => [label, 0]),
  );
  for (const resident of residents) {
    const label = residentIncreaseTier(resident.increasePct);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return RESIDENT_INCREASE_TIER_LABELS.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
  }));
}

/**
 * The quarterly summary can be restored without solver-only values. Keep the
 * fields used by the report required, while making the omitted detail values
 * explicitly optional so consumers cannot assume the full solver result.
 */
export type AnnualReportQuarterSnapshot = Pick<
  QuarterResult,
  "year" | "quarter" | "label" | "passes" | "projectedRateMonthly" | "yoyGrowthPct" | "priorYear"
> & {
  requiredRateMonthly?: number;
  shortfallPct?: number;
  isBinding?: boolean;
};

export interface AnnualReportPlanSnapshot {
  scope: PlanResult["scope"];
  assumptions: PlanResult["assumptions"];
  feasible: PlanResult["feasible"];
  rateBasis: PlanResult["rateBasis"];
  currentStreetRateMonthly: PlanResult["currentStreetRateMonthly"];
  recommendedStreetRateMonthly: PlanResult["recommendedStreetRateMonthly"];
  streetIncreasePct: PlanResult["streetIncreasePct"];
  streetIncreaseDollarsMonthly: PlanResult["streetIncreaseDollarsMonthly"];
  currentStreetRateDisplay: PlanResult["currentStreetRateDisplay"];
  recommendedStreetRateDisplay: PlanResult["recommendedStreetRateDisplay"];
  requiredWeightedAvgIncreasePct: PlanResult["requiredWeightedAvgIncreasePct"];
  quarters: AnnualReportQuarterSnapshot[];
  monthlyRateProjection: PlanResult["monthlyRateProjection"];
  bindingQuarterLabel: PlanResult["bindingQuarterLabel"];
  adjustedTopCompetitorRateMonthly: PlanResult["adjustedTopCompetitorRateMonthly"];
  summary: PlanResult["summary"];
  residents: [];
  targetDeviationDiagnostic: PlanResult["targetDeviationDiagnostic"];
  warnings: PlanResult["warnings"];
  increaseDistribution: IncreaseDistributionBand[];
  /** Full resident-recommendation distribution used by the page-3 charts. */
  residentIncreaseDistribution?: IncreaseDistributionBand[];
}

export interface AnnualRateGrowthBridge {
  priorYearAverageRateMonthly: number;
  projectedPlanYearAverageRateMonthly: number;
  priorPeriodIncreasePct: number;
  planIncreasePct: number;
  fullYearYoyPct: number;
}

export function annualRateGrowthRevenue(
  bridge: AnnualRateGrowthBridge | null,
  residentCount: number,
): number | null {
  if (
    !bridge ||
    !Number.isFinite(residentCount) ||
    residentCount < 0
  ) return null;
  return (
    bridge.projectedPlanYearAverageRateMonthly -
    bridge.priorYearAverageRateMonthly
  ) * residentCount * 12;
}

/**
 * Splits projected full-year YoY into the annual-plan increase shown in the
 * report and the remaining increase carried from prior pricing periods.
 */
export function annualRateGrowthBridge(
  quarters: AnnualReportQuarterSnapshot[],
  rateBasis: PlanResult["rateBasis"],
  planIncreasePct: number,
): AnnualRateGrowthBridge | null {
  let priorWeighted = 0;
  let projectedWeighted = 0;
  let priorWeight = 0;
  let projectedWeight = 0;

  for (const quarter of quarters) {
    const prior = quarter.priorYear.realizedRateMonthly;
    if (
      prior == null ||
      prior <= 0 ||
      !Number.isFinite(prior) ||
      !Number.isFinite(quarter.projectedRateMonthly)
    ) continue;
    const periodWeight = rateBasis === "monthly"
      ? 3
      : (
          Date.UTC(quarter.year, quarter.quarter * 3, 1) -
          Date.UTC(quarter.year, (quarter.quarter - 1) * 3, 1)
        ) / 86_400_000;
    const priorPeriodWeight = rateBasis === "monthly"
      ? 3
      : (
          Date.UTC(quarter.priorYear.year, quarter.priorYear.quarter * 3, 1) -
          Date.UTC(quarter.priorYear.year, (quarter.priorYear.quarter - 1) * 3, 1)
        ) / 86_400_000;
    priorWeighted += prior * priorPeriodWeight;
    projectedWeighted += quarter.projectedRateMonthly * periodWeight;
    priorWeight += priorPeriodWeight;
    projectedWeight += periodWeight;
  }

  if (priorWeight <= 0 || projectedWeight <= 0 || !Number.isFinite(planIncreasePct)) return null;
  const priorYearAverageRateMonthly = priorWeighted / priorWeight;
  const projectedPlanYearAverageRateMonthly = projectedWeighted / projectedWeight;
  if (priorYearAverageRateMonthly <= 0) return null;
  const fullYearYoyPct =
    (projectedPlanYearAverageRateMonthly / priorYearAverageRateMonthly - 1) * 100;
  return {
    priorYearAverageRateMonthly,
    projectedPlanYearAverageRateMonthly,
    priorPeriodIncreasePct: fullYearYoyPct - planIncreasePct,
    planIncreasePct,
    fullYearYoyPct,
  };
}

/**
 * Older compact snapshots omitted fields that the restored quarterly table
 * displays. Rebuild those deterministic values so saved reports remain useful.
 */
export function hydrateAnnualReportPlanSnapshot(
  plan: AnnualReportPlanSnapshot,
): AnnualReportPlanSnapshot {
  const targetPct = plan.assumptions.rateGrowthTargetPct;
  return {
    ...plan,
    quarters: plan.quarters.map((quarter) => {
      const priorRate = quarter.priorYear.realizedRateMonthly;
      const hasTarget = Number.isFinite(targetPct);
      const hasYoy = Number.isFinite(quarter.yoyGrowthPct);
      return {
        ...quarter,
        requiredRateMonthly:
          quarter.requiredRateMonthly ??
          (priorRate == null || !Number.isFinite(priorRate) || !hasTarget
            ? undefined
            : priorRate * (1 + targetPct / 100)),
        shortfallPct:
          quarter.shortfallPct ??
          (quarter.passes
            ? 0
            : hasTarget && hasYoy
              ? Math.max(0, targetPct - quarter.yoyGrowthPct)
              : undefined),
        isBinding:
          quarter.isBinding ??
          (plan.bindingQuarterLabel != null && quarter.label === plan.bindingQuarterLabel),
      };
    }),
  };
}

/**
 * Annual reports are presentation snapshots. Keep every calculated aggregate
 * the report renders, but replace repeated resident and quarter-room arrays
 * with the tier counts needed for the distribution.
 */
export function compactPlanForAnnualReport(plan: PlanResult): AnnualReportPlanSnapshot {
  const increaseDistribution = residentIncreaseDistribution(
    plan.residents.filter(({ increasePct }) => increasePct > 0),
  );
  const fullResidentIncreaseDistribution = residentIncreaseDistribution(plan.residents);

  const {
    streetRateRecommendations: _legacyRecommendations,
    streetRateRecommendationSnapshot: _recommendationSnapshot,
    ...summary
  } = plan.summary;

  return {
    scope: plan.scope,
    assumptions: plan.assumptions,
    feasible: plan.feasible,
    rateBasis: plan.rateBasis,
    currentStreetRateMonthly: plan.currentStreetRateMonthly,
    recommendedStreetRateMonthly: plan.recommendedStreetRateMonthly,
    streetIncreasePct: plan.streetIncreasePct,
    streetIncreaseDollarsMonthly: plan.streetIncreaseDollarsMonthly,
    currentStreetRateDisplay: plan.currentStreetRateDisplay,
    recommendedStreetRateDisplay: plan.recommendedStreetRateDisplay,
    requiredWeightedAvgIncreasePct: plan.requiredWeightedAvgIncreasePct,
    // Keep the small quarter conclusions rendered by the restored summary.
    // Solver narratives and room-level bridges remain excluded.
    quarters: plan.quarters.map((quarter) => ({
      year: quarter.year,
      quarter: quarter.quarter,
      label: quarter.label,
      passes: quarter.passes,
      projectedRateMonthly: quarter.projectedRateMonthly,
      yoyGrowthPct: quarter.yoyGrowthPct,
      priorYear: quarter.priorYear,
      requiredRateMonthly: quarter.requiredRateMonthly,
      shortfallPct: quarter.shortfallPct,
      isBinding: quarter.isBinding,
    })),
    monthlyRateProjection: plan.monthlyRateProjection,
    bindingQuarterLabel: plan.bindingQuarterLabel,
    adjustedTopCompetitorRateMonthly: plan.adjustedTopCompetitorRateMonthly,
    summary,
    residents: [],
    targetDeviationDiagnostic: plan.targetDeviationDiagnostic,
    warnings: plan.warnings,
    increaseDistribution,
    residentIncreaseDistribution: fullResidentIncreaseDistribution,
  };
}
