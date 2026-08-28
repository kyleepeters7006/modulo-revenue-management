/**
 * rateProduct — which PRODUCT a rent-roll row is priced as.
 *
 * The base rate is the single-occupant, standard-stay asking rate (see
 * shared/baseRate.ts). A facility sells several other products out of the same
 * building — a second occupant in a shared room, a semi-private/companion bed,
 * a respite stay, a rehab/TCU short stay — and each carries its own street
 * rate, expressed in MatrixCare as a distinct bed type / level of care.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM baseRate.ts
 * --------------------------------------------------
 * `baseRate.ts` answers one yes/no question: may this row feed a base-rate
 * average? That is all an aggregate needs. Resident-level work needs more: to
 * judge one resident's rate you must know WHICH product they are on, so their
 * paid rate can be compared against the street rate for that same product
 * rather than against the single-occupancy base.
 *
 * Getting that wrong is not cosmetic. A villa second-occupant pays roughly a
 * sixth of the base villa rate; measured against the base median their rate
 * looks like corrupt data and gets discarded, and the resident is then planned
 * with no ceiling at all. Measured against the second-occupant rate it is
 * exactly what it should be.
 *
 * ONE DEFINITION, TWO DIALECTS
 * ----------------------------
 * The keyword patterns live here once and are consumed by both the JS
 * classifier and the SQL `CASE` expression, and by baseRate.ts for its
 * keep-this-row predicates. JS uses `\b`; Postgres uses `\y`. Every keyword is
 * anchored at a WORD START so the campus names Woodward, Edward and Howard are
 * not read as wards, and the ambiguous short ones are anchored at both ends.
 *
 * ORDER MATTERS
 * -------------
 * A row can match more than one keyword — "TCU - Companion" is both a short
 * stay and a shared bed. Sharing is tested FIRST, because it is the constraint
 * that pushes a rate DOWN, and an understated ceiling can only make a
 * recommended increase too small. Leading with the short-stay uplift would
 * hand a shared bed a ceiling well above anything the facility charges for it.
 */

import { isBBedRow } from './bBed';

/**
 * Products a rent-roll row can be priced as.
 *
 * These are the ones a rent roll can actually EVIDENCE. Bed hold and couple
 * rates exist as derived-rate policy but leave no mark on an occupancy row, so
 * no row is ever classified as either.
 */
export const RATE_PRODUCTS = [
  'base',
  'second_occupant',
  'semi_private',
  'respite',
  'rehab_tcu',
] as const;

export type RateProduct = (typeof RATE_PRODUCTS)[number];

/**
 * Service lines whose shared bed is a ROOM TYPE rather than a suffixed room
 * number. Senior housing writes the companion as its own row ("101/B"); health
 * care writes it as a bed type ("Companion", "Semi-Private", "Ward").
 */
export const BED_TYPE_SLS: ReadonlySet<string> = new Set(['HC', 'HC/MC']);

/** Senior-housing service lines, where the companion is a `/B` room number. */
export const SUFFIX_BED_SLS: ReadonlySet<string> = new Set(['AL', 'AL/MC', 'SL', 'VIL']);

/** Room descriptors meaning "this bed is shared", i.e. not one resident alone. */
const SHARED_BED_JS = /\b(compan|semi[-\s]?priv|ward\b|double\b|shared\b)/i;
const SHARED_BED_SQL = `\\y(compan|semi[-[:space:]]?priv|ward\\y|double\\y|shared\\y)`;

/** Short-stay respite. "almost home" is Trilogy's brand name for the programme. */
const RESPITE_JS = /\b(respite|almost\s+home)/i;
const RESPITE_SQL = `\\y(respite|almost[[:space:]]+home)`;

/** Rehab-to-home and transitional care, priced above the standard long stay. */
const REHAB_TCU_JS = /\b(rehab|tcu\b)/i;
const REHAB_TCU_SQL = `\\y(rehab|tcu\\y)`;

/**
 * Either short-stay family. Exported for baseRate.ts, which only needs to know
 * that a row is not a standard stay, not which kind.
 */
export const NON_STANDARD_STAY_JS = /\b(respite|almost\s+home|rehab|tcu\b)/i;
export const NON_STANDARD_STAY_SQL = `\\y(respite|almost[[:space:]]+home|rehab|tcu\\y)`;
export { SHARED_BED_JS as NON_SINGLE_OCCUPANT_JS, SHARED_BED_SQL as NON_SINGLE_OCCUPANT_SQL };

/**
 * The product a row is priced as.
 *
 * Both the normalised `room_type` and the raw `source_room_type` are checked:
 * the normalised value catches the common case ("Companion"), the raw value
 * catches everything normalisation collapses away, since "TCU - Private" and
 * "Private Rehab" both normalise to "Studio".
 */
export function classifyRateProduct(
  serviceLine: string | null | undefined,
  roomNumber: string | null | undefined,
  roomType: string | null | undefined,
  sourceRoomType: string | null | undefined,
): RateProduct {
  if (isBBedRow(serviceLine, roomNumber)) return 'second_occupant';
  if (!BED_TYPE_SLS.has(serviceLine || '')) return 'base';

  const text = `${roomType || ''} ${sourceRoomType || ''}`;
  if (SHARED_BED_JS.test(text)) return 'semi_private';
  if (RESPITE_JS.test(text)) return 'respite';
  if (REHAB_TCU_JS.test(text)) return 'rehab_tcu';
  return 'base';
}

/**
 * The SQL twin of `classifyRateProduct`, as a `CASE` expression returning the
 * same product strings.
 *
 * EVERY column is COALESCEd. Without it a NULL service line makes
 * `service_line IN (...)` evaluate to NULL, the branch is skipped, and the row
 * lands somewhere the JS twin would not have put it — a divergence that shows
 * up as two screens quietly disagreeing, with no error anywhere.
 *
 * @param prefix column qualifier including the dot — `"rr."` or `""`.
 */
export function rateProductSql(prefix: string = 'rr.'): string {
  const sh = Array.from(SUFFIX_BED_SLS).map((s) => `'${s}'`).join(', ');
  const bt = Array.from(BED_TYPE_SLS).map((s) => `'${s}'`).join(', ');
  const sl = `COALESCE(${prefix}service_line, '')`;
  const num = `COALESCE(${prefix}room_number, '')`;
  const text = `(COALESCE(${prefix}room_type, '') || ' ' || COALESCE(${prefix}source_room_type, ''))`;
  return `CASE
    WHEN ${sl} IN (${sh}) AND ${num} ~* '/[B-Zb-z]$' THEN 'second_occupant'
    WHEN ${sl} NOT IN (${bt}) THEN 'base'
    WHEN ${text} ~* '${SHARED_BED_SQL}' THEN 'semi_private'
    WHEN ${text} ~* '${RESPITE_SQL}' THEN 'respite'
    WHEN ${text} ~* '${REHAB_TCU_SQL}' THEN 'rehab_tcu'
    ELSE 'base' END`;
}

/** Human-readable product name, for explanations and column labels. */
export const RATE_PRODUCT_LABEL: Record<RateProduct, string> = {
  base: 'Single occupant',
  second_occupant: 'Second occupant',
  semi_private: 'Semi-private / companion',
  respite: 'Respite',
  rehab_tcu: 'Rehab / TCU',
};

/**
 * The derived-rate formula that prices a product, or null for the base rate,
 * which is measured rather than derived.
 *
 * The two names line up one-for-one today; the mapping is explicit so the
 * derived-rate vocabulary can gain a type that no rent-roll row evidences (bed
 * hold, couple) without anything here silently changing meaning.
 */
export function derivedTypeForProduct(
  product: RateProduct,
): 'second_occupant' | 'semi_private' | 'respite' | 'rehab_tcu' | null {
  return product === 'base' ? null : product;
}
