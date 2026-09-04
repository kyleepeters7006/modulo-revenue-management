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
  "revT3MoveIns", "moveInsLatest", "moveInsVsT3", "moveOutsLatest", "moveOutsVsT3", "moveNetLatest",
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
  // NOTE: revYtdGrowth / ihYtdGrowth / streetYtdGrowth are listed here so the
  // roll-up produces a value at all, but aggregateRows OVERWRITES each of them
  // by re-deriving the ratio from summed spot/base components. Averaging the
  // percentages would weight a 4-unit room type like a 40-unit one.
  "revenueGrowthTarget", "revYtdGrowth", "ihYtdGrowth", "streetYtdGrowth", "revImpactPct",
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

/**
 * Return the exact same calendar month one year before a YYYY-MM month.
 * Invalid month strings return null rather than silently producing a
 * misleading comparison month.
 */
export function sameCalendarMonthLastYear(month: string | null | undefined): string | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return `${Number(month.slice(0, 4)) - 1}-${month.slice(5)}`;
}

/**
 * Calculate a rate change against the same calendar month last year.
 * A missing or non-positive comparison rate is intentionally blank: zero is
 * not a valid stand-in for a month for which no survey was uploaded.
 */
export function sameMonthRateYoYGrowth(
  currentRate: unknown,
  priorYearRate: unknown,
): number | null {
  if (currentRate === null || currentRate === undefined
      || priorYearRate === null || priorYearRate === undefined) return null;
  const current = Number(currentRate);
  const prior = Number(priorYearRate);
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior <= 0) return null;
  return (current - prior) / prior;
}

/**
 * Re-derive a grouped same-month street-rate YoY from weighted rate
 * components. Rows without both periods are excluded rather than treated as
 * zero, and the two month populations retain separate denominators.
 *
 * Expected row fields are the raw weighted components emitted by the
 * Reference Data endpoint:
 *   yoyStreetSpot / yoyStreetBase and their matching unit counts.
 */
export function aggregateSameMonthStreetYoY(rows: Record<string, any>[]): number | null {
  let currentRateSum = 0;
  let priorRateSum = 0;
  let currentUnits = 0;
  let priorUnits = 0;

  for (const row of rows) {
    if (row.yoyStreetSpot === null || row.yoyStreetSpot === undefined
        || row.yoyStreetBase === null || row.yoyStreetBase === undefined) continue;
    const currentRowUnits = Number(row.yoyStreetUnitsSpot);
    const priorRowUnits = Number(row.yoyStreetUnitsBase);
    if (!Number.isFinite(currentRowUnits) || !Number.isFinite(priorRowUnits)
        || currentRowUnits <= 0 || priorRowUnits <= 0) continue;

    const currentComponent = Number(row.yoyStreetSpot);
    const priorComponent = Number(row.yoyStreetBase);
    if (!Number.isFinite(currentComponent) || !Number.isFinite(priorComponent)) continue;

    currentRateSum += currentComponent;
    priorRateSum += priorComponent;
    currentUnits += currentRowUnits;
    priorUnits += priorRowUnits;
  }

  if (currentUnits <= 0 || priorUnits <= 0) return null;
  return sameMonthRateYoYGrowth(
    currentRateSum / currentUnits,
    priorRateSum / priorUnits,
  );
}

/**
 * ExcelJS receives the same numeric value rendered by the table for numeric
 * columns. Null stays blank; it must never become zero in the workbook.
 */
export function numericExportValue(value: unknown): number | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value);
}
