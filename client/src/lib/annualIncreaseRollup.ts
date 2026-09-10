export type AnnualIncreasePrefix = "ihPlan" | "ihRecommendation";

export interface AnnualIncreaseRollup {
  residents: number | null;
  newRate: number | null;
  currentRate: number | null;
  deltaDollar: number | null;
  deltaPct: number | null;
  monthlyImpact: number | null;
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
    newRateSum += newRate * covered;
    currentRateSum += currentRate * covered;
    displayDeltaSum += deltaDollar * covered;
    monthlyImpactSum += monthlyImpact;
    if (effectiveDate === null && row[`${prefix}EffectiveDate`]) {
      effectiveDate = String(row[`${prefix}EffectiveDate`]);
    }
  }

  return {
    residents: residents || null,
    newRate: residents ? newRateSum / residents : null,
    currentRate: residents ? currentRateSum / residents : null,
    deltaDollar: residents ? displayDeltaSum / residents : null,
    deltaPct: currentRateSum > 0 ? displayDeltaSum / currentRateSum : null,
    monthlyImpact: residents ? monthlyImpactSum : null,
    effectiveDate,
  };
}
