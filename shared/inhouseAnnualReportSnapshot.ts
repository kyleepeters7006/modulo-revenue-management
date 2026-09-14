import type { PlanResult, QuarterResult } from "./inhousePlanning";

export interface IncreaseDistributionBand {
  label: string;
  count: number;
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

const DISTRIBUTION_BANDS = [
  { label: "<3%", min: -Infinity, max: 3 },
  { label: "3–4.9%", min: 3, max: 5 },
  { label: "5–5.9%", min: 5, max: 6 },
  { label: "6–6.9%", min: 6, max: 7 },
  { label: "7–7.9%", min: 7, max: 8 },
  { label: "8%+", min: 8, max: Infinity },
] as const;

/**
 * Annual reports are presentation snapshots. Keep every calculated aggregate
 * the report renders, but replace repeated resident and quarter-room arrays
 * with the six counts needed for the distribution.
 */
export function compactPlanForAnnualReport(plan: PlanResult): AnnualReportPlanSnapshot {
  const affected = plan.residents.filter(({ increasePct }) => increasePct > 0);
  const increaseDistribution = DISTRIBUTION_BANDS.map((band) => ({
    label: band.label,
    count: affected.filter(
      ({ increasePct }) => increasePct >= band.min && increasePct < band.max,
    ).length,
  }));

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
  };
}
