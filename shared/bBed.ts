/**
 * Shared B-bed (companion bed) exclusion logic for street-rate aggregations.
 *
 * For senior housing service lines (AL, AL/MC, SL, VIL), two-person rooms
 * produce two rent roll rows: the primary unit row and a companion "B-bed"
 * row whose room_number carries a letter suffix (e.g. "101/B"). Street-rate
 * averages must count one rate per physical room, so B-bed rows are excluded.
 *
 * HC and HC/MC keep every bed row: each bed is a separate billable resident,
 * so their averages are intentionally unchanged.
 *
 * The SQL equivalent of this predicate is:
 *   NOT (service_line IN ('AL','AL/MC','SL','VIL') AND room_number ~* '/[B-Zb-z]$')
 *
 * Only non-A letter suffixes are excluded (e.g. "101/B" is companion; "101/A"
 * is the primary bed and must remain in the average).
 */

export const SENIOR_HOUSING_SLS: ReadonlySet<string> = new Set(['AL', 'AL/MC', 'SL', 'VIL']);

export const B_BED_ROOM_RE = /\/[B-Zb-z]$/;

/**
 * Returns true when the row is a companion-bed row that must be excluded
 * from street-rate aggregations (senior housing SL + letter-suffixed room).
 */
export function isBBedRow(serviceLine: string | null | undefined, roomNumber: string | null | undefined): boolean {
  return SENIOR_HOUSING_SLS.has(serviceLine || '') && B_BED_ROOM_RE.test(roomNumber || '');
}
