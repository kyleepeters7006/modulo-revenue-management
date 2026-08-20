/**
 * derivedRates — how non-base rates are computed from the base rate.
 *
 * The base rate is the single-occupant, standard-stay asking rate (see
 * shared/baseRate.ts). Every other rate a facility publishes is DERIVED from
 * it by a formula the user controls on the Data Management page, rather than
 * being averaged out of the rent roll independently.
 *
 * WHY DERIVE RATHER THAN MEASURE
 * ------------------------------
 * A companion or respite rate measured from the rent roll is a description of
 * what was billed last month, contaminated by mix, concessions and payer. A
 * derived rate is a statement of policy: "a second occupant pays 55% of the
 * base". Pricing decisions need the second one. It also means a single change
 * to the base rate flows through every dependent rate consistently, instead of
 * six averages drifting apart.
 *
 * THE FORMULA
 * -----------
 *     derived = round( base * (percentOfBase / 100) + dollarOffset )
 *
 * Both terms are optional in practice: leave the offset at 0 for a pure
 * percentage ("semi-private is 82% of base"), or set the percentage to 100 for
 * a pure offset ("bed hold is base minus $75"). Combining them expresses the
 * common real-world shape "85% of base, less a $10 administrative credit".
 *
 * ROUNDING is applied once, at the end, to whole currency units. Rounding the
 * percentage step separately from the offset step produces off-by-one dollars
 * that show up as penny mismatches in exports.
 *
 * SCOPE
 * -----
 * `serviceLine === null` means the formula applies portfolio-wide. The column
 * exists so a per-service-line override can be added later without a
 * migration; nothing writes a non-null value yet, and `resolveFormula` already
 * prefers the more specific row so that change is additive.
 *
 * A DERIVED RATE IS NEVER AN INPUT
 * --------------------------------
 * Nothing in Reference Data or the rule designer may read a derived rate back
 * in as if it were observed data. Doing so would feed the base rate its own
 * output and compound every change. Derived rates are display and export
 * values only.
 */

/** The kinds of rate that are derived from the base rate. */
export const DERIVED_RATE_TYPES = [
  'second_occupant',
  'semi_private',
  'respite',
  'rehab_tcu',
  'bed_hold',
  'couple',
] as const;

export type DerivedRateType = (typeof DERIVED_RATE_TYPES)[number];

export interface DerivedRateFormula {
  rateType: DerivedRateType;
  /** NULL = applies to every service line. */
  serviceLine: string | null;
  /** Percentage of the base rate, e.g. 82 means 82%. */
  percentOfBase: number;
  /** Flat dollar amount added after the percentage. Negative subtracts. */
  dollarOffset: number;
  enabled: boolean;
}

export interface DerivedRateTypeMeta {
  type: DerivedRateType;
  label: string;
  description: string;
  /** Sensible starting point, overridden by whatever the user saves. */
  defaultPercentOfBase: number;
  defaultDollarOffset: number;
}

/**
 * Display metadata and starting values for each derived rate type.
 *
 * The defaults are deliberately conservative placeholders, NOT measured
 * values: the whole point of the panel is that pricing policy is the user's
 * to set. They are close enough to observed rent-roll ratios to be a sane
 * first screen — e.g. HC companion rates run about 82% of private on trilogy —
 * without pretending to be derived from anything.
 */
export const DERIVED_RATE_TYPE_META: readonly DerivedRateTypeMeta[] = [
  {
    type: 'second_occupant',
    label: 'Second occupant',
    description: 'Additional resident sharing an already-occupied room.',
    defaultPercentOfBase: 55,
    defaultDollarOffset: 0,
  },
  {
    type: 'semi_private',
    label: 'Semi-private / Companion',
    description: 'Per-bed rate in a shared or companion room.',
    defaultPercentOfBase: 82,
    defaultDollarOffset: 0,
  },
  {
    type: 'respite',
    label: 'Respite',
    description: 'Short-stay respite admission, charged per day.',
    defaultPercentOfBase: 110,
    defaultDollarOffset: 0,
  },
  {
    type: 'rehab_tcu',
    label: 'Rehab / TCU short stay',
    description: 'Transitional care and rehab-to-home stays.',
    defaultPercentOfBase: 130,
    defaultDollarOffset: 0,
  },
  {
    type: 'bed_hold',
    label: 'Bed hold',
    description: 'Hospital or therapeutic leave, holding the bed.',
    defaultPercentOfBase: 75,
    defaultDollarOffset: 0,
  },
  {
    type: 'couple',
    label: 'Couple / double occupant',
    description: 'Two residents sharing one unit, total for the unit.',
    defaultPercentOfBase: 155,
    defaultDollarOffset: 0,
  },
] as const;

const META_BY_TYPE = new Map<DerivedRateType, DerivedRateTypeMeta>(
  DERIVED_RATE_TYPE_META.map((m) => [m.type, m]),
);

export function isDerivedRateType(v: string): v is DerivedRateType {
  return (DERIVED_RATE_TYPES as readonly string[]).includes(v);
}

export function metaFor(type: DerivedRateType): DerivedRateTypeMeta {
  const m = META_BY_TYPE.get(type);
  if (!m) throw new Error(`Unknown derived rate type: ${type}`);
  return m;
}

/** The full default set, used to seed the panel before anything is saved. */
export function defaultFormulas(): DerivedRateFormula[] {
  return DERIVED_RATE_TYPE_META.map((m) => ({
    rateType: m.type,
    serviceLine: null,
    percentOfBase: m.defaultPercentOfBase,
    dollarOffset: m.defaultDollarOffset,
    enabled: true,
  }));
}

/**
 * Apply a formula to a base rate.
 *
 * Returns null when the base rate is missing or non-positive, or the formula
 * is disabled — blank beats a plausible-but-false number, the same rule the
 * street-rate gate follows.
 */
export function applyDerivedFormula(
  base: number | null | undefined,
  formula: Pick<DerivedRateFormula, 'percentOfBase' | 'dollarOffset' | 'enabled'> | null | undefined,
): number | null {
  if (!formula || !formula.enabled) return null;
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return null;

  const pct = Number(formula.percentOfBase);
  const off = Number(formula.dollarOffset);
  if (!Number.isFinite(pct) || !Number.isFinite(off)) return null;

  // Round once, at the end. Rounding the percentage and the offset separately
  // produces off-by-one dollars that surface as penny mismatches in exports.
  const derived = b * (pct / 100) + off;
  if (!Number.isFinite(derived) || derived <= 0) return null;
  return Math.round(derived);
}

/**
 * Pick the formula that applies to a service line: an exact service-line match
 * wins over the portfolio-wide (NULL) row.
 */
export function resolveFormula(
  formulas: readonly DerivedRateFormula[],
  rateType: DerivedRateType,
  serviceLine: string | null | undefined,
): DerivedRateFormula | null {
  const candidates = formulas.filter((f) => f.rateType === rateType);
  return (
    candidates.find((f) => f.serviceLine != null && f.serviceLine === serviceLine) ??
    candidates.find((f) => f.serviceLine == null) ??
    null
  );
}

/** Human-readable form of a formula, e.g. "82% of base − $75". */
export function describeFormula(
  f: Pick<DerivedRateFormula, 'percentOfBase' | 'dollarOffset'>,
): string {
  const pct = `${Number(f.percentOfBase)}% of base`;
  const off = Number(f.dollarOffset);
  if (!off) return pct;
  return `${pct} ${off > 0 ? '+' : '−'} $${Math.abs(off).toLocaleString()}`;
}

/**
 * Validate a formula before it is persisted. Returns an error string, or null
 * when the formula is acceptable.
 *
 * The bounds are wide on purpose — a rehab rate above 100% of base and a bed
 * hold well below it are both legitimate. They exist to catch a fat-fingered
 * 8200 or a negative percentage, not to enforce pricing policy.
 */
export function validateFormula(
  f: Pick<DerivedRateFormula, 'percentOfBase' | 'dollarOffset'>,
): string | null {
  const pct = Number(f.percentOfBase);
  const off = Number(f.dollarOffset);
  if (!Number.isFinite(pct)) return 'Percentage must be a number.';
  if (!Number.isFinite(off)) return 'Dollar offset must be a number.';
  if (pct < 0) return 'Percentage cannot be negative.';
  if (pct > 500) return 'Percentage above 500% is almost certainly a typo.';
  if (Math.abs(off) > 100000) return 'Dollar offset is out of range.';
  return null;
}
