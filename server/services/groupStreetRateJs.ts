/**
 * groupStreetRateJs — group street-rate averaging for rows already in memory.
 *
 * The Room Detail view (GET /api/reference-data/units) already has every unit
 * row in memory and averages them in JS rather than re-running the grouped
 * SQL. That average is the rule-preview base rate for the detail view, while
 * the grouped view shows the figure produced by the same aggregation in SQL.
 * The two MUST stay on the same basis — any divergence makes the same unit
 * price differently on two screens.
 *
 * The outlier baselines are NOT recomputed here. They are read from the
 * rate_baseline_v view, the same source the SQL surfaces join, so the two
 * cannot drift and neither can be narrowed by the caller's display filters.
 * An earlier hand-written twin derived its portfolio median from the caller's
 * already-filtered rows, which silently disabled the second level of the gate
 * whenever a user drilled into a single campus.
 *
 * This lives in its own module, rather than inline in the route, so tests can
 * call the real implementation instead of re-deriving it. A parity test that
 * mirrors the logic it is checking guarantees nothing.
 *
 * See rateBaselineView.ts for why the gate is relative and two-level.
 */
import { isBaseRateRow } from "@shared/baseRate";
import {
  fetchStreetBaselineMap,
  passesStreetGate,
  type BaselineQueryFn,
} from "./rateBaselineView";

export type RateQueryFn = BaselineQueryFn;

/** The subset of a rent-roll row the gate needs. Matches the units query's output. */
export interface StreetRateGateRow {
  campus: string;
  service_line: string | null;
  /** Display room type: the branded RTG group_name when one exists. */
  room_type: string | null;
  /**
   * The NORMALISED room type (`rent_roll_data.room_type`). Confusingly named
   * because `room_type` above is already the branded display value; the units
   * query aliases the canonical column here. This is what the grouped SQL's
   * base-rate predicate tests, so the twin must test the same thing.
   */
  source_room_type: string | null;
  /**
   * The genuine `rent_roll_data.source_room_type` column. Required, not
   * optional: making it optional would let a caller omit it and silently drop
   * the half of the base-rate predicate that catches "TCU - Private" and
   * "Private Rehab", which both normalise to plain "Studio".
   */
  raw_source_room_type: string | null;
  room_number: string | null;
  street_rate: number | string | null;
}

/**
 * Average street rate per `campus||serviceLine||roomType`, with outliers
 * removed by the shared two-level gate.
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
  const baselines = await fetchStreetBaselineMap(query, clientId, spotMonth);

  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const st = Number(r.street_rate) || 0;
    if (st <= 0) continue;
    // Base rate only: single occupant, standard stay. Mirrors
    // baseRateExclusionSql in the grouped reference-data query. Note the
    // canonical room type is carried in `source_room_type`, not `room_type`.
    if (!isBaseRateRow(r.service_line, r.room_number, r.source_room_type, r.raw_source_room_type)) continue;

    // The view keys service_line exactly as stored, including NULL; the output
    // key keeps the display-facing "Other" placeholder. These are deliberately
    // separate so a NULL service line still finds its baseline.
    const baseline = baselines.get(`${r.campus}||${r.service_line ?? ""}`);
    if (!passesStreetGate(st, baseline)) continue;

    const key = `${r.campus}||${r.service_line || "Other"}||${r.room_type || "Other"}`;
    let a = acc.get(key);
    if (!a) { a = { sum: 0, n: 0 }; acc.set(key, a); }
    a.sum += st;
    a.n++;
  }

  const out = new Map<string, number>();
  for (const [key, a] of Array.from(acc.entries())) {
    if (a.n > 0) out.set(key, a.sum / a.n);
  }
  return out;
}
