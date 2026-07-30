/**
 * Shared aggregation constants and helpers for the Reference Data table.
 *
 * These are imported by:
 *   - client/src/components/dashboard/reference-data-table.tsx  (runtime)
 *   - tests/e2e/elasticity-rollup-parity.spec.ts               (regression test)
 *
 * Keeping them in one place ensures the test exercises the production key list
 * and aggregation logic — not a separately maintained copy.
 */

/** Fields summed across rows when rolling up to a group level. */
export const AGG_SUM_KEYS: string[] = [
  "totalUnits", "vacantSpot", "vacantT3", "vacantT12", "hcPrivatePaySpot",
  "revT3MoveIns", "moveInsLatest", "moveOutsLatest", "moveNetLatest",
  "revMonthlyImpact", "revAnnualImpact", "elasticityMonthlyImpact", "elasticityAnnualImpact",
];

/**
 * Fields aggregated with a unit-count-weighted average when rolling up rows.
 * Adding or removing a key here directly changes what the table rolls up;
 * the regression test imports this list so it will fail if a key is dropped.
 */
export const AGG_WAVG_KEYS: string[] = [
  "rtOccSpot", "rtOccT3", "rtOccT12", "daysVacantSpot", "daysVacantT3",
  "streetSpot", "streetIncT3", "streetIncT12", "compBase", "compAdjusted",
  "ihSpot", "ihIncT3", "ihIncT12", "proposedRule",
  "elasticity", "elasticityTrend", "daysToSellBefore", "daysToSellAfter", "daysToSellChange", "predictedDaysToSellChange",
  "revenueGrowthTarget", "revYtdGrowth", "revImpactPct",
  "ihT3avg", "ihT12avg", "streetT3avg", "streetT12avg",
];

/**
 * Unit-count-weighted average of `get(row)` across `rows`.
 * Mirrors the inline closure inside `aggregateRows` in reference-data-table.tsx.
 * Returns null when every row yields a null/undefined value.
 */
export function wavg(
  rows: Record<string, any>[],
  get: (r: Record<string, any>) => any,
): number | null {
  let n = 0, d = 0;
  for (const r of rows) {
    const v = get(r);
    if (v !== null && v !== undefined) {
      const w = Number(r.totalUnits) || 1;
      n += Number(v) * w;
      d += w;
    }
  }
  return d ? n / d : null;
}
