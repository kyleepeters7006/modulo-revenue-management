export type AnnualIncreasePrefix = "ihPlan" | "ihRecommendation";

export interface AnnualIncreaseRollup {
  planId: string | null;
  planStatus: "applied" | "proposed" | null;
  residents: number | null;
  newRate: number | null;
  currentRate: number | null;
  deltaDollar: number | null;
  deltaPct: number | null;
  monthlyImpact: number | null;
  effectiveDate: string | null;
  streetRate: number | null;
  streetEffectiveDate: string | null;
}

export interface AnnualStreetIncreaseRollup {
  planId: string | null;
  planStatus: "applied" | "proposed" | null;
  newRate: number | null;
  currentRate: number | null;
  deltaDollar: number | null;
  deltaPct: number | null;
  effectiveDate: string | null;
}

/**
 * Roll room or room-type annual-increase rows upward.
 *
 * Rates and display-basis deltas are weighted by covered residents, monthly
 * impact is summed, and percentages are re-derived from summed components.
 * Null/uncovered rows never enter a denominator.
 */
export function rollupAnnualIncrease(
  rows: Record<string, any>[],
  prefix: AnnualIncreasePrefix,
): AnnualIncreaseRollup {
  let residents = 0;
  let newRateSum = 0;
  let currentRateSum = 0;
  let displayDeltaSum = 0;
  let monthlyImpactSum = 0;
  let effectiveDate: string | null = null;
  let streetRateSum = 0;
  let streetRateResidents = 0;
  let streetEffectiveDate: string | null = null;
  const planIds = new Set<string>();
  const planStatuses = new Set<"applied" | "proposed">();

  for (const row of rows) {
    const covered = Number(row[`${prefix}Residents`] ?? 0);
    if (!Number.isFinite(covered) || covered <= 0) continue;

    const newRateRaw = row[`${prefix}NewRate`];
    const currentRateRaw = row[`${prefix}CurrentRate`];
    const deltaDollarRaw = row[`${prefix}DeltaDollar`];
    const monthlyImpactRaw = row[`${prefix}MonthlyImpact`];
    if (
      newRateRaw === null || newRateRaw === undefined ||
      currentRateRaw === null || currentRateRaw === undefined ||
      deltaDollarRaw === null || deltaDollarRaw === undefined ||
      monthlyImpactRaw === null || monthlyImpactRaw === undefined
    ) continue;

    const newRate = Number(newRateRaw);
    const currentRate = Number(currentRateRaw);
    const deltaDollar = Number(deltaDollarRaw);
    const monthlyImpact = Number(monthlyImpactRaw);

    // A covered row without its rate components is incomplete. Excluding the
    // whole row prevents a plausible-looking average with a mismatched
    // resident denominator.
    if (
      !Number.isFinite(newRate) ||
      !Number.isFinite(currentRate) ||
      !Number.isFinite(deltaDollar) ||
      !Number.isFinite(monthlyImpact)
    ) continue;

    residents += covered;
    const planId = row[`${prefix}PlanId`];
    if (planId) planIds.add(String(planId));
    const planStatus = row[`${prefix}Status`];
    if (planStatus === "applied" || planStatus === "proposed") planStatuses.add(planStatus);
    newRateSum += newRate * covered;
    currentRateSum += currentRate * covered;
    displayDeltaSum += deltaDollar * covered;
    monthlyImpactSum += monthlyImpact;
    if (effectiveDate === null && row[`${prefix}EffectiveDate`]) {
      effectiveDate = String(row[`${prefix}EffectiveDate`]);
    }
    const streetRateRaw = row[`${prefix}StreetRate`];
    if (streetRateRaw !== null && streetRateRaw !== undefined && Number.isFinite(Number(streetRateRaw))) {
      streetRateSum += Number(streetRateRaw) * covered;
      streetRateResidents += covered;
    }
    if (streetEffectiveDate === null && row[`${prefix}StreetEffectiveDate`]) {
      streetEffectiveDate = String(row[`${prefix}StreetEffectiveDate`]);
    }
  }

  return {
    planId: planIds.size === 1 ? [...planIds][0] : null,
    planStatus: planStatuses.size === 1 ? [...planStatuses][0] : null,
    residents: residents || null,
    newRate: residents ? newRateSum / residents : null,
    currentRate: residents ? currentRateSum / residents : null,
    deltaDollar: residents ? displayDeltaSum / residents : null,
    deltaPct: currentRateSum > 0 ? displayDeltaSum / currentRateSum : null,
    monthlyImpact: residents ? monthlyImpactSum : null,
    effectiveDate,
    streetRate: streetRateResidents ? streetRateSum / streetRateResidents : null,
    streetEffectiveDate,
  };
}

/**
 * Roll an annual-plan street target upward using total units. Street plans
 * apply to asking rates for vacant and occupied units, unlike the in-house
 * plan, which is intentionally resident-scoped.
 */
export function rollupAnnualStreetIncrease(
  rows: Record<string, any>[],
  prefix: AnnualIncreasePrefix,
): AnnualStreetIncreaseRollup {
  let units = 0;
  let newRateSum = 0;
  let currentRateSum = 0;
  let effectiveDate: string | null = null;
  const planIds = new Set<string>();
  const statuses = new Set<"applied" | "proposed">();

  for (const row of rows) {
    const newRate = Number(row[`${prefix}StreetRate`]);
    const currentRate = Number(row.streetSpot);
    const weight = Number(row.totalUnits ?? 0);
    if (!Number.isFinite(newRate) || !Number.isFinite(currentRate) || currentRate <= 0 || weight <= 0) {
      continue;
    }
    units += weight;
    newRateSum += newRate * weight;
    currentRateSum += currentRate * weight;
    const planId = row[`${prefix}PlanId`];
    if (planId) planIds.add(String(planId));
    const status = row[`${prefix}StreetStatus`];
    if (status === "applied" || status === "proposed") statuses.add(status);
    if (effectiveDate === null && row[`${prefix}StreetEffectiveDate`]) {
      effectiveDate = String(row[`${prefix}StreetEffectiveDate`]);
    }
  }

  const newRate = units > 0 ? newRateSum / units : null;
  const currentRate = units > 0 ? currentRateSum / units : null;
  const deltaDollar = newRate !== null && currentRate !== null ? newRate - currentRate : null;
  return {
    planId: planIds.size === 1 ? [...planIds][0] : null,
    planStatus: statuses.size === 1 ? [...statuses][0] : null,
    newRate,
    currentRate,
    deltaDollar,
    deltaPct: currentRate && deltaDollar !== null ? deltaDollar / currentRate : null,
    effectiveDate,
  };
}
