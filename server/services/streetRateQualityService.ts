/**
 * Street-rate data quality: suspect-row reporting and import-time
 * campus median-shift guard.
 *
 * Mirrors the philosophy of competitorRateSanitizer (plausibility guard with
 * explicit reasons), but for our OWN street rates, where "plausible" is
 * relative rather than absolute:
 *
 * - HC / HC/MC street rates are natively DAILY ($300-900 is normal), so an
 *   absolute monthly floor would flood the report with false positives.
 *   All checks compare a row against its own prior month and campus median.
 * - `2ND OCCUPANT` payor rows (incl. "LEGACY - 2ND OCCUPANT") are companion
 *   B-bed surcharges, not room rates. They are excluded from every suspect
 *   rule and from the median calculations; the existing B-bed exclusion
 *   already keeps them out of street-rate aggregates.
 * - Rows whose street rate collapsed by ~an order of magnitude but that have
 *   a move-in (or move-out) inside the reporting month are classified as
 *   "prorated_move_in": the source export overwrites the street rate with the
 *   resident's prorated first-month charge. These are expected source
 *   behavior, reported for visibility but flagged as expected, not corrupt.
 */
import { pool } from "../db";
import { buildRateBaselineJoin, streetRateGate } from "./rateBaselineView";
import { bBedExclusionSql } from "@shared/bBed";

/** A campus median moving by at least this factor month-over-month is flagged. */
export const MEDIAN_SHIFT_FACTOR = 8;

/**
 * A rate below this fraction of its OWN location + service-line median is
 * treated as an outlier (data-entry slip, prorated move-in month) and excluded
 * from representative rate aggregates.
 *
 * This replaces an older fixed "$1,000 minimum for non-HC lines" rule. A fixed
 * floor cannot tell a genuinely low-priced line (VIL/SL) from a bad row, so it
 * silently dropped real inventory — and it needed an explicit HC carve-out
 * because HC rates are daily. A relative test needs no carve-out: every line is
 * judged against its own price level.
 */
export { RATE_OUTLIER_FLOOR_RATIO } from "@shared/rateOutliers";

/** Payor tags that mark second-occupant (companion surcharge) rows. */
export const SECOND_OCCUPANT_RE = /2ND\s*OCCUPANT/i;

export function isSecondOccupantRow(payorType: string | null | undefined): boolean {
  return SECOND_OCCUPANT_RE.test(payorType || "");
}

/** SQL predicate fragment (parameterless) excluding second-occupant payor rows. */
const NOT_SECOND_OCCUPANT_SQL = `upper(coalesce(payor_type,'')) NOT LIKE '%2ND OCCUPANT%'`;

export interface SuspectStreetRateRow {
  id: string;
  location: string;
  roomNumber: string;
  serviceLine: string;
  roomType: string | null;
  streetRate: number;
  prevMonthRate: number | null;
  siblingMedianRate: number | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  payorType: string | null;
  classification: "prorated_move_in" | "suspect";
}

export interface CampusSuspectGroup {
  location: string;
  suspectCount: number;
  proratedCount: number;
  rows: SuspectStreetRateRow[];
}

export interface CampusMedianShift {
  location: string;
  serviceLine: string;
  currentMedian: number;
  previousMedian: number;
  ratio: number;
}

/** A row the outlier gate removed from every rate aggregate. */
export interface GateExcludedRow {
  location: string;
  serviceLine: string;
  roomType: string | null;
  roomNumber: string;
  streetRate: number;
  /** The baseline it was judged against (from rate_baseline_v). */
  baseline: number;
  /** streetRate as a percentage of that baseline — how far below it fell. */
  pctOfBaseline: number;
}

/** Excluded rows collected per campus + service line + room type. */
export interface GateExcludedGroup {
  location: string;
  serviceLine: string;
  roomType: string;
  droppedCount: number;
  totalCount: number;
  /**
   * Every row in the group was excluded, so this group now reports NO street
   * rate anywhere in the product. These are the highest-priority fixes: a
   * blank is correct given the data, but it is still a hole in the numbers.
   */
  blanked: boolean;
  rows: GateExcludedRow[];
}

export interface StreetRateQualityReport {
  month: string;
  previousMonth: string;
  campuses: CampusSuspectGroup[];
  medianShifts: CampusMedianShift[];
  /**
   * Rows silently dropped from rate averages by the outlier gate. Surfaced so
   * bad source data gets corrected at the source rather than quietly reducing
   * the population behind every rate on the platform.
   */
  excludedFromAggregates: {
    groups: GateExcludedGroup[];
    totals: { rows: number; groups: number; blankedGroups: number; campuses: number };
  };
  totals: { suspect: number; proratedMoveIn: number; campusesAffected: number };
}

/**
 * Rows the shared rate outlier gate removes from street-rate aggregates for a
 * month, with the baseline each was judged against.
 *
 * This uses the SAME view join and the SAME predicate the aggregates use, so
 * the report cannot drift from what the product actually did. Reproducing the
 * gate here with hand-written SQL would let the report claim one thing while
 * the averages did another.
 */
export async function getGateExcludedRows(
  clientId: string,
  month: string,
  // Injectable so the grouping and totals logic can be tested without a
  // database; production callers use the real pool.
  queryFn: (sql: string, params: any[]) => Promise<{ rows: any[] }> = (sql, params) =>
    pool.query(sql, params),
): Promise<StreetRateQualityReport["excludedFromAggregates"]> {
  const join = buildRateBaselineJoin({ rr: "rr.", clientSql: "$1", monthSql: "$2" });
  const res = await queryFn(
    `WITH marked AS (
       SELECT rr.location, rr.service_line, rr.room_type, rr.room_number,
              rr.street_rate, rb.baseline_street,
              ${streetRateGate("rr.")} AS kept
       FROM rent_roll_data rr
       ${join}
       WHERE rr.client_id = $1 AND rr.upload_month = $2 AND rr.street_rate > 0
         AND ${bBedExclusionSql("rr.")}
     ),
     windowed AS (
       SELECT m.*,
              COUNT(*) OVER w AS group_total,
              COUNT(*) FILTER (WHERE NOT m.kept) OVER w AS group_dropped
       FROM marked m
       WINDOW w AS (PARTITION BY m.location, m.service_line, m.room_type)
     )
     SELECT * FROM windowed
     WHERE NOT kept
     ORDER BY location, service_line, room_type, street_rate`,
    [clientId, month],
  );

  // A single bad import can gate an entire large campus, so the detail rows are
  // bounded. The COUNTS stay exact (they come from window functions over the
  // full set) — only the per-group examples are truncated, and an admin needs a
  // handful of examples to identify the defect, not hundreds.
  const MAX_ROWS_PER_GROUP = 25;
  const MAX_GROUPS = 200;

  const groups = new Map<string, GateExcludedGroup>();
  for (const r of res.rows) {
    // The Map key must mirror the SQL PARTITION exactly, on the RAW values.
    // Keying on the display fallback (`room_type || "Other"`) would merge three
    // distinct SQL partitions — NULL, '' and a literal room type named "Other" —
    // into one entry, and since each carries its own group_dropped, the totals
    // would silently undercount. A separator that cannot occur in the data plus
    // an explicit NULL sentinel keeps the key collision-free.
    const raw = (v: string | null) => (v === null || v === undefined ? "\u0000NULL" : v);
    const key = `${raw(r.location)}\u0001${raw(r.service_line)}\u0001${raw(r.room_type)}`;
    const roomType = r.room_type || "Other";
    let g = groups.get(key);
    if (!g) {
      g = {
        location: r.location,
        serviceLine: r.service_line || "",
        roomType,
        droppedCount: Number(r.group_dropped),
        totalCount: Number(r.group_total),
        blanked: Number(r.group_dropped) === Number(r.group_total),
        rows: [],
      };
      groups.set(key, g);
    }
    if (g.rows.length >= MAX_ROWS_PER_GROUP) continue;
    const rate = Number(r.street_rate);
    const baseline = Number(r.baseline_street);
    g.rows.push({
      location: r.location,
      serviceLine: r.service_line || "",
      roomType: r.room_type,
      roomNumber: r.room_number,
      streetRate: rate,
      baseline: Math.round(baseline),
      pctOfBaseline: baseline > 0 ? Math.round((rate / baseline) * 100) : 0,
    });
  }

  // Wholly blanked groups first — they are holes in the numbers, not just a
  // thinner average — then by how much of the group was lost.
  const all = Array.from(groups.values()).sort(
    (a, b) =>
      Number(b.blanked) - Number(a.blanked) ||
      b.droppedCount / b.totalCount - a.droppedCount / a.totalCount ||
      b.droppedCount - a.droppedCount,
  );

  // Totals are computed over EVERY group, before the display cap, so a
  // truncated list never understates how much data was dropped.
  const totals = {
    rows: all.reduce((s, g) => s + g.droppedCount, 0),
    groups: all.length,
    blankedGroups: all.filter((g) => g.blanked).length,
    campuses: new Set(all.map((g) => g.location)).size,
  };

  return { groups: all.slice(0, MAX_GROUPS), totals };
}

function previousMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Does a M/D/YYYY or YYYY-MM-DD date string fall inside the given YYYY-MM month? */
export function dateInMonth(dateStr: string | null | undefined, month: string): boolean {
  if (!dateStr) return false;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7) === month;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}` === month;
  return false;
}

/**
 * Suspect rows for a month: street rate moved by >= MEDIAN_SHIFT_FACTOR in
 * either direction versus the same room's prior month. Excludes second-
 * occupant rows and zero rates. Classifies prorated move-ins/outs separately.
 */
export async function getStreetRateQualityReport(clientId: string, month: string): Promise<StreetRateQualityReport> {
  const prevMonth = previousMonthOf(month);

  const suspectsRes = await pool.query(
    `WITH cur AS (
       SELECT id, location, room_number, service_line, room_type, street_rate,
              move_in_date, move_out_date, payor_type
       FROM rent_roll_data
       WHERE client_id = $1 AND upload_month = $2 AND street_rate > 0
         AND ${NOT_SECOND_OCCUPANT_SQL}
     ),
     prev AS (
       SELECT location, room_number, service_line,
              max(street_rate) AS prev_rate
       FROM rent_roll_data
       WHERE client_id = $1 AND upload_month = $3 AND street_rate > 0
       GROUP BY 1, 2, 3
     ),
     siblings AS (
       SELECT location, service_line, room_type,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate) AS median_rate
       FROM rent_roll_data
       WHERE client_id = $1 AND upload_month = $2 AND street_rate > 0
         AND ${NOT_SECOND_OCCUPANT_SQL}
         AND NOT (service_line IN ('AL','AL/MC','SL','VIL') AND room_number ~* '/[B-Zb-z]$')
       GROUP BY 1, 2, 3
     )
     SELECT c.*, p.prev_rate, s.median_rate
     FROM cur c
     JOIN prev p ON p.location = c.location AND p.room_number = c.room_number AND p.service_line = c.service_line
     LEFT JOIN siblings s ON s.location = c.location AND s.service_line = c.service_line
       AND coalesce(s.room_type,'') = coalesce(c.room_type,'')
     WHERE p.prev_rate >= c.street_rate * $4 OR c.street_rate >= p.prev_rate * $4
     ORDER BY c.location, c.room_number`,
    [clientId, month, prevMonth, MEDIAN_SHIFT_FACTOR],
  );

  const byCampus = new Map<string, CampusSuspectGroup>();
  let suspect = 0;
  let prorated = 0;
  for (const r of suspectsRes.rows) {
    const cur = Number(r.street_rate);
    const prev = Number(r.prev_rate);
    // Prorated in this month (rate collapsed, resident event inside the month)
    // or recovering from a prior-month proration (rate jumped back up and the
    // resident event was inside the previous month).
    const isProrated =
      dateInMonth(r.move_in_date, month) || dateInMonth(r.move_out_date, month) ||
      (cur > prev && (dateInMonth(r.move_in_date, prevMonth) || dateInMonth(r.move_out_date, prevMonth)));
    const row: SuspectStreetRateRow = {
      id: r.id,
      location: r.location,
      roomNumber: r.room_number,
      serviceLine: r.service_line,
      roomType: r.room_type,
      streetRate: Number(r.street_rate),
      prevMonthRate: r.prev_rate == null ? null : Number(r.prev_rate),
      siblingMedianRate: r.median_rate == null ? null : Math.round(Number(r.median_rate)),
      moveInDate: r.move_in_date,
      moveOutDate: r.move_out_date,
      payorType: r.payor_type,
      classification: isProrated ? "prorated_move_in" : "suspect",
    };
    if (isProrated) prorated++; else suspect++;
    let g = byCampus.get(row.location);
    if (!g) { g = { location: row.location, suspectCount: 0, proratedCount: 0, rows: [] }; byCampus.set(row.location, g); }
    g.rows.push(row);
    if (isProrated) g.proratedCount++; else g.suspectCount++;
  }

  const [medianShifts, excludedFromAggregates] = await Promise.all([
    computeCampusMedianShiftsFromDb(clientId, month, prevMonth),
    getGateExcludedRows(clientId, month),
  ]);

  const campuses = Array.from(byCampus.values()).sort(
    (a, b) => b.suspectCount - a.suspectCount || b.proratedCount - a.proratedCount,
  );

  return {
    month,
    previousMonth: prevMonth,
    campuses,
    medianShifts,
    excludedFromAggregates,
    totals: {
      suspect,
      proratedMoveIn: prorated,
      campusesAffected: campuses.filter((c) => c.suspectCount > 0).length,
    },
  };
}

async function computeCampusMedianShiftsFromDb(clientId: string, month: string, prevMonth: string): Promise<CampusMedianShift[]> {
  // Medians are compared per location + service line: HC / HC/MC rates are
  // daily while senior-housing rates are monthly, so a campus-wide median is
  // unstable whenever the bed mix shifts across that boundary.
  const res = await pool.query(
    `WITH cur AS (
       SELECT location, service_line, percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate) AS med
       FROM rent_roll_data
       WHERE client_id = $1 AND upload_month = $2 AND street_rate > 0 AND ${NOT_SECOND_OCCUPANT_SQL}
         AND NOT (service_line IN ('AL','AL/MC','SL','VIL') AND room_number ~* '/[B-Zb-z]$')
       GROUP BY 1, 2
     ),
     prev AS (
       SELECT location, service_line, percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate) AS med
       FROM rent_roll_data
       WHERE client_id = $1 AND upload_month = $3 AND street_rate > 0 AND ${NOT_SECOND_OCCUPANT_SQL}
         AND NOT (service_line IN ('AL','AL/MC','SL','VIL') AND room_number ~* '/[B-Zb-z]$')
       GROUP BY 1, 2
     )
     SELECT c.location, c.service_line, c.med AS cur_med, p.med AS prev_med
     FROM cur c JOIN prev p ON p.location = c.location AND p.service_line = c.service_line
     WHERE p.med > 0 AND (c.med >= p.med * $4 OR p.med >= c.med * $4)
     ORDER BY c.location, c.service_line`,
    [clientId, month, prevMonth, MEDIAN_SHIFT_FACTOR],
  );
  return res.rows.map((r) => ({
    location: r.location,
    serviceLine: r.service_line,
    currentMedian: Math.round(Number(r.cur_med)),
    previousMedian: Math.round(Number(r.prev_med)),
    ratio: Number(r.prev_med) > 0 ? Number(r.cur_med) / Number(r.prev_med) : 0,
  }));
}

export interface IncomingRentRollRow {
  location: string | null | undefined;
  roomNumber?: string | null;
  serviceLine?: string | null;
  streetRate: number | null | undefined;
  payorType?: string | null;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Pure core of the import-time guard (testable without a database): group
 * incoming rows per location + service line (excluding second-occupant and
 * senior-housing B-bed rows), compare each group's median against the
 * previous month's median, and produce warnings for >= MEDIAN_SHIFT_FACTOR
 * shifts in either direction.
 */
export function computeShiftWarningsFromMedians(
  rows: IncomingRentRollRow[],
  prevMedians: Map<string, number>,
  month: string,
  prevMonth: string,
): string[] {
  const bBedRe = /\/[B-Zb-z]$/;
  const seniorSls = new Set(["AL", "AL/MC", "SL", "VIL"]);
  // Group per location + service line: HC / HC/MC rates are daily while
  // senior-housing rates are monthly, so campus-wide medians shift when the
  // bed mix moves even though nothing is wrong.
  const byGroup = new Map<string, number[]>();
  for (const r of rows) {
    const rate = Number(r.streetRate) || 0;
    const loc = (r.location || "").trim();
    if (!loc || rate <= 0) continue;
    if (isSecondOccupantRow(r.payorType)) continue;
    if (seniorSls.has(r.serviceLine || "") && bBedRe.test(r.roomNumber || "")) continue;
    const key = `${loc}||${(r.serviceLine || "").trim()}`;
    const arr = byGroup.get(key) || [];
    arr.push(rate);
    byGroup.set(key, arr);
  }

  const warnings: string[] = [];
  for (const [key, rates] of Array.from(byGroup.entries())) {
    const cur = median(rates);
    const prev = prevMedians.get(key);
    if (!prev || prev <= 0 || cur <= 0) continue;
    const ratio = cur / prev;
    if (ratio >= MEDIAN_SHIFT_FACTOR || ratio <= 1 / MEDIAN_SHIFT_FACTOR) {
      const [loc, sl] = key.split("||");
      warnings.push(
        `Street-rate check: ${loc} (${sl}) median street rate moved from $${Math.round(prev).toLocaleString()} (${prevMonth}) to $${Math.round(cur).toLocaleString()} (${month}) — a ${ratio < 1 ? `${Math.round(1 / ratio)}x drop` : `${Math.round(ratio)}x jump`}. This usually means the file carries daily instead of monthly rates (or vice versa). The import was NOT blocked; verify the source file and re-upload the month if it is wrong.`,
      );
    }
  }
  return warnings;
}

/**
 * Import-time guard: compare each incoming campus's median street rate with
 * the same campus's median from the previous month already in the database.
 * Returns human-readable warnings for shifts of >= MEDIAN_SHIFT_FACTOR in
 * either direction (e.g. a monthly->daily unit change reads as ~1/30x).
 * Warn-only: a genuine repricing must still be importable.
 */
export async function computeStreetRateShiftWarnings(
  clientId: string,
  month: string,
  rows: IncomingRentRollRow[],
): Promise<string[]> {
  try {
    const prevMonth = previousMonthOf(month);
    const prevRes = await pool.query(
      `SELECT location, service_line, percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate) AS med
       FROM rent_roll_data
       WHERE client_id = $1 AND upload_month = $2 AND street_rate > 0 AND ${NOT_SECOND_OCCUPANT_SQL}
         AND NOT (service_line IN ('AL','AL/MC','SL','VIL') AND room_number ~* '/[B-Zb-z]$')
       GROUP BY 1, 2`,
      [clientId, prevMonth],
    );
    const prevMed = new Map<string, number>(
      prevRes.rows.map((r: any) => [`${r.location}||${r.service_line}`, Number(r.med)]),
    );
    return computeShiftWarningsFromMedians(rows, prevMed, month, prevMonth);
  } catch (err) {
    console.error("[streetRateQuality] shift-warning computation failed:", err);
    return [];
  }
}
