/**
 * Pure, deterministic helpers for the one-time AI-informed Street Rate run.
 *
 * The model may supply a rationale, but it never supplies the arithmetic:
 * ceilings, actions, contributions, and rebalancing are all calculated here.
 */

export type StreetRecommendationAction = "push" | "measured_increase" | "hold";

export interface StreetRateRecommendationInput {
  id: string;
  location: string;
  benchmarkLocation?: string;
  locationId?: string | null;
  serviceLine: string;
  product: string;
  currentStreetRate: number;
  topCompetitorRate: number | null;
  occupancyPct?: number | null;
  units: number;
  maxStreetIncreasePct: number;
  maxYoYStreetIncreasePct?: number;
  priorJanuaryStreetRate?: number | null;
  aiSuggestedRate?: number | null;
  locked?: boolean;
  editedRate?: number | null;
}

export interface StreetRateRecommendation {
  id: string;
  location: string;
  benchmarkLocation?: string;
  locationId: string | null;
  serviceLine: string;
  product: string;
  currentStreetRate: number;
  topCompetitorRate: number | null;
  premiumCeilingRate: number | null;
  hardCeiling: number;
  suggestedRate: number;
  suggestedIncreasePct: number;
  action: StreetRecommendationAction;
  rationale: string;
  units: number;
  occupancyPct: number | null;
  locked: boolean;
  growthContribution: number;
  validation: string[];
}

export interface RebalanceResult {
  recommendations: StreetRateRecommendation[];
  targetContribution: number;
  achievedContribution: number;
  shortfallContribution: number;
  achievedGrowthPct: number;
  targetGrowthPct: number;
  feasible: boolean;
  changedIds: string[];
  message: string;
}

export function premiumCeiling(
  topCompetitorRate: number | null,
  maximumPremiumPct: number,
): number | null {
  if (!(topCompetitorRate !== null && Number.isFinite(topCompetitorRate) && topCompetitorRate > 0)) {
    return null;
  }
  const premium = Math.max(0, Math.min(100, Number(maximumPremiumPct) || 0));
  return topCompetitorRate * (1 + premium / 100);
}

function roundRate(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function hardCeiling(row: StreetRateRecommendationInput, maximumPremiumPct: number): number {
  const premium = premiumCeiling(row.topCompetitorRate, maximumPremiumPct);
  if (premium === null) return roundRate(row.currentStreetRate);
  const annualCap = row.currentStreetRate > 0
    ? row.currentStreetRate * (1 + Math.max(0, row.maxStreetIncreasePct) / 100)
    : 0;
  const yoyCap = row.priorJanuaryStreetRate != null && row.priorJanuaryStreetRate > 0
    ? row.priorJanuaryStreetRate * (1 + Math.max(0, row.maxYoYStreetIncreasePct ?? 100) / 100)
    : Number.POSITIVE_INFINITY;
  const cap = Math.min(
    premium,
    annualCap > 0 ? annualCap : Number.POSITIVE_INFINITY,
    yoyCap,
  );
  return Number.isFinite(cap) ? roundRate(cap) : roundRate(row.currentStreetRate);
}

export function buildStreetRateRecommendation(
  row: StreetRateRecommendationInput,
  maximumPremiumPct: number,
): StreetRateRecommendation {
  const ceiling = premiumCeiling(row.topCompetitorRate, maximumPremiumPct);
  const maxRate = hardCeiling(row, maximumPremiumPct);
  const validation: string[] = [];
  const current = Math.max(0, Number(row.currentStreetRate) || 0);
  const occupancy = row.occupancyPct == null ? null : Math.max(0, Math.min(100, Number(row.occupancyPct)));

  if (ceiling === null) validation.push("No authoritative Top Competitor benchmark; recommendation is held.");
  if (ceiling !== null && current >= ceiling - 0.005) {
    validation.push("Current Street Rate is already at or above the premium ceiling.");
  }
  if (maxRate < current - 0.005) {
    validation.push("Existing Street Rate exceeds the configured annual increase guardrail; it is not reduced automatically.");
  }
  if (row.priorJanuaryStreetRate != null && maxRate < current - 0.005) {
    validation.push("Existing Street Rate is already above the January-to-January guardrail; it is not reduced automatically.");
  }

  const available = Math.max(0, maxRate - current);
  const demandPush = occupancy !== null && occupancy >= 90;
  const action: StreetRecommendationAction =
    ceiling === null || current >= (ceiling ?? current) - 0.005 || available <= 0
      ? "hold"
      : demandPush
        ? "push"
        : "measured_increase";

  const defaultRate = action === "hold"
    ? current
    : current + available * (action === "push" ? 1 : 0.5);
  const requested = row.editedRate ?? row.aiSuggestedRate ?? defaultRate;
  const suggestedRate = roundRate(Math.max(current, Math.min(maxRate, Number(requested) || current)));
  const suggestedIncreasePct = current > 0 ? ((suggestedRate / current) - 1) * 100 : 0;
  const finalAction: StreetRecommendationAction =
    suggestedRate <= current + 0.005 ? "hold" : action;

  return {
    id: row.id,
    location: row.location,
    benchmarkLocation: row.benchmarkLocation,
    locationId: row.locationId ?? null,
    serviceLine: row.serviceLine,
    product: row.product,
    currentStreetRate: roundRate(current),
    topCompetitorRate: row.topCompetitorRate == null ? null : roundRate(row.topCompetitorRate),
    premiumCeilingRate: ceiling == null ? null : roundRate(ceiling),
    hardCeiling: maxRate,
    suggestedRate,
    suggestedIncreasePct,
    action: finalAction,
    rationale:
      finalAction === "hold"
        ? validation[0] ?? "Hold: no additional competitive headroom is supported."
        : finalAction === "push"
          ? "Push: occupancy is strong and competitive headroom supports the increase."
          : "Measured increase: competitive headroom exists, but demand signals support a staged move.",
    units: Math.max(0, Number(row.units) || 0),
    occupancyPct: occupancy,
    locked: row.locked === true,
    growthContribution: Math.max(0, Number(row.units) || 0) * current * (suggestedRate / Math.max(current, 1) - 1),
    validation,
  };
}

/**
 * Rebalances only unlocked rows. Locked values are copied byte-for-byte from
 * the input, while unlocked rows move toward their hard ceilings or back to
 * their current rates to reconcile the requested realized-rate growth.
 */
export function rebalanceStreetRateRecommendations(
  rows: StreetRateRecommendation[],
  targetGrowthPct: number,
): RebalanceResult {
  const requestedTarget = Number(targetGrowthPct);
  if (Number.isFinite(requestedTarget) && requestedTarget < 0) {
    const baseContribution = rows.reduce((sum, r) => sum + r.units * r.currentStreetRate, 0);
    const targetContribution = baseContribution * requestedTarget / 100;
    const achievedContribution = rows.reduce((sum, r) => sum + r.growthContribution, 0);
    return {
      recommendations: rows.map((r) => ({ ...r })),
      targetContribution,
      achievedContribution,
      shortfallContribution: Math.abs(targetContribution) + Math.max(0, achievedContribution),
      achievedGrowthPct: baseContribution > 0 ? achievedContribution / baseContribution * 100 : 0,
      targetGrowthPct: requestedTarget,
      feasible: false,
      changedIds: [],
      message: "Negative Street Rate growth targets are not supported; use zero or a positive target.",
    };
  }
  const target = Math.max(-100, Number(targetGrowthPct) || 0);
  const baseContribution = rows.reduce((sum, r) => sum + r.units * r.currentStreetRate, 0);
  const targetContribution = baseContribution * target / 100;
  const lockedContribution = rows
    .filter((r) => r.locked)
    .reduce((sum, r) => sum + r.growthContribution, 0);
  const unlocked = rows.filter((r) => !r.locked);
  const currentUnlockedContribution = unlocked.reduce((sum, r) => sum + r.growthContribution, 0);
  let remaining = targetContribution - lockedContribution;
  const next = rows.map((r) => ({ ...r }));
  const changedIds: string[] = [];

  // Start from the AI proposal, then add or remove only unlocked growth.
  if (remaining > currentUnlockedContribution) {
    const extra = remaining - currentUnlockedContribution;
    const capacity = unlocked.reduce(
      (sum, r) => sum + Math.max(0, r.units * r.currentStreetRate * (r.hardCeiling / Math.max(r.currentStreetRate, 1) - 1) - r.growthContribution),
      0,
    );
    for (const r of next) {
      if (r.locked || capacity <= 0) continue;
      const rowCapacity = Math.max(0, r.units * r.currentStreetRate * (r.hardCeiling / Math.max(r.currentStreetRate, 1) - 1) - r.growthContribution);
      const add = extra * rowCapacity / capacity;
      r.suggestedRate = roundRate(Math.min(r.hardCeiling, r.suggestedRate + add / Math.max(r.units, 1)));
      if (r.suggestedRate !== rows.find((x) => x.id === r.id)?.suggestedRate) changedIds.push(r.id);
    }
  } else if (remaining < currentUnlockedContribution && currentUnlockedContribution > 0) {
    const remove = currentUnlockedContribution - Math.max(0, remaining);
    for (const r of next) {
      if (r.locked) continue;
      const removable = Math.max(0, r.growthContribution);
      const cut = remove * removable / currentUnlockedContribution;
      r.suggestedRate = roundRate(Math.max(r.currentStreetRate, r.suggestedRate - cut / Math.max(r.units, 1)));
      if (r.suggestedRate !== rows.find((x) => x.id === r.id)?.suggestedRate) changedIds.push(r.id);
    }
  }

  for (const r of next) {
    r.suggestedRate = r.locked
      ? rows.find((x) => x.id === r.id)?.suggestedRate ?? r.suggestedRate
      : roundRate(Math.max(r.currentStreetRate, Math.min(r.hardCeiling, r.suggestedRate)));
    r.suggestedIncreasePct = r.currentStreetRate > 0 ? (r.suggestedRate / r.currentStreetRate - 1) * 100 : 0;
    r.growthContribution = r.units * r.currentStreetRate * (r.suggestedRate / Math.max(r.currentStreetRate, 1) - 1);
    r.action = r.suggestedRate <= r.currentStreetRate + 0.005 ? "hold" : r.action;
  }

  const achievedContribution = next.reduce((sum, r) => sum + r.growthContribution, 0);
  const contributionDeviation = Math.abs(targetContribution - achievedContribution);
  const shortfallContribution = contributionDeviation;
  const achievedGrowthPct = baseContribution > 0 ? achievedContribution / baseContribution * 100 : 0;
  const feasible = contributionDeviation <= Math.max(0.01, Math.abs(targetContribution) * 0.0001);
  return {
    recommendations: next,
    targetContribution,
    achievedContribution,
    shortfallContribution,
    achievedGrowthPct,
    targetGrowthPct: target,
    feasible,
    changedIds: Array.from(new Set(changedIds)),
    message: feasible
      ? `Unlocked recommendations were rebalanced to ${achievedGrowthPct.toFixed(2)}% projected Street Rate growth.`
      : achievedContribution > targetContribution
        ? `${shortfallContribution.toFixed(2)} of weighted monthly growth is above target because locked recommendations cannot be reduced.`
        : `${shortfallContribution.toFixed(2)} of weighted monthly growth remains unfunded within the competitive and Street Rate guardrails.`,
  };
}