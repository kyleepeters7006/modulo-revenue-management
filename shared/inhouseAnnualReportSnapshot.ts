import type { PlanResult } from "./inhousePlanning";

export interface IncreaseDistributionBand {
  label: string;
  count: number;
}

export type AnnualReportPlanSnapshot = PlanResult & {
  increaseDistribution: IncreaseDistributionBand[];
};

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
    // Keep only the quarter conclusions used by the restored growth snapshot.
    // Solver narratives and room-level bridges are large and are not rendered
    // by either annual-report surface.
    quarters: plan.quarters.map((quarter) => ({
      year: quarter.year,
      quarter: quarter.quarter,
      label: quarter.label,
      passes: quarter.passes,
      projectedRateMonthly: quarter.projectedRateMonthly,
      yoyGrowthPct: quarter.yoyGrowthPct,
      priorYear: quarter.priorYear,
    })),
    monthlyRateProjection: plan.monthlyRateProjection,
    bindingQuarterLabel: plan.bindingQuarterLabel,
    adjustedTopCompetitorRateMonthly: plan.adjustedTopCompetitorRateMonthly,
    summary,
    residents: [],
    targetDeviationDiagnostic: plan.targetDeviationDiagnostic,
    warnings: plan.warnings,
    increaseDistribution,
  } as unknown as AnnualReportPlanSnapshot;
}