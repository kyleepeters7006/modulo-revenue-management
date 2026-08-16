/**
 * Threshold-scale rules for the rule designer's structured builder.
 *
 * The designer composes a natural-language sentence which the server re-parses,
 * so a threshold's scale is INFERRED from how it is written. These helpers keep
 * the designer from emitting a number the parser would read as a different
 * value than the user meant.
 *
 * Lives in shared/ rather than inside the component so it can be tested without
 * pulling in React.
 */

/**
 * Occupancy metrics. The parser stores these as a fraction (0–1) and infers the
 * scale from magnitude when no "%" is written, so a bare sub-1 value is
 * genuinely ambiguous between a fraction and percentage points.
 */
const FRACTION_SCALE_LIST = [
  'Campus Occupancy',
  'Service Line Occupancy',
  'Room Type Occupancy',
];
export const FRACTION_SCALE_METRICS = new Set(FRACTION_SCALE_LIST);

/** Percentages with a natural 0–100 ceiling. */
const BOUNDED_PERCENT_LIST = FRACTION_SCALE_LIST.concat(['Quality Mix']);
export const BOUNDED_PERCENT_METRICS = new Set(BOUNDED_PERCENT_LIST);

/**
 * Percentage-POINT deltas. A variance of +125% or −140% against a competitor or
 * an in-house rate is perfectly ordinary, so these must not be clamped to 0–100.
 */
const VARIANCE_PERCENT_LIST = [
  'In House to Street Rate var % - Single Occupant',
  'Street Rate to Top Comp Var %',
  'Competitor Rate',
];
export const VARIANCE_PERCENT_METRICS = new Set(VARIANCE_PERCENT_LIST);

/**
 * The IH-variance evaluator rescales any threshold of 1 or less as a legacy
 * fraction, multiplying it by 100. For this metric a sub-1 value can therefore
 * never mean what it says, even when the "%" is explicit.
 */
export const LEGACY_RESCALED_METRICS = new Set([
  'In House to Street Rate var % - Single Occupant',
]);

/** Every metric whose threshold is a percentage of some kind. */
export const PERCENT_METRICS = new Set(
  BOUNDED_PERCENT_LIST.concat(VARIANCE_PERCENT_LIST),
);

/**
 * Returns null when the value is safe, otherwise the reason it would be
 * misread. Callers must treat a non-null result as blocking: the server
 * re-parses the composed sentence, so a misread threshold silently reaches
 * live pricing rather than failing.
 */
export function conditionValueIssue(metric: string, rawValue: string): string | null {
  const v = rawValue.trim();
  if (!v) return null;

  const hasPercent = v.includes('%');
  const num = parseFloat(v.replace(/[%,\s]/g, ''));
  if (Number.isNaN(num)) return `"${v}" is not a number`;

  if (BOUNDED_PERCENT_METRICS.has(metric) && Math.abs(num) > 100) {
    return `${metric} is a percentage — ${num} is outside 0–100`;
  }

  if (LEGACY_RESCALED_METRICS.has(metric) && num !== 0 && Math.abs(num) <= 1) {
    return `${metric} cannot use a threshold of 1 or less — the pricing engine would read ${num} as ${num * 100}%`;
  }

  // Only the fraction-scale metrics are ambiguous at sub-1, because only they
  // go through the parser's magnitude heuristic. An explicit "%" resolves it.
  if (FRACTION_SCALE_METRICS.has(metric) && !hasPercent && num !== 0 && Math.abs(num) <= 1) {
    return `Enter ${metric} in percentage points — type 85 for 85%, or write 0.85% if you really mean it`;
  }

  return null;
}
