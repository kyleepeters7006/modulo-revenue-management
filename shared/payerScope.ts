/**
 * Payer scope — the single definition of "private pay".
 *
 * Street pricing only moves revenue for residents whose rate we actually set.
 * Medicaid, Medicare, Managed Care, commercial insurance and Hospice rates are
 * set externally, so they must be excluded from private-pay revenue and from
 * pricing impact math.
 *
 * WHY THIS FILE EXISTS
 * Four different definitions of "private pay" had grown up independently and
 * disagreed by a third on real data (occupied units, one client, one month):
 *
 *   exclusion-based (this file)   8,297
 *   payor_type ILIKE '%private%'  6,250
 *   ... OR ILIKE '%pvt%'          7,720
 *
 * The inclusion-based variants are simply wrong: they classify the 1,470
 * residents coded `LEGACY - PVT PAY` as non-private, and `BEDHOLDS` too. Any
 * definition that must enumerate every spelling of "private" fails the moment
 * an import introduces a new one, and it fails SILENTLY by under-reporting.
 *
 * So the rule is inverted: a payer is private unless it is recognisably one of
 * the externally-set payer programmes.
 *
 * TWO VOCABULARIES FEED THE EXCLUSION LIST
 *
 *   rent_roll_data.payor_type — a small controlled vocabulary
 *     (PRIVATE PAY, MEDICAID, MEDICARE, MEDICARE ADVANTAGE, MANAGED CARE,
 *      HOSPICE, BEDHOLDS, 2ND OCCUPANT, LEGACY - *).
 *
 *   move_in_out_events.payer — ~90 raw values from the billing system,
 *     including insurer brand names and abbreviations: HUMANA MCR ADV,
 *     BC/BS OF MI MCR ADV, UHC COMMERCIAL, INSURANCE FFS, AETNA BH MI MGD MCD,
 *     MED A - ISNP, OPTUM VA CCN, TRICARE FOR LIFE. These spell Medicare as
 *     "MCR" and Medicaid as "MCD", so the plain MEDICARE/MEDICAID keywords do
 *     NOT match them — roughly 46,000 Medicare Advantage admissions would
 *     otherwise be counted as private pay.
 *
 * A brand name we have never seen will still fall through as private. That is
 * the known limit of an exclusion list against an open vocabulary, and it is
 * guarded by tests/payerScope.test.ts, which pins the classification of every
 * payer value observed in production. A new value from an import fails that
 * test and gets classified deliberately, instead of silently landing in
 * whichever bucket happens to catch it.
 *
 * Keep `isPrivatePayer` and `privatePaySql` behaviourally identical. They are
 * twins on purpose: some surfaces aggregate in SQL and some in JS, and a drift
 * between them reintroduces exactly the inconsistency this file removes.
 */

/**
 * Distinctive words for externally-priced payers, matched as case-insensitive
 * SUBSTRINGS. Every entry here is long and specific enough that a substring
 * match cannot plausibly collide with a private-pay label.
 */
export const NON_PRIVATE_PAYER_KEYWORDS = [
  "MEDICAID",
  "MEDICARE",
  "HOSPICE",
  "MANAGED",
  "COMMERCIAL",
  "INSURANCE",
  "TRICARE",
  "VA CCN", // VA Community Care Network
  "ISNP", // Institutional Special Needs Plan (Medicare)
  "DEVOTED", // Devoted Health — Medicare Advantage carrier
] as const;

/**
 * Short billing-system abbreviations, matched as WHOLE WORDS only.
 *
 * These must never be substring-matched. `COMM` as a substring would classify
 * a perfectly ordinary private label like "PRIVATE ACCOMMODATION" as external;
 * as a whole word it still catches the real values "BLUE CARE NETWORK MI COMM"
 * and "PRIORITY HEALTH MI COMM". Word boundaries also handle the hyphenated
 * forms the billing system emits, e.g. "MED MUTUAL OH-MCR ADV".
 */
export const NON_PRIVATE_PAYER_CODES = [
  "MCR", // Medicare / Medicare Advantage
  "MCD", // Medicaid
  "COMM", // commercial insurance, abbreviated
] as const;

/** Whole-word matcher for {@link NON_PRIVATE_PAYER_CODES}. */
const CODE_PATTERN = new RegExp(`\\b(${NON_PRIVATE_PAYER_CODES.join("|")})\\b`);

/**
 * True when a payer value represents a resident we price ourselves.
 *
 * A blank/NULL payer counts as private. In practice these are vacant units
 * (every NULL row observed in production is unoccupied), so this only affects
 * POTENTIAL revenue on empty units — where assuming we could price the unit is
 * the correct assumption, since that is exactly the opportunity being measured.
 */
export function isPrivatePayer(payorType: string | null | undefined): boolean {
  const v = (payorType || "").toUpperCase().trim();
  if (!v) return true;
  if (NON_PRIVATE_PAYER_KEYWORDS.some((k) => v.includes(k))) return false;
  return !CODE_PATTERN.test(v);
}

/**
 * SQL twin of `isPrivatePayer`, for aggregates that never leave the database.
 *
 * Postgres `\y` is a word boundary, matching the JS `\b` used above; the codes
 * are therefore whole-word matched on both sides of the twin.
 *
 * @param column Fully-qualified payer column, e.g. `rr.payor_type`.
 */
export function privatePaySql(column: string): string {
  const notLike = NON_PRIVATE_PAYER_KEYWORDS.map(
    (k) => `${column} NOT ILIKE '%${k}%'`,
  ).join(" AND ");
  const codeAlternation = NON_PRIVATE_PAYER_CODES.join("|");
  const notCode = `${column} !~* '\\y(${codeAlternation})\\y'`;
  return `(${column} IS NULL OR TRIM(${column}) = '' OR (${notLike} AND ${notCode}))`;
}

/** Inverse of {@link privatePaySql}, for reporting the excluded population. */
export function nonPrivatePaySql(column: string): string {
  return `NOT ${privatePaySql(column)}`;
}
