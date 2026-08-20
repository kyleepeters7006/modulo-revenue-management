/**
 * baseRate — the single definition of a "base rate" rent-roll row.
 *
 * WHAT A BASE RATE IS
 * -------------------
 * Every rate that feeds Reference Data and the rule designer must be a
 * SINGLE-OCCUPANT, standard-stay rate. In MatrixCare terms this is the
 * `Single Occupant` / `BASE RATE - SKILLED - ACTIVE` level of care: the rate a
 * facility charges one resident for one room on an ordinary long-stay
 * admission.
 *
 * Everything else — the second occupant in a shared room, a semi-private or
 * companion bed, a respite stay, a rehab/TCU short stay — is a DERIVED rate.
 * Derived rates are computed FROM the base rate by the formulas configured on
 * the Data Management page (see `derivedRateFormulas` in shared/schema.ts).
 * They are outputs, never inputs: letting them back into an average makes the
 * base rate a blend of products that are priced differently on purpose.
 *
 * WHY THIS MATTERS
 * ----------------
 * HC is the worst offender because companion beds are nearly half the rows and
 * are priced far below private rooms. On trilogy 2026-07 the HC split was:
 *
 *     Studio (private, single occupant)   3,322 rows   $423/day
 *     Companion (2nd occupant)            3,445 rows   $346/day
 *     TCU                                   194 rows   $539/day
 *     Rehab                                 174 rows   $482/day
 *
 * A blended average lands near $385 — a number that describes no product the
 * company actually sells, and that moves whenever the companion/private mix
 * shifts rather than when anyone changes a price.
 *
 * SENIOR HOUSING VS HEALTH CARE
 * -----------------------------
 * The two service-line families express "second occupant" differently, so the
 * predicate has two arms:
 *
 *   AL, AL/MC, SL, VIL  — the companion is a separate rent-roll row with a
 *                         letter-suffixed room number ("101/B"). Handled by
 *                         `isBBedRow` in shared/bBed.ts, unchanged.
 *
 *   HC, HC/MC           — the companion is its own ROOM TYPE ("Companion",
 *                         "Semi-Private", "Ward"), not a suffixed room number,
 *                         so the B-bed rule never matched it. That is the gap
 *                         this module closes.
 *
 * PAYER SCOPE IS NOT HANDLED HERE — AND MUST NOT BE
 * -------------------------------------------------
 * Street rate is an ASKING rate that exists on vacant units, where
 * `payor_type` is NULL. Filtering street rate by payer would silently drop
 * every vacant unit and turn an asking-rate average into an occupied-only one.
 *
 * In-house rate is a BILLED rate and is genuinely payer-specific, so callers
 * that average `in_house_rate` for HC/HC-MC additionally apply
 * `privatePaySql` from shared/payerScope.ts. That is the caller's decision
 * about which rows to report, not part of what "base rate" means.
 *
 * THE WORD-BOUNDARY TRAP
 * ----------------------
 * Source room types are campus-branded: "Legacy Lane - Private",
 * "TCU - Companion", "Compan;C Vw;C Loc;B Sz". A naive substring match is
 * therefore dangerous in both directions:
 *
 *   - "ward" as a substring matches the campus names Woodward, Edward,
 *     Howard — excluding real private rooms.
 *   - "Compan" must still match the truncated "Compan;C Vw;..." form.
 *
 * So every keyword is anchored at a WORD START, and the ambiguous short ones
 * are anchored at both ends. JS uses `\b`; Postgres uses `\y`. The two regex
 * dialects are kept side by side below so they cannot drift — the same
 * discipline shared/payerScope.ts uses for the `COMM` code.
 */

import { isBBedRow } from './bBed';

/**
 * Service lines whose companion bed is a ROOM TYPE rather than a suffixed
 * room number. Only these get the second arm of the predicate.
 */
export const BED_TYPE_SLS: ReadonlySet<string> = new Set(['HC', 'HC/MC']);

/**
 * Room descriptors that mean "this is not one resident in one room".
 * Word-start anchored so "Compan;C Vw" matches but "Accompany" does not;
 * `ward` and `double` are anchored at both ends so the campus names Woodward
 * and Edward survive.
 */
const NON_SINGLE_OCCUPANT_JS = /\b(compan|semi[-\s]?priv|ward\b|double\b|shared\b)/i;
const NON_SINGLE_OCCUPANT_SQL = `\\y(compan|semi[-[:space:]]?priv|ward\\y|double\\y|shared\\y)`;

/**
 * Stay types that are priced as their own product rather than as the standard
 * long-stay admission: respite, rehab-to-home, and transitional care (TCU).
 * "almost home" is Trilogy's brand name for a respite programme.
 */
const NON_STANDARD_STAY_JS = /\b(respite|rehab|tcu\b|almost\s+home)/i;
const NON_STANDARD_STAY_SQL = `\\y(respite|rehab|tcu\\y|almost[[:space:]]+home)`;

/**
 * True when an HC/HC-MC row is a companion, semi-private, respite, rehab or
 * TCU row — i.e. a derived-rate row that must stay out of the base average.
 *
 * Both the normalised `room_type` and the raw `source_room_type` are checked.
 * The normalised value catches the common case ("Companion"); the raw value
 * catches everything normalisation collapses away, since "TCU - Private" and
 * "Private Rehab" both normalise to "Studio".
 */
export function isNonBaseBedTypeRow(
  serviceLine: string | null | undefined,
  roomType: string | null | undefined,
  sourceRoomType: string | null | undefined,
): boolean {
  if (!BED_TYPE_SLS.has(serviceLine || '')) return false;
  const rt = roomType || '';
  const src = sourceRoomType || '';
  return (
    NON_SINGLE_OCCUPANT_JS.test(rt) ||
    NON_SINGLE_OCCUPANT_JS.test(src) ||
    NON_STANDARD_STAY_JS.test(rt) ||
    NON_STANDARD_STAY_JS.test(src)
  );
}

/**
 * True when a row is a valid base-rate row: a single occupant on a standard
 * stay, in any service line.
 *
 * This is the JS twin of `baseRateExclusionSql`. Callers that already hold
 * rows in memory (the Room Detail view, the rule impact service) use this so
 * they cannot drift from the grouped SQL surfaces.
 */
export function isBaseRateRow(
  serviceLine: string | null | undefined,
  roomNumber: string | null | undefined,
  roomType: string | null | undefined,
  sourceRoomType: string | null | undefined,
): boolean {
  if (isBBedRow(serviceLine, roomNumber)) return false;
  if (isNonBaseBedTypeRow(serviceLine, roomType, sourceRoomType)) return false;
  return true;
}

/**
 * The SQL form of `isBaseRateRow`, written as a keep-this-row predicate.
 *
 * Supersedes `bBedExclusionSql` at every site that averages a rate for
 * Reference Data, the rule designer, or competitive position. The B-bed
 * predicate remains correct on its own for surfaces that only care about
 * senior-housing companion rows (the MatrixCare exporters, which must emit a
 * rate for every physical bed including companions).
 *
 * @param prefix column qualifier including the dot — `"rr."`, `"rrd."`, or
 *               `""` when the query has no table alias.
 */
export function baseRateExclusionSql(prefix: string = 'rr.'): string {
  const sls = Array.from(BED_TYPE_SLS).map((s) => `'${s}'`).join(', ');
  // EVERY column is COALESCEd, and not merely for tidiness — this is what makes
  // the SQL a true twin of the JS.
  //
  // Without it, a NULL service_line makes `service_line IN (...)` evaluate to
  // NULL, so `NOT (NULL AND TRUE)` is NULL, and a WHERE/FILTER clause drops the
  // row because NULL is not TRUE. The JS asks `SH_SLS.has(serviceLine || '')`,
  // which is plainly false, and KEEPS the row. Rows with an incomplete import
  // (null service line, null room number) would therefore be silently absent
  // from the grouped SQL surfaces and present in the in-memory ones — a
  // divergence that shows up as two screens quietly disagreeing, with no error
  // anywhere. COALESCE to '' makes both sides answer "not a member".
  const sl = `COALESCE(${prefix}service_line, '')`;
  const num = `COALESCE(${prefix}room_number, '')`;
  const rt = `COALESCE(${prefix}room_type, '')`;
  const src = `COALESCE(${prefix}source_room_type, '')`;
  return (
    `NOT (${sl} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${num} ~* '/[B-Zb-z]$')` +
    ` AND NOT (${sl} IN (${sls}) AND (` +
    `${rt} ~* '${NON_SINGLE_OCCUPANT_SQL}' OR ${src} ~* '${NON_SINGLE_OCCUPANT_SQL}'` +
    ` OR ${rt} ~* '${NON_STANDARD_STAY_SQL}' OR ${src} ~* '${NON_STANDARD_STAY_SQL}'` +
    `))`
  );
}
