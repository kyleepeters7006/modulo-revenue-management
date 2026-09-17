import type { PlanResult, QuarterResult } from "./inhousePlanning";

/** Presentation label for annual reports; the underlying service-line code stays stable. */
export function annualReportServiceLineLabel(value: unknown): string {
  const label = String(value ?? "").trim();
  return label.toUpperCase() === "VIL" ? "Patio Homes" : label;
}

export interface IncreaseDistributionBand {
  label: string;
  count: number;
}

export interface AnnualReportResidentScatterPoint {
  id: string;
  campus: string;
  serviceLine: string;
  roomNumber: string;
  roomType: string | null;
  occupancyPct: number;
  increasePct: number;
  increaseDollarsMonthly: number;
}

/**
 * Project only the resident fields needed by the annual-report scattergram.
 * The annual report itself remains compact; this projection is built from the
 * separately saved detail snapshot at read/export time.
 */
export function annualReportResidentScatterPoints(
  detailPlans: unknown,
  tierGrid: unknown,
): AnnualReportResidentScatterPoint[] {
  const entries = Array.isArray(detailPlans)
    ? detailPlans
    : detailPlans && typeof detailPlans === "object"
      ? Object.entries(detailPlans as Record<string, unknown>).map(([sl, plan]) => ({ sl, plan }))
      : [];
  const lines = tierGrid && typeof tierGrid === "object" &&
    Array.isArray((tierGrid as { lines?: unknown }).lines)
    ? (tierGrid as { lines: Array<{ serviceLine?: unknown; occupancyPct?: unknown }> }).lines
    : [];
  const occupancyByLine = new Map(
    lines
      .filter((line) => {
        if (typeof line.serviceLine !== "string") return false;
        if (line.occupancyPct == null || line.occupancyPct === "") return false;
        return Number.isFinite(Number(line.occupancyPct));
      })
      .map((line) => [line.serviceLine as string, Number(line.occupancyPct)]),
  );
  const points: AnnualReportResidentScatterPoint[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const envelope = entry as { sl?: unknown; plan?: unknown };
    const plan = envelope.plan && typeof envelope.plan === "object"
      ? envelope.plan as {
          scope?: { serviceLine?: unknown };
          residents?: unknown;
        }
      : entry as {
          scope?: { serviceLine?: unknown };
          residents?: unknown;
        };
    const serviceLine = String(
      envelope.sl ?? plan.scope?.serviceLine ?? "",
    ).trim();
    const occupancyPct = occupancyByLine.get(serviceLine);
    if (!serviceLine || occupancyPct == null || !Number.isFinite(occupancyPct)) continue;
    if (!Array.isArray(plan.residents)) continue;

    for (const resident of plan.residents) {
      if (!resident || typeof resident !== "object") continue;
      const row = resident as Record<string, unknown>;
      const increasePct = Number(row.increasePct);
      const increaseDollarsMonthly = Number(row.increaseDollarsMonthly);
      if (!Number.isFinite(increasePct) || !Number.isFinite(increaseDollarsMonthly)) continue;
      const campus = String(row.location ?? "").trim();
      const roomNumber = String(row.roomNumber ?? "").trim();
      const roomType = row.roomType == null ? null : String(row.roomType);
      const identity = String(row.key ?? `${campus}|${roomNumber}|${row.moveInDate ?? ""}`);
      points.push({
        id: `${serviceLine}|${identity}`,
        campus,
        serviceLine,
        roomNumber,
        roomType,
        occupancyPct,
        increasePct,
        increaseDollarsMonthly,
      });
    }
  }
  return points;
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
  /**
   * The saved historical price movement used by the executive bridge.
   * This is deliberately separate from the new plan increase and from the
   * full-year modeled YoY result.
   */
  historicalIncrease?: AnnualReportHistoricalIncreaseSnapshot;
}

export interface AnnualReportHistoricalIncreaseSnapshot {
  definition: "matched_room_rate_effect";
  basePeriodLabel: string;
  endingPeriodLabel: string;
  increasePct: number;
  rawChangePct: number | null;
  mixEffectPct: number | null;
  matchedRooms: number;
  endingRooms: number;
  coverageByCountPct: number;
  coverageByRevenuePct: number;
  strata: Array<{
    key: string;
    rateEffectPct: number | null;
    endingWeightSharePct: number;
    baseWeightSharePct: number;
    matchedRooms: number;
    endingRooms: number;
    suppressed: boolean;
    reasonCode: string | null;
  }>;
}
export interface AnnualRateGrowthBridge {
  priorYearAverageRateMonthly: number;
  projectedPlanYearAverageRateMonthly: number;
  priorPeriodIncreasePct: number | null;
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
 * Combines the saved full-year modeled bridge with the independent historical
 * rate-effect measure and the new annual-plan increase. The historical value
 * is supplied from the saved matched-room diagnostic; it is never inferred as
 * the difference between full-year YoY and the plan increase.
 */
export function annualRateGrowthBridge(
  quarters: AnnualReportQuarterSnapshot[],
  rateBasis: PlanResult["rateBasis"],
  planIncreasePct: number,
  historicalIncreasePct: number | null = null,
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
    priorPeriodIncreasePct: historicalIncreasePct,
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
  const compacted = plan as PlanResult & Partial<AnnualReportPlanSnapshot>;
  const hasResidentDetails = Array.isArray(plan.residents) && plan.residents.length > 0;
  const increaseDistribution = hasResidentDetails
    ? residentIncreaseDistribution(
        plan.residents.filter(({ increasePct }) => increasePct > 0),
      )
    : compacted.increaseDistribution ?? [];
  const fullResidentIncreaseDistribution = hasResidentDetails
    ? residentIncreaseDistribution(plan.residents)
    : compacted.residentIncreaseDistribution ?? compacted.increaseDistribution ?? [];

  const {
    streetRateRecommendations: _legacyRecommendations,
    streetRateRecommendationSnapshot: _recommendationSnapshot,
    ...summary
  } = plan.summary;

  const historicalIncrease = annualReportHistoricalIncrease(plan);
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
    historicalIncrease: historicalIncrease ?? undefined,
  };
}

/**
 * Read the saved historical price-effect diagnostic from either a compact
 * annual-report plan or a full solver plan. Do not derive this from the
 * annual bridge: that would turn a historical measure back into a residual.
 */
export function annualReportHistoricalIncrease(
  plan: {
    historicalIncrease?: unknown;
    standardization?: {
      yearOverYear?: {
        baseQuarterLabel?: unknown;
        endingQuarterLabel?: unknown;
        rateEffectPct?: unknown;
        rawChangePct?: unknown;
        mixEffectPct?: unknown;
        matchedRooms?: unknown;
        endingRooms?: unknown;
        coverageByCountPct?: unknown;
        coverageByRevenuePct?: unknown;
      } | null;
      yearOverYearStrata?: Array<{
        key?: unknown;
        rateEffectPct?: unknown;
        endingWeightSharePct?: unknown;
        baseWeightSharePct?: unknown;
        matchedRooms?: unknown;
        endingRooms?: unknown;
        suppressed?: unknown;
        reasonCode?: unknown;
      }>;
    };
  },
): AnnualReportHistoricalIncreaseSnapshot | null {
  const saved = plan.historicalIncrease;
  if (saved && typeof saved === "object") {
    const value = saved as Partial<AnnualReportHistoricalIncreaseSnapshot>;
    if (
      value.definition === "matched_room_rate_effect" &&
      typeof value.basePeriodLabel === "string" &&
      typeof value.endingPeriodLabel === "string" &&
      typeof value.increasePct === "number" &&
      Number.isFinite(value.increasePct)
    ) {
      return value as AnnualReportHistoricalIncreaseSnapshot;
    }
  }

  const yoy = plan.standardization?.yearOverYear;
  if (!yoy || typeof yoy.rateEffectPct !== "number" || !Number.isFinite(yoy.rateEffectPct)) {
    return null;
  }
  const finiteOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const integerOrZero = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    definition: "matched_room_rate_effect",
    basePeriodLabel: String(yoy.baseQuarterLabel ?? ""),
    endingPeriodLabel: String(yoy.endingQuarterLabel ?? ""),
    increasePct: yoy.rateEffectPct,
    rawChangePct: finiteOrNull(yoy.rawChangePct),
    mixEffectPct: finiteOrNull(yoy.mixEffectPct),
    matchedRooms: integerOrZero(yoy.matchedRooms),
    endingRooms: integerOrZero(yoy.endingRooms),
    coverageByCountPct: finiteOrNull(yoy.coverageByCountPct) ?? 0,
    coverageByRevenuePct: finiteOrNull(yoy.coverageByRevenuePct) ?? 0,
    strata: (plan.standardization?.yearOverYearStrata ?? []).map((stratum) => ({
      key: String(stratum.key ?? ""),
      rateEffectPct: finiteOrNull(stratum.rateEffectPct),
      endingWeightSharePct: finiteOrNull(stratum.endingWeightSharePct) ?? 0,
      baseWeightSharePct: finiteOrNull(stratum.baseWeightSharePct) ?? 0,
      matchedRooms: integerOrZero(stratum.matchedRooms),
      endingRooms: integerOrZero(stratum.endingRooms),
      suppressed: stratum.suppressed === true,
      reasonCode: typeof stratum.reasonCode === "string" ? stratum.reasonCode : null,
    })),
  };
}

export interface AnnualReportGenerationStatus {
  state: "complete" | "incomplete";
  generationAt: string | null;
  expectedCampusCount: number;
  includedCampusCount: number;
  missingCampuses: Array<{
    locationId: string;
    locationName: string;
    serviceLines: string[];
  }>;
}
