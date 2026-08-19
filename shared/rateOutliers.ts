/**
 * Rate outlier detection — shared, dependency-free constants.
 *
 * Lives in `shared/` (not in a server service) so that every surface which
 * aggregates rates — Reference Data, the Competitive Position scatter, the
 * street-rate quality checks and their tests — can import the same threshold
 * without pulling in a database-touching module.
 *
 * ── Why a RELATIVE gate rather than a fixed floor ──────────────────────────
 * Rate aggregation previously discarded any rate below a hard $1,000, with a
 * carve-out exempting HC / HC/MC because those service lines are priced per
 * DAY and so legitimately sit in the hundreds.
 *
 * That fixed floor could not tell the difference between:
 *   - a genuinely low-priced line (VIL and SL inventory, HC per-diems), and
 *   - a bad row (a stray $159 on a Studio, a prorated move-in month).
 *
 * Comparing each rate against the median of its OWN location + service line
 * distinguishes the two without any per-service-line special cases: a rate is
 * suspect only when it is far below what that same campus charges for that
 * same service line. Use the MEDIAN as the baseline — an average would be
 * dragged down by the very outliers being detected.
 */

/**
 * A rate below this fraction of its own location + service-line median is
 * treated as bad data and excluded from rate aggregates.
 *
 * 0.35 is deliberately permissive: real intra-service-line spread (a Studio
 * against a two-bedroom, a semi-private against a private suite) stays well
 * inside this band, while data-entry errors and prorated partial months —
 * which are typically an order of magnitude low — fall outside it.
 */
export const RATE_OUTLIER_FLOOR_RATIO = 0.35;
