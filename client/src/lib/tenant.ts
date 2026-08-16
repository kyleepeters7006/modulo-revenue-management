/**
 * Tenant display helpers.
 *
 * Client records store a full legal name ("Trilogy Health Services", "Senior
 * Solutions Management Group"). That is far too long for a table column
 * header — the competitor rate grid puts it in a 7-column 9px row — so column
 * labels use the brand portion instead.
 */

/**
 * Generic corporate / industry words that carry no brand meaning. Stripped only
 * from the END of the name, so "Senior Solutions Management Group" keeps its
 * leading "Senior" and becomes "Senior Solutions".
 */
const GENERIC_TRAILING_WORDS = new Set([
  'health', 'healthcare', 'services', 'service', 'management', 'group',
  'holdings', 'holding', 'inc', 'llc', 'lp', 'llp', 'corp', 'corporation',
  'company', 'co', 'partners', 'properties', 'enterprises', 'communities',
  'community', 'living', 'senior', 'seniors',
]);

/**
 * Short brand label for a tenant, suitable for a column header.
 *
 *   "Trilogy Health Services"            -> "Trilogy"
 *   "Great Lakes Management"             -> "Great Lakes"
 *   "Senior Solutions Management Group"  -> "Senior Solutions"
 *   undefined                            -> "Trilogy"
 *
 * Falls back to "Trilogy" when the tenant name is not loaded yet, so headers do
 * not flicker to a placeholder on first paint.
 */
export function tenantShortName(fullName?: string | null): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return 'Trilogy';

  const words = trimmed.split(/\s+/);
  // Never strip the name away entirely — keep at least the first word.
  while (words.length > 1) {
    const last = words[words.length - 1].replace(/[.,]/g, '').toLowerCase();
    if (!GENERIC_TRAILING_WORDS.has(last)) break;
    words.pop();
  }

  return words.join(' ') || trimmed;
}
