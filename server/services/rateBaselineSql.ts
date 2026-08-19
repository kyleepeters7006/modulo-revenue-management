/**
 * rateBaselineSql — the single canonical SQL definition of the rate outlier gate.
 *
 * Every surface that aggregates street or in-house rates (the grouped
 * /api/reference-data endpoint, the Competitive Position scatter, and the
 * parity tests that guard them) builds its outlier gate from THIS module.
 * They previously each carried their own copy of the predicate, which is how
 * they drifted apart in the first place.
 *
 * ── The gate is two-level ──────────────────────────────────────────────────
 * Level 1 — a rate is suspect when it sits below RATE_OUTLIER_FLOOR_RATIO of
 *   the MEDIAN for its own location + service line. This catches the common
 *   case: a stray $159 on a Studio, or a prorated partial move-in month, in a
 *   campus that is otherwise priced normally.
 *
 * Level 2 — level 1 alone is blind when EVERY row in a location + service line
 *   is bad, because the junk then defines its own baseline and passes its own
 *   test. So when a location's median is itself far below the portfolio median
 *   for that service line, the portfolio median is used as the baseline
 *   instead. Real client data contains exactly this shape: a campus whose
 *   entire AL line was imported at roughly a twentieth of the portfolio rate
 *   would otherwise publish a ~$155 assisted-living rate as if it were real.
 *
 * Neither level uses an absolute dollar threshold. A fixed floor (the previous
 * "$1,000 unless HC" rule) cannot tell a genuinely low-priced line — VIL and
 * SL inventory, or HC, which is priced per DAY — from a data-entry error, and
 * so it needed a service-line carve-out that the relative test does not.
 *
 * Median, never average, is used for both baselines: an average is dragged
 * down by the very outliers being detected.
 */
import { RATE_OUTLIER_FLOOR_RATIO } from "@shared/rateOutliers";

/**
 * Companion ("B bed") rows are second-occupant entries against a room that is
 * already counted. They are excluded from the baseline so a half-price
 * companion rate cannot depress the reference level for the whole campus.
 */
export const B_BED_EXCLUSION =
  `NOT (rr.service_line IN ('AL', 'AL/MC', 'SL', 'VIL') AND rr.room_number ~* '/[B-Zb-z]$')`;

export interface RateBaselineOptions {
  /**
   * SQL predicate scoping the LEVEL 1 baseline, written over `rr.*` (and
   * anything `joins` brings into scope). Pass the SAME predicate the outer
   * query uses, so the baseline is drawn from exactly the population it
   * filters. Placeholders may be reused — Postgres allows a parameter to
   * appear more than once, so this does not require duplicating the
   * parameter array.
   */
  where: string;
  /**
   * Predicate scoping the LEVEL 2 (portfolio) baseline. This MUST NOT carry
   * the caller's location / region / division filters: if it did, filtering
   * the page to a single campus would collapse the portfolio baseline onto
   * that same campus, and a campus whose entire service line is junk would
   * once again pass its own test — precisely the failure level 2 exists to
   * catch. Scope it to tenant + month (+ service line, which the baseline
   * groups by anyway). Defaults to `where`, which is only correct for callers
   * that have no location-narrowing filters at all.
   */
  portfolioWhere?: string;
  /** Any joins `where` / `portfolioWhere` depend on, e.g. the `locations` join. */
  joins?: string;
  /** Also compute an in-house-rate baseline (`rb.median_ih`). */
  includeInHouse?: boolean;
}

/**
 * Build the leading `WITH ... rate_baseline AS (...)` clause. The result
 * starts the statement, so it goes immediately after the opening backtick and
 * is followed directly by `SELECT`.
 */
export function buildRateBaselineCte(opts: RateBaselineOptions): string {
  const { where, portfolioWhere = where, joins = "", includeInHouse = false } = opts;

  // Occupied-only, because the in-house rate is what a resident is actually
  // paying and IN_HOUSE_RATE_GATE is only ever applied to occupied rows. A
  // baseline drawn from a wider population than the one it filters would let
  // vacant-row noise decide which occupied rates survive.
  const ihMedian = includeInHouse
    ? `,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY rr.in_house_rate)
               FILTER (WHERE rr.occupied_yn AND rr.in_house_rate > 0) AS median_ih`
    : "";

  const ihPick = includeInHouse
    ? `,
           CASE WHEN sb.median_ih IS NOT NULL
                     AND lb.median_ih < ${RATE_OUTLIER_FLOOR_RATIO} * sb.median_ih
                THEN sb.median_ih ELSE lb.median_ih END AS median_ih`
    : "";

  return `
  WITH loc_baseline AS (
    -- Level 1 baseline: the price level of each location + service line.
    SELECT rr.location     AS location,
           rr.service_line AS service_line,
           rr.upload_month AS upload_month,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rr.street_rate)
             FILTER (WHERE rr.street_rate > 0) AS median_street${ihMedian}
    FROM rent_roll_data rr${joins}
    WHERE ${where}
      AND ${B_BED_EXCLUSION}
    GROUP BY rr.location, rr.service_line, rr.upload_month
  ),
  sl_baseline AS (
    -- Level 2 baseline: the price level of the whole portfolio for that
    -- service line, used when a location's own rates are wholly implausible.
    -- Note this uses the portfolioWhere scope, NOT the display filters.
    SELECT rr.service_line AS service_line,
           rr.upload_month AS upload_month,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rr.street_rate)
             FILTER (WHERE rr.street_rate > 0) AS median_street${ihMedian}
    FROM rent_roll_data rr${joins}
    WHERE ${portfolioWhere}
      AND ${B_BED_EXCLUSION}
    GROUP BY rr.service_line, rr.upload_month
  ),
  rate_baseline AS (
    -- A location whose own median is far below the portfolio median cannot be
    -- trusted to police itself, so it is judged against the portfolio instead.
    SELECT lb.location, lb.service_line, lb.upload_month,
           CASE WHEN sb.median_street IS NOT NULL
                     AND lb.median_street < ${RATE_OUTLIER_FLOOR_RATIO} * sb.median_street
                THEN sb.median_street ELSE lb.median_street END AS median_street${ihPick}
    FROM loc_baseline lb
    LEFT JOIN sl_baseline sb
      ON sb.service_line = lb.service_line AND sb.upload_month = lb.upload_month
  )`;
}

/** Join the baseline onto the outer query's `rent_roll_data rr`. */
export const RATE_BASELINE_JOIN = `
    LEFT JOIN rate_baseline rb
      ON rb.location = rr.location AND rb.service_line = rr.service_line
     AND rb.upload_month = rr.upload_month`;

/**
 * Street-rate gate. A NULL baseline means there was nothing to compare
 * against, so the row is kept — the gate never invents an exclusion.
 */
export const STREET_RATE_GATE =
  `(rb.median_street IS NULL OR rr.street_rate >= ${RATE_OUTLIER_FLOOR_RATIO} * rb.median_street)`;

/** In-house-rate gate. Requires `includeInHouse: true` on the CTE. */
export const IN_HOUSE_RATE_GATE =
  `(rb.median_ih IS NULL OR rr.in_house_rate >= ${RATE_OUTLIER_FLOOR_RATIO} * rb.median_ih)`;
