/**
 * groupStreetRateJs — the JavaScript twin of the SQL rate outlier gate.
 *
 * The Room Detail view (GET /api/reference-data/units) already has every unit
 * row in memory and averages them in JS rather than re-running the grouped
 * SQL. That average is the rule-preview base rate for the detail view, while
 * the grouped view shows the figure produced by rateBaselineSql.ts. The two
 * MUST stay on the same basis — any divergence makes the same unit price
 * differently on two screens.
 *
 * This lives in its own module, rather than inline in the route, so tests can
 * call the real implementation instead of re-deriving it. A parity test that
 * mirrors the logic it is checking guarantees nothing.
 *
 * See rateBaselineSql.ts for why the gate is relative and two-level.
 */
import { RATE_OUTLIER_FLOOR_RATIO } from "@shared/rateOutliers";
import { isBBedRow } from "@shared/bBed";
import { B_BED_EXCLUSION } from "./rateBaselineSql";

export type RateQueryFn = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

/** The subset of a rent-roll row the gate needs. Matches the units query's output. */
export interface StreetRateGateRow {
  campus: string;
  service_line: string | null;
  room_type: string | null;
  room_number: string | null;
  street_rate: number | string | null;
}

/** Matches Postgres percentile_cont(0.5) — interpolates across an even count. */
function median(arr: number[]): number {
  arr.sort((a, b) => a - b);
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/**
 * Level 2 baseline: the median street rate per service line across the WHOLE
 * portfolio for the given month.
 *
 * This is deliberately a separate query rather than something derived from the
 * caller's rows. The caller's rows are already narrowed by its
 * location / region / division filters, so deriving the portfolio median from
 * them would collapse the yardstick onto whatever the user is currently
 * looking at and silently disable level 2 — exactly when they are drilling in.
 * Mirrors the `sl_baseline` CTE's portfolioWhere scope: tenant + month only.
 */
async function fetchServiceLineMedians(
  query: RateQueryFn,
  clientId: string,
  spotMonth: string,
): Promise<Map<string, number>> {
  const res = await query(
    `SELECT rr.service_line AS service_line,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY rr.street_rate) AS med
     FROM rent_roll_data rr
     WHERE rr.client_id = $1 AND rr.upload_month = $2 AND rr.street_rate > 0
       AND ${B_BED_EXCLUSION}
     GROUP BY rr.service_line`,
    [clientId, spotMonth],
  );
  const out = new Map<string, number>();
  for (const r of res.rows as any[]) {
    if (r.med != null) out.set(r.service_line || "Other", Number(r.med));
  }
  return out;
}

/**
 * Average street rate per `campus||serviceLine||roomType`, with outliers
 * removed by the two-level gate.
 *
 * A room type whose every row is gated out is ABSENT from the result rather
 * than present with a wrong number — blank beats plausible-but-false.
 */
export async function computeGroupStreetRateMap(
  query: RateQueryFn,
  clientId: string,
  spotMonth: string,
  rows: StreetRateGateRow[],
): Promise<Map<string, number>> {
  // A row is eligible for BOTH the baseline and the average, so the level-1
  // median is drawn from exactly the population it filters.
  const eligible: { sl: string; slKey: string; rtKey: string; rate: number }[] = [];
  for (const r of rows) {
    const st = Number(r.street_rate) || 0;
    if (st <= 0) continue;
    if (isBBedRow(r.service_line, r.room_number)) continue;
    const sl = r.service_line || "Other";
    eligible.push({
      sl,
      slKey: `${r.campus}||${sl}`,
      rtKey: `${r.campus}||${sl}||${r.room_type || "Other"}`,
      rate: st,
    });
  }

  // Level 1 — each campus + service line is judged against itself.
  const locBuckets = new Map<string, number[]>();
  for (const e of eligible) {
    let arr = locBuckets.get(e.slKey);
    if (!arr) { arr = []; locBuckets.set(e.slKey, arr); }
    arr.push(e.rate);
  }
  const locMedians = new Map<string, number>();
  for (const [k, arr] of Array.from(locBuckets.entries())) locMedians.set(k, median(arr));

  // Level 2 — a campus whose rates are ALL implausible cannot police itself.
  const slMedians = await fetchServiceLineMedians(query, clientId, spotMonth);

  const acc = new Map<string, { sum: number; n: number }>();
  for (const e of eligible) {
    const locMed = locMedians.get(e.slKey);
    const slMed = slMedians.get(e.sl);
    const baseline =
      locMed != null && slMed != null && locMed < RATE_OUTLIER_FLOOR_RATIO * slMed
        ? slMed
        : locMed;
    if (baseline != null && e.rate < RATE_OUTLIER_FLOOR_RATIO * baseline) continue;
    let a = acc.get(e.rtKey);
    if (!a) { a = { sum: 0, n: 0 }; acc.set(e.rtKey, a); }
    a.sum += e.rate;
    a.n++;
  }

  const out = new Map<string, number>();
  for (const [key, a] of Array.from(acc.entries())) {
    if (a.n > 0) out.set(key, a.sum / a.n);
  }
  return out;
}
