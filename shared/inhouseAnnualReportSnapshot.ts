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
    // Keep quarter conclusions for reopening a saved campus result, but omit
    // room-level bridge rows: those are the large repeated arrays the report
    // does not render.
    quarters: plan.quarters.map(({ roomDetails: _roomDetails, ...quarter }) => quarter),
    monthlyRateProjection: plan.monthlyRateProjection,
    bindingQuarterLabel: plan.bindingQuarterLabel,
    adjustedTopCompetitorRateMonthly: plan.adjustedTopCompetitorRateMonthly,
    summary,
    residents: [],
    planningSignals: plan.planningSignals,
    infeasibility: plan.infeasibility,
    optimizationNote: plan.optimizationNote,
    targetDeviationDiagnostic: plan.targetDeviationDiagnostic,
    explanation: plan.explanation,
    warnings: plan.warnings,
    standardization: plan.standardization,
    increaseDistribution,
  } as unknown as AnnualReportPlanSnapshot;
}