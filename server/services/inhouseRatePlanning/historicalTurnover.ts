/**
 * Historical annual turnover, per service line.
 *
 * The solver's `annualTurnoverPct` means one specific thing: the share of
 * residents replaced during the year by a new move-in **who pays the street
 * rate**. It drives how fast the resident base blends toward street pricing,
 * so the measurement has to match that meaning exactly.
 *
 * WHY THIS IS PAYER-SCOPED
 * Measured across all payers, this client's Health Center turns over 943% a
 * year — ~5,500 discharges a month against ~6,700 occupied beds. Those are
 * real clinical discharges, but the overwhelming majority are Medicare and
 * Managed Care short-stay rehab residents whose rate is set externally. We
 * never price them, so replacing one with another moves no revenue and must
 * not count as turnover here. Private-pay-only, HC lands at ~505% and AL at
 * ~140% — see the plausibility note below.
 *
 * Numerator and denominator must therefore be on the SAME payer basis:
 *   numerator   counted private-pay move-out events
 *   denominator average occupied units, private-pay share only
 *
 * WHY THE DENOMINATOR IS A BLEND OF TWO TABLES
 * `room_type_occupancy_history` is the authoritative occupancy level but has
 * no payer dimension. `rent_roll_data` has the payer but its `occupied_yn`
 * flag over-counts (B beds, companion rows). So we take the occupancy LEVEL
 * from history and only the payer MIX from the rent roll. Counting rent-roll
 * occupied rows directly would inflate the denominator and understate
 * turnover.
 */
import { pool } from "../../db";
import { privatePaySql } from "@shared/payerScope";
import {
  explainTurnoverOutOfBand,
  isTurnoverInBand,
  turnoverBandFor,
} from "@shared/turnoverBounds";

export interface ServiceLineTurnover {
  serviceLine: string;
  /** Private-pay move-outs counted in the months this line actually covers. */
  moveOuts: number;
  /** Average monthly occupied units across those months, private-pay share only. */
  avgOccupiedUnits: number;
  /** Share of occupied units that are private pay, 0-100. */
  privatePaySharePct: number;
  /**
   * Months of occupancy history backing this line, out of 12. A campus whose
   * history lags produces fewer, and the rate is annualised from what it has.
   */
  monthsCovered: number;
  /** Annualised move-outs over average occupied units, as a percent. */
  turnoverPct: number;
  /**
   * False when the figure must not be fed to the solver as-is — either outside
   * the plausible band for this service line, or built on too few months. The
   * operator sees the number and the reason and decides.
   */
  plausible: boolean;
  /** Inclusive plausible band for this line, in percent, for the UI to cite. */
  bandMin: number;
  bandMax: number;
  /** Why the measured figure was rejected, or null when it was accepted. */
  outOfBandReason: string | null;
}

export interface HistoricalTurnoverResult {
  /** First month of the measurement window, YYYY-MM. */
  windowStart: string;
  /** Last complete month of the measurement window, YYYY-MM. */
  windowEnd: string;
  monthsInWindow: number;
  byServiceLine: ServiceLineTurnover[];
}

/**
 * A turnover above this is reported but never auto-applied. Not a data-quality
 * judgement — short-stay rehab really does exceed it — but past 100% the
 * assumption stops behaving like a planning input.
 */
/**
 * Retired: `PLAUSIBLE_MAX_PCT`, a single portfolio-wide 100% ceiling.
 *
 * See shared/turnoverBounds for the per-service-line bands that replaced it.
 *
 * A single portfolio-wide ceiling cannot judge both a villa (long tenure) and
 * a skilled-nursing health center (short-stay rehab) with one number. At 100%
 * it waved through an AL/MC reading of 14%, which implies a seven-year
 * memory-care stay, while rejecting health-center readings that are ordinary
 * for that line.
 */

/**
 * Fewest months of occupancy history a line may be annualised from.
 *
 * Annualising two months of a seasonal census to a yearly rate is a guess
 * wearing a measurement's clothes. Below this the line still reports what it
 * found, flagged, and the saved assumption stands.
 */
const MIN_MONTHS_COVERED = 6;

/**
 * Event rows use the admissions vocabulary, occupancy history uses the
 * pricing vocabulary. `IL` only ever appears at campuses whose history rows
 * carry `VIL` and never `IL`, so the two names denote the same service line.
 *
 * THE OTHER HALF OF THIS GAP IS NOT AN ALIAS
 * `HC/MC` is the reverse case: occupancy history and the rent roll carry it,
 * the event feed never emitted it, and the missing discharges are sitting
 * inside `HC`. A rename cannot fix that — a line with a denominator and no
 * numerator measures 0% turnover, which reads as "nobody ever leaves memory
 * care". The fix belongs upstream, where the event's DEPARTMENT still knows
 * which neighbourhood the resident was in: the importer maps the memory-care
 * department to `HC/MC` and a boot-time backfill re-derives stored rows. So
 * there is deliberately no `HC/MC` entry here, and adding one would be wrong.
 * See `moveInOutService.ts` (DEPT_TO_SERVICE_LINE).
 */
const EVENT_SL_ALIASES: Record<string, string> = { IL: "VIL" };

function normalizeEventSl(sl: string | null): string | null {
  if (!sl) return null;
  const trimmed = sl.trim().toUpperCase();
  return EVENT_SL_ALIASES[trimmed] ?? trimmed;
}

/**
 * Resolve the last COMPLETE month we can measure.
 *
 * Two traps here. The event feed runs ahead of the month it is in — the newest
 * export lands a few days into August with ~300 HC discharges against a ~5,500
 * monthly run rate — so including it would drag every line down by roughly a
 * twelfth. And occupancy history can lag the event feed, which would leave the
 * numerator with months the denominator cannot cover. Taking the earlier of
 * "last complete event month" and "last history month" fixes both.
 */
async function resolveAnchorMonth(clientId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT MAX(event_date) FROM move_in_out_events WHERE client_id = $1) AS max_event_date,
       (SELECT to_char(make_date(year, month, 1), 'YYYY-MM')
          FROM room_type_occupancy_history
         WHERE client_id = $1
         ORDER BY year DESC, month DESC
         LIMIT 1) AS max_history_month`,
    [clientId],
  );
  const maxEventDate: string | null = rows[0]?.max_event_date ?? null;
  const maxHistoryMonth: string | null = rows[0]?.max_history_month ?? null;
  if (!maxEventDate || !maxHistoryMonth) return null;

  const eventMonth = maxEventDate.slice(0, 7);
  const dayOfMonth = Number(maxEventDate.slice(8, 10));
  // A feed that stops before the 28th has not finished the month it is in.
  const lastCompleteEventMonth = dayOfMonth >= 28 ? eventMonth : addMonths(eventMonth, -1);

  return lastCompleteEventMonth < maxHistoryMonth ? lastCompleteEventMonth : maxHistoryMonth;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const zeroBased = y * 12 + (m - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  const mon = (zeroBased % 12) + 1;
  return `${year}-${String(mon).padStart(2, "0")}`;
}

/**
 * Annual turnover per service line over the trailing 12 complete months.
 *
 * `locationName` scopes events (which key on campus name) and `locationId`
 * scopes history and rent roll (which key on id). Pass both or neither —
 * passing one silently mixes a scoped numerator with a portfolio denominator.
 */
export async function computeHistoricalTurnover(
  clientId: string,
  locationId: string | null,
  locationName: string | null,
): Promise<HistoricalTurnoverResult | null> {
  // Events key on campus NAME, occupancy and rent roll key on location ID.
  // Supplying one without the other scopes the numerator to a campus while
  // the denominator stays portfolio-wide (or the reverse), which reads as a
  // real collapse in turnover rather than as a scoping mistake. There is no
  // safe interpretation of a half-specified scope, so refuse it.
  if ((locationId === null) !== (locationName === null)) {
    throw new Error(
      "computeHistoricalTurnover requires both locationId and locationName, or neither.",
    );
  }

  const windowEnd = await resolveAnchorMonth(clientId);
  if (!windowEnd) return null;
  const monthsInWindow = 12;
  const windowStart = addMonths(windowEnd, -(monthsInWindow - 1));

  // Private-pay move-outs, kept per month so the numerator can be restricted
  // to the months the denominator can actually cover. The event feed's payer
  // column is the same open vocabulary the shared scope helper is built for.
  const moveOutSql = `
    SELECT service_line AS sl, substring(event_date, 1, 7) AS m, COUNT(*)::int AS n
      FROM move_in_out_events
     WHERE client_id = $1
       AND event_type = 'move_out'
       AND counted = true
       AND substring(event_date, 1, 7) BETWEEN $2 AND $3
       AND ${privatePaySql("payer")}
       ${locationName ? "AND location = $4" : ""}
     GROUP BY 1, 2`;

  // Occupied units per month from the authoritative occupancy source. Left
  // per-month rather than pre-averaged: a campus whose history lags has fewer
  // months than the window, and averaging here would hide that.
  const occSql = `
    SELECT service_line AS sl,
           to_char(make_date(year, month, 1), 'YYYY-MM') AS m,
           SUM(occ_units)::float AS monthly_occ
      FROM room_type_occupancy_history
     WHERE client_id = $1
       AND to_char(make_date(year, month, 1), 'YYYY-MM') BETWEEN $2 AND $3
       ${locationId ? "AND location_id = $4" : ""}
     GROUP BY 1, 2`;

  // Payer mix only — never the occupancy level (see file header).
  const shareSql = `
    SELECT service_line AS sl,
           COUNT(*) FILTER (WHERE occupied_yn AND ${privatePaySql("payor_type")})::float
             / NULLIF(COUNT(*) FILTER (WHERE occupied_yn), 0)::float AS pp_share
      FROM rent_roll_data
     WHERE client_id = $1
       ${locationId ? "AND location_id = $2" : ""}
     GROUP BY 1`;

  const eventParams: any[] = locationName
    ? [clientId, windowStart, windowEnd, locationName]
    : [clientId, windowStart, windowEnd];
  const occParams: any[] = locationId
    ? [clientId, windowStart, windowEnd, locationId]
    : [clientId, windowStart, windowEnd];
  const shareParams: any[] = locationId ? [clientId, locationId] : [clientId];

  const [moveOutRes, occRes, shareRes] = await Promise.all([
    pool.query(moveOutSql, eventParams),
    pool.query(occSql, occParams),
    pool.query(shareSql, shareParams),
  ]);

  // Move-outs indexed by line and month, so only the months backed by
  // occupancy history reach the numerator.
  const moveOutsBySlMonth = new Map<string, Map<string, number>>();
  for (const r of moveOutRes.rows) {
    const sl = normalizeEventSl(r.sl);
    if (!sl) continue;
    let byMonth = moveOutsBySlMonth.get(sl);
    if (!byMonth) {
      byMonth = new Map();
      moveOutsBySlMonth.set(sl, byMonth);
    }
    byMonth.set(r.m, (byMonth.get(r.m) ?? 0) + Number(r.n));
  }

  // Occupancy already speaks the pricing vocabulary; normalising is a no-op
  // that keeps the two sides keyed identically if that ever changes.
  const occBySl = new Map<string, Map<string, number>>();
  for (const r of occRes.rows) {
    const sl = normalizeEventSl(r.sl);
    if (!sl) continue;
    let byMonth = occBySl.get(sl);
    if (!byMonth) {
      byMonth = new Map();
      occBySl.set(sl, byMonth);
    }
    byMonth.set(r.m, (byMonth.get(r.m) ?? 0) + Number(r.monthly_occ));
  }

  const shareBySl = new Map<string, number>();
  for (const r of shareRes.rows) {
    const sl = normalizeEventSl(r.sl);
    if (!sl || r.pp_share === null) continue;
    shareBySl.set(sl, Number(r.pp_share));
  }

  const out: ServiceLineTurnover[] = [];
  for (const [sl, occMonths] of Array.from(occBySl.entries())) {
    const share = shareBySl.get(sl);
    // No rent-roll payer mix for this line means we cannot put the numerator
    // and denominator on the same basis. Reporting the all-payer denominator
    // here would understate turnover, so the line is omitted instead.
    if (share === undefined) continue;

    const months = Array.from(occMonths.keys()).filter((m) => (occMonths.get(m) ?? 0) > 0);
    const monthsCovered = months.length;
    if (monthsCovered === 0) continue;

    const avgOccAll =
      months.reduce((s, m) => s + (occMonths.get(m) ?? 0), 0) / monthsCovered;
    const avgOccPrivate = avgOccAll * share;
    if (avgOccPrivate <= 0) continue;

    // Count move-outs ONLY in the months occupancy can account for, then
    // annualise from that. Pairing a full year of move-outs with an average
    // over the four months a campus happens to have reports a turnover far
    // above anything that happened, and reports it as a 12-month measure.
    const byMonth = moveOutsBySlMonth.get(sl);
    const moveOuts = months.reduce((s, m) => s + (byMonth?.get(m) ?? 0), 0);
    const annualisedMoveOuts = (moveOuts / monthsCovered) * monthsInWindow;
    const turnoverPct = (annualisedMoveOuts / avgOccPrivate) * 100;

    // Judge the rounded figure, so the badge never contradicts the number
    // printed beside it (an 85.04% against an 85% ceiling reads as a bug).
    const rounded = Math.round(turnoverPct * 10) / 10;
    const band = turnoverBandFor(sl);
    const inBand = isTurnoverInBand(sl, rounded);
    const thinCoverage =
      monthsCovered < MIN_MONTHS_COVERED
        ? `Only ${monthsCovered} month${monthsCovered === 1 ? "" : "s"} of occupancy history — too few to annualise from.`
        : null;

    out.push({
      serviceLine: sl,
      moveOuts,
      avgOccupiedUnits: Math.round(avgOccPrivate),
      privatePaySharePct: Math.round(share * 1000) / 10,
      monthsCovered,
      turnoverPct: rounded,
      plausible: inBand && thinCoverage === null,
      bandMin: band.min,
      bandMax: band.max,
      // Coverage is reported first: with only a few months behind it the
      // percent itself is not yet evidence of anything, in band or out.
      outOfBandReason:
        thinCoverage ?? explainTurnoverOutOfBand(sl, rounded),
    });
  }

  out.sort((a, b) => a.serviceLine.localeCompare(b.serviceLine));
  return { windowStart, windowEnd, monthsInWindow, byServiceLine: out };
}
