/**
 * rateBaselineView — the rate outlier gate as a database VIEW.
 *
 * Every surface that aggregates street or in-house rates joins this view and
 * applies the gate predicates below. It replaces both the old fixed "$1,000
 * unless HC" floor and the per-query CTE version of the gate.
 *
 * ── Why a view rather than a CTE per query ─────────────────────────────────
 * The gate is two-level: a rate is judged against the median for its own location +
 * service line, and that median is in turn judged against the median for the
 * service line ACROSS THE PORTFOLIO, so that a location whose rows are ALL
 * junk cannot pass its own test.
 *
 * When each query built its own baseline, the level-2 population inherited
 * whatever filters that query carried. Filtering a page to one campus then
 * collapsed the portfolio yardstick onto that same campus and silently
 * disabled level 2 — exactly when a user was drilling in. That bug was found
 * and fixed independently in three separate places, which is the signal that
 * per-query construction was the wrong shape.
 *
 * A view cannot have that bug. The baselines are defined once, over the whole
 * table, and no caller can narrow them. Call sites only choose which rows to
 * *report*, never which rows define "normal".
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * client_id and upload_month are grouping keys in both branches, so equality
 * predicates on them push down into the aggregation. Always join with an
 * explicit client and month qual (buildRateBaselineJoin does this) rather than
 * relying on join keys alone, or Postgres computes medians for every client
 * and every month before filtering.
 */
import { RATE_OUTLIER_FLOOR_RATIO } from "@shared/rateOutliers";
import { bBedExclusionSql } from "@shared/bBed";

export const RATE_BASELINE_VIEW = "rate_baseline_v";

/**
 * Idempotent DDL. The ratio is interpolated from the shared constant so the
 * view and the JS twin cannot disagree about the threshold.
 *
 * Companion ("B bed") rows are excluded from BOTH baselines: they are
 * second-occupant entries against a room that is already counted, and their
 * half-price rates would drag the reference level down.
 */
export const RATE_BASELINE_VIEW_DDL = `
CREATE OR REPLACE VIEW ${RATE_BASELINE_VIEW} AS
WITH loc AS (
  SELECT client_id, upload_month, location, service_line,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate)
           FILTER (WHERE street_rate > 0) AS median_street,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY in_house_rate)
           FILTER (WHERE occupied_yn AND in_house_rate > 0) AS median_ih
  FROM rent_roll_data
  WHERE ${bBedExclusionSql("")}
  GROUP BY client_id, upload_month, location, service_line
),
sl AS (
  SELECT client_id, upload_month, service_line,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate)
           FILTER (WHERE street_rate > 0) AS median_street,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY in_house_rate)
           FILTER (WHERE occupied_yn AND in_house_rate > 0) AS median_ih
  FROM rent_roll_data
  WHERE ${bBedExclusionSql("")}
  GROUP BY client_id, upload_month, service_line
)
SELECT l.client_id,
       l.upload_month,
       l.location,
       l.service_line,
       l.median_street AS own_median_street,
       s.median_street AS portfolio_median_street,
       CASE WHEN s.median_street IS NOT NULL
                 AND l.median_street < ${RATE_OUTLIER_FLOOR_RATIO} * s.median_street
            THEN s.median_street ELSE l.median_street END AS baseline_street,
       CASE WHEN s.median_ih IS NOT NULL
                 AND l.median_ih < ${RATE_OUTLIER_FLOOR_RATIO} * s.median_ih
            THEN s.median_ih ELSE l.median_ih END AS baseline_ih
FROM loc l
LEFT JOIN sl s
  ON s.client_id = l.client_id
 AND s.upload_month = l.upload_month
 AND s.service_line IS NOT DISTINCT FROM l.service_line
`;

export interface RateBaselineJoinOptions {
  /**
   * Column prefix for the rent-roll rows being filtered, including the dot —
   * e.g. `"rr."`, `"rrd."`, or `""` when the query has no table alias.
   */
  rr?: string;
  /** SQL for the client id, usually a placeholder such as `"$1"`. */
  clientSql: string;
  /**
   * SQL for the month scope. Pass the SAME expression the outer query scopes
   * to, so the predicate pushes down into the view's aggregation. A sub-select
   * such as `(SELECT MAX(upload_month) ...)` is fine.
   *
   * Correlating on the row's own `upload_month` column alone is NOT enough for
   * pushdown: a join key against the outer row cannot be evaluated before the
   * aggregation, so Postgres computes medians for every month of this client.
   * Omit this only when the outer query genuinely spans all months, in which
   * case the join falls back to that correlation.
   */
  monthSql?: string;
  /**
   * Set when `monthSql` is an ARRAY of months (a multi-month query). The join
   * then scopes the view with `= ANY(...)` and additionally correlates each
   * row to the baseline for its OWN month — a rate must be judged against the
   * price level of its own month, not against a blend across the range.
   */
  monthIsArray?: boolean;
  /** Alias for the joined view. Default `"rb"`. */
  alias?: string;
}

/**
 * Build the `LEFT JOIN` that brings the baselines into scope.
 *
 * LEFT, not INNER: a location + service line with no usable rates has no
 * baseline row, and those rows must still be counted (a missing baseline makes
 * the gate permissive, never exclusionary — see the gate helpers).
 */
export function buildRateBaselineJoin(opts: RateBaselineJoinOptions): string {
  const { rr = "rr.", clientSql, monthSql, monthIsArray = false, alias = "rb" } = opts;
  const monthPredicate = !monthSql
    ? `${alias}.upload_month = ${rr}upload_month`
    : monthIsArray
      ? `${alias}.upload_month = ANY(${monthSql})
   AND ${alias}.upload_month = ${rr}upload_month`
      : `${alias}.upload_month = ${monthSql}`;
  return `LEFT JOIN ${RATE_BASELINE_VIEW} ${alias}
    ON ${alias}.client_id = ${clientSql}
   AND ${monthPredicate}
   AND ${alias}.location = ${rr}location
   AND ${alias}.service_line IS NOT DISTINCT FROM ${rr}service_line`;
}

/**
 * Predicate keeping a street rate. Deliberately permissive when no baseline
 * exists: we suppress rates we can prove are implausible, never rates we
 * simply cannot judge.
 */
export function streetRateGate(rr: string = "rr.", alias: string = "rb"): string {
  return `(${alias}.baseline_street IS NULL OR ${rr}street_rate >= ${RATE_OUTLIER_FLOOR_RATIO} * ${alias}.baseline_street)`;
}

/** Predicate keeping an in-house rate. Only ever applied to occupied rows. */
export function inHouseRateGate(rr: string = "rr.", alias: string = "rb"): string {
  return `(${alias}.baseline_ih IS NULL OR ${rr}in_house_rate >= ${RATE_OUTLIER_FLOOR_RATIO} * ${alias}.baseline_ih)`;
}

export type BaselineQueryFn = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

/**
 * Fetch the street baselines for one client + month as a lookup map keyed
 * `location||service_line`.
 *
 * For code paths that filter rent-roll rows in JavaScript rather than SQL.
 * They get the identical baselines the SQL surfaces use, so a rate suppressed
 * on one page cannot survive on another.
 */
export async function fetchStreetBaselineMap(
  queryFn: BaselineQueryFn,
  clientId: string,
  month: string,
): Promise<Map<string, number>> {
  const res = await queryFn(
    `SELECT location, service_line, baseline_street
       FROM ${RATE_BASELINE_VIEW}
      WHERE client_id = $1 AND upload_month = $2 AND baseline_street IS NOT NULL`,
    [clientId, month],
  );
  const map = new Map<string, number>();
  for (const r of res.rows) {
    // service_line is keyed exactly as stored — NULL becomes the empty string
    // rather than a display placeholder, so callers with a NULL service line
    // still find their baseline.
    map.set(`${r.location}||${r.service_line ?? ""}`, Number(r.baseline_street));
  }
  return map;
}

/**
 * The JS twin of `streetRateGate`. Permissive when no baseline is known, for
 * the same reason the SQL predicate is: suppress only what we can prove is
 * implausible.
 */
export function passesStreetGate(rate: number, baseline: number | null | undefined): boolean {
  if (baseline == null || !(baseline > 0)) return true;
  return rate >= RATE_OUTLIER_FLOOR_RATIO * baseline;
}

/** Create or update the view. Safe to call on every boot. */
export async function ensureRateBaselineView(
  exec: (sql: string) => Promise<unknown>,
): Promise<void> {
  await exec(RATE_BASELINE_VIEW_DDL);
}
