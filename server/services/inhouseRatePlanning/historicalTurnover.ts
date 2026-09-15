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
import { isPrivatePayer, privatePaySql } from "@shared/payerScope";
import { bBedExclusionSql, isBBedRow } from "@shared/bBed";
import { MOVE_IN_OUT_ACTIVE_VIEW } from "../moveInOutEventsView";
import {
  MODEL_MAX_TURNOVER_PCT,
  explainTurnoverOutOfBand,
  isTurnoverInBand,
  turnoverBandFor,
} from "@shared/turnoverBounds";

export interface ServiceLineTurnover {
  serviceLine: string;
  /**
   * Move-outs counted in the months this line actually covers.
   * For HC and HC/MC: private-pay only.
   * For all other lines: all payers, excluding bed-holds and companion positions.
   */
  moveOuts: number;
  /** Explicit move-out events present in the authoritative event feed. */
  explicitMoveOuts: number;
  /**
   * Conservative missing departures inferred from an occupied room whose
   * move-in date advances between consecutive monthly rent rolls, with no
   * same-room move-out event already recorded in that month.
   */
  inferredMoveOuts: number;
  /**
   * Average monthly occupied units across those months.
   * For HC and HC/MC: private-pay share only (matches the numerator).
   * For all other lines: all occupied units (physical unit basis).
   */
  avgOccupiedUnits: number;
  /** Average length of stay implied by the turnover rate, in months. 1200 / turnoverPct. */
  losMonths: number;
  /**
   * Whether the numerator and denominator are both restricted to private-pay.
   * True for HC and HC/MC; false for all other lines.
   */
  privatePayBasis: boolean;
  /** Share of occupied units that are private pay, 0-100. Relevant for HC/HC-MC. */
  privatePaySharePct: number;
  /**
   * Months of occupancy history backing this line, out of 12. A campus whose
   * history lags produces fewer, and the rate is annualised from what it has.
   */
  monthsCovered: number;
  /** Annualised move-outs over average occupied units, as a percent. */
  turnoverPct: number;
  /**
   * What the solver should actually plan with: {@link turnoverPct} capped at
   * the model's maximum. Identical to the measurement for every line that does
   * not saturate.
   */
  plannedPct: number;
  /**
   * True when the line genuinely turns over faster than the model can express
   * — the measurement is trusted, but a unit cannot re-let more than once per
   * year in the planning model, so {@link plannedPct} is a ceiling rather than
   * the measurement.
   *
   * Short-stay rehab is the real case: the Health Center measures well past
   * 300% because its residents stay weeks. Rejecting that as implausible sent
   * the page back to a typed guess for the largest line in the portfolio,
   * which is strictly worse than planning at the ceiling.
   */
  saturating: boolean;
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

/**
 * Payer scope for the move-out numerator, which is deliberately NOT uniform.
 *
 * HC / HC/MC: the private-pay filter is mandatory. Without it tens of thousands
 * of Medicare and Managed Care short-stay rehab discharges flood the numerator
 * (portfolio HC reads ~4,500% all-payer against ~281% private-pay-only). We
 * never set those rates, so replacing one of those residents moves no revenue.
 *
 * Every other line (AL, AL/MC, SL, VIL) counts all payers — their external-payer
 * volume is negligible and the filter would remove more signal than noise — but
 * two categories are still excluded because they are not turnover at all:
 *   - BEDHOLDS: the resident vacated temporarily, the bed was held, and they
 *     came back. No new resident moved in, so it is not the replacement event
 *     the solver models.
 *   - 2ND OCCUPANT / companion positions: the room stays occupied by the other
 *     resident, so no denominator capacity frees up.
 * Both keywords are matched case-insensitively, so "LEGACY - BEDHOLDS" and any
 * future variant are caught too.
 *
 * Exported so the tests assert against this exact predicate. A test that
 * hand-copies production SQL passes whichever way the two drift apart, which
 * makes it worse than no test.
 */
export function moveOutPayerScopeSql(alias?: string): string {
  const p = alias ? `${alias}.` : "";
  return `(
         (UPPER(${p}service_line) IN ('HC', 'HC/MC')     AND ${privatePaySql(`${p}payer`)})
         OR
         (UPPER(${p}service_line) NOT IN ('HC', 'HC/MC') AND ${p}payer NOT ILIKE '%BEDHOLD%'
                                                          AND ${p}payer NOT ILIKE '%2ND OCCUPANT%')
       )`;
}

export interface HistoricalTurnoverResult {
  /** First month of the measurement window, YYYY-MM. */
  windowStart: string;
  /** Last complete month of the measurement window, YYYY-MM. */
  windowEnd: string;
  monthsInWindow: number;
  /**
   * Occupied-room transitions skipped because at least one move-in date was
   * non-empty but malformed or in an unsupported format. This is capped so a
   * corrupt source file cannot turn a diagnostic into an oversized response.
   */
  invalidMoveInDateTransitions: number;
  byServiceLine: ServiceLineTurnover[];
}

const HISTORICAL_TURNOVER_CACHE_TTL_MS = 5 * 60 * 1000;
const historicalTurnoverCache = new Map<
  string,
  { expiresAt: number; value: HistoricalTurnoverResult | null }
>();
const historicalTurnoverInFlight = new Map<
  string,
  Promise<HistoricalTurnoverResult | null>
>();

function historicalTurnoverCacheKey(
  clientId: string,
  locationId: string | null,
  locationName: string | null,
): string {
  return `${clientId}\x1f${locationId ?? ""}\x1f${locationName ?? ""}`;
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
const MAX_INVALID_MOVE_IN_DATE_TRANSITIONS = 1000;

/**
 * Event rows use the admissions vocabulary, occupancy history uses the
 * pricing vocabulary. `IL` only ever appears at campuses whose history rows
 * carry `VIL` and never `IL`, so the two names denote the same service line.
 *
 * THE OTHER HALF OF THIS GAP IS NOT AN ALIAS
 * The memory-care lines are the reverse case: occupancy history and the rent
 * roll carry `HC/MC` and `AL/MC`, but the Export feed's "Service Line" column
 * names only the parent building, so their discharges sat inside `HC` and
 * `AL`. A rename cannot fix that — a line with a denominator and no numerator
 * of its own reports a turnover that belongs to something else. The fix
 * belongs upstream, where the event's DEPARTMENT still knows which
 * neighbourhood the resident was in: the importer maps each `* Legacy`
 * department to its memory-care line and a boot-time backfill re-derives
 * stored rows. So there are deliberately no `HC/MC` or `AL/MC` entries here,
 * and adding one would be wrong.
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
       (SELECT MAX(event_date) FROM ${MOVE_IN_OUT_ACTIVE_VIEW} WHERE client_id = $1) AS max_event_date,
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
 * Service lines whose turnover should be measured on a private-pay-only basis.
 *
 * HC and HC/MC carry thousands of short-stay Medicare and Managed Care rehab
 * discharges. Even after the private-pay filter their measured turnover sits at
 * ~540% — still above the 0-100% model limit, but without the filter it would
 * be ~4,500%. The filter strips the externally-priced population that we never
 * price and that therefore contributes nothing to revenue when replaced. Both
 * numerator and denominator must be on the same basis, so the denominator is
 * also scaled by the private-pay unit share.
 *
 * For every other line (AL, AL/MC, SL, VIL) the denominator is raw physical
 * units. Those lines have negligible Medicare/Managed Care volume, so counting
 * all move-outs gives a cleaner "fraction of beds that turned over" and avoids
 * the distortion from the payer-share approximation.
 */
const PRIVATE_PAY_ONLY_LINES = new Set(["HC", "HC/MC"]);

export const MASS_DEFAULT_ROOM_THRESHOLD = 25;
export const MASS_DEFAULT_LINE_SHARE = 0.05;

export interface MissingDepartureTransition {
  serviceLine: string;
  roomNumber: string;
  currentMonth: string;
  priorMonth: string;
  currentOccupied: boolean;
  priorOccupied: boolean;
  currentMoveInDate: string | null;
  priorMoveInDate: string | null;
  payorType: string | null;
  suspiciousDate: boolean;
  recordedDeparture: boolean;
}

export function isMassDefaultMoveInDate(sharedRooms: number, lineRooms: number): boolean {
  return (
    sharedRooms > MASS_DEFAULT_ROOM_THRESHOLD &&
    sharedRooms > lineRooms * MASS_DEFAULT_LINE_SHARE
  );
}

/**
 * The rent-roll sources currently provide either an ISO date or a US
 * month/day/year date. Do not use `new Date(value)` here: it accepts
 * browser/runtime-specific formats and normalizes impossible calendar dates.
 *
 * The returned value is canonical so callers can compare dates safely.
 */
export function parseSupportedMoveInDate(value: unknown): string | null {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return null;

  let year: number;
  let month: number;
  let day: number;
  let match: RegExpExecArray | null;

  if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw))) {
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  } else {
    return null;
  }

  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isMalformedMoveInDate(value: unknown): boolean {
  const raw = value == null ? "" : String(value).trim();
  return raw.length > 0 && parseSupportedMoveInDate(raw) === null;
}

export interface HistoricalMoveInDateRepairCandidate {
  sourceTable: "rent_roll_data" | "rent_roll_history";
  rowId: string;
  clientId: string;
  uploadMonth: string;
  locationId: string | null;
  location: string | null;
  roomNumber: string | null;
  serviceLine: string | null;
  occupied: boolean | null;
  sourceValue: string;
  originalSourceValue: string;
}

export interface HistoricalMoveInDateSourceSummary {
  sourceTable: "rent_roll_data" | "rent_roll_history";
  uploadMonth: string;
  sourceValue: string;
  rowCount: number;
}

export interface HistoricalMoveInDateRepairRequest {
  clientId: string;
  uploadMonth: string;
  repairs: Array<{ sourceValue: string; replacementDate: string }>;
  dryRun?: boolean;
  confirmed?: boolean;
  repairedBy?: string | null;
}

export interface HistoricalMoveInDateRepairResult {
  clientId: string;
  uploadMonth: string;
  dryRun: boolean;
  candidates: HistoricalMoveInDateRepairCandidate[];
  updatedRows: number;
  updatedBySource: Array<{
    sourceValue: string;
    replacementDate: string;
    candidateRows: number;
    updatedRows: number;
  }>;
}

const HISTORICAL_RENT_ROLL_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

function validateHistoricalRepairScope(clientId: string, uploadMonth: string): void {
  if (!clientId.trim()) throw new Error("clientId is required");
  if (!HISTORICAL_RENT_ROLL_MONTH.test(uploadMonth)) {
    throw new Error("uploadMonth must use YYYY-MM format");
  }
}

function normalizeRepairMappings(
  repairs: Array<{ sourceValue: string; replacementDate: string }>,
): Array<{ sourceValue: string; replacementDate: string }> {
  if (!Array.isArray(repairs) || repairs.length === 0) {
    throw new Error("At least one sourceValue and replacementDate mapping is required");
  }
  const seen = new Set<string>();
  return repairs.map((repair) => {
    const sourceValue = String(repair?.sourceValue ?? "").trim();
    const replacementDate = String(repair?.replacementDate ?? "").trim();
    if (!sourceValue) throw new Error("sourceValue cannot be empty");
    if (!isMalformedMoveInDate(sourceValue)) {
      throw new Error(`sourceValue is not a malformed stored date: ${sourceValue}`);
    }
    if (!parseSupportedMoveInDate(replacementDate) || !/^\d{4}-\d{2}-\d{2}$/.test(replacementDate)) {
      throw new Error(`replacementDate must be a real ISO date (YYYY-MM-DD): ${replacementDate}`);
    }
    if (seen.has(sourceValue)) throw new Error(`Duplicate sourceValue mapping: ${sourceValue}`);
    seen.add(sourceValue);
    return { sourceValue, replacementDate };
  });
}

async function findHistoricalMoveInDateCandidates(
  clientId: string,
  uploadMonth: string,
  sourceValues?: string[],
): Promise<HistoricalMoveInDateRepairCandidate[]> {
  validateHistoricalRepairScope(clientId, uploadMonth);
  const sourceFilter = sourceValues?.length
    ? `AND BTRIM(move_in_date) = ANY($3::text[])`
    : "";
  const params: unknown[] = [clientId, uploadMonth];
  if (sourceValues?.length) params.push(sourceValues);
  const result = await pool.query<{
    source_table: "rent_roll_data" | "rent_roll_history";
    row_id: string;
    upload_month: string;
    location_id: string | null;
    location: string | null;
    room_number: string | null;
    service_line: string | null;
    occupied: boolean | null;
    source_value: string;
    original_source_value: string | null;
  }>(
    `
      SELECT source_table, row_id, upload_month, location_id, location,
             room_number, service_line, occupied, source_value,
             original_source_value
        FROM (
          SELECT 'rent_roll_data'::text AS source_table,
                 rr.id::text AS row_id,
                 rr.upload_month,
                 rr.location_id,
                 rr.location,
                 rr.room_number,
                 rr.service_line,
                 rr.occupied_yn AS occupied,
                 rr.move_in_date AS source_value,
                 rr.move_in_date_source AS original_source_value
            FROM rent_roll_data rr
           WHERE rr.client_id = $1
             AND rr.upload_month = $2
             AND rr.move_in_date IS NOT NULL
             AND BTRIM(rr.move_in_date) <> ''
             ${sourceFilter.replaceAll("move_in_date", "rr.move_in_date")}
          UNION ALL
          SELECT 'rent_roll_history'::text AS source_table,
                 rh.id::text AS row_id,
                 rh.upload_month,
                 rh.location_id,
                 rh.location,
                 rh.room_number,
                 rh.service_line,
                 rh.occupied_yn AS occupied,
                 rh.move_in_date AS source_value,
                 rh.move_in_date_source AS original_source_value
            FROM rent_roll_history rh
            JOIN locations l ON l.id = rh.location_id
           WHERE l.client_id = $1
             AND rh.upload_month = $2
             AND rh.move_in_date IS NOT NULL
             AND BTRIM(rh.move_in_date) <> ''
             ${sourceFilter.replaceAll("move_in_date", "rh.move_in_date")}
        ) stored
       WHERE source_value IS NOT NULL
    `,
    params,
  );
  return result.rows
    .filter((row) => isMalformedMoveInDate(row.source_value))
    .map((row) => ({
      sourceTable: row.source_table,
      rowId: row.row_id,
      clientId,
      uploadMonth: row.upload_month,
      locationId: row.location_id,
      location: row.location,
      roomNumber: row.room_number,
      serviceLine: row.service_line,
      occupied: row.occupied,
      sourceValue: row.source_value.trim(),
      originalSourceValue: row.original_source_value ?? row.source_value,
    }));
}

export async function listHistoricalMoveInDateSources(
  clientId: string,
  uploadMonth?: string,
): Promise<HistoricalMoveInDateSourceSummary[]> {
  if (!clientId.trim()) throw new Error("clientId is required");
  if (uploadMonth !== undefined) validateHistoricalRepairScope(clientId, uploadMonth);
  const result = await pool.query<{
    source_table: "rent_roll_data" | "rent_roll_history";
    upload_month: string;
    source_value: string;
    row_count: string | number;
  }>(
    `
      SELECT source_table, upload_month, source_value, COUNT(*)::int AS row_count
        FROM (
          SELECT 'rent_roll_data'::text AS source_table, rr.upload_month,
                 BTRIM(rr.move_in_date) AS source_value
            FROM rent_roll_data rr
           WHERE rr.client_id = $1
             AND rr.move_in_date IS NOT NULL
             AND BTRIM(rr.move_in_date) <> ''
             ${uploadMonth === undefined ? "" : "AND rr.upload_month = $2"}
          UNION ALL
          SELECT 'rent_roll_history'::text AS source_table, rh.upload_month,
                 BTRIM(rh.move_in_date) AS source_value
            FROM rent_roll_history rh
            JOIN locations l ON l.id = rh.location_id
           WHERE l.client_id = $1
             AND rh.move_in_date IS NOT NULL
             AND BTRIM(rh.move_in_date) <> ''
             ${uploadMonth === undefined ? "" : "AND rh.upload_month = $2"}
        ) stored
       GROUP BY source_table, upload_month, source_value
       ORDER BY upload_month DESC, source_table, source_value
    `,
    uploadMonth === undefined ? [clientId] : [clientId, uploadMonth],
  );
  return result.rows
    .filter((row) => isMalformedMoveInDate(row.source_value))
    .map((row) => ({
      sourceTable: row.source_table,
      uploadMonth: row.upload_month,
      sourceValue: row.source_value,
      rowCount: Number(row.row_count),
    }));
}

/**
 * Preview or apply an explicitly mapped repair for malformed historical dates.
 * Applying is deliberately opt-in and transactional. The original source is
 * written to move_in_date_source and to the append-only repair audit table.
 */
export async function repairHistoricalMoveInDates(
  request: HistoricalMoveInDateRepairRequest,
): Promise<HistoricalMoveInDateRepairResult> {
  validateHistoricalRepairScope(request.clientId, request.uploadMonth);
  const mappings = normalizeRepairMappings(request.repairs);
  const dryRun = request.dryRun !== false;
  if (!dryRun && request.confirmed !== true) {
    throw new Error("A confirmed repair request is required before values are changed");
  }

  const candidates = await findHistoricalMoveInDateCandidates(
    request.clientId,
    request.uploadMonth,
    mappings.map((mapping) => mapping.sourceValue),
  );
  const bySource = new Map(mappings.map((mapping) => [mapping.sourceValue, mapping]));
  const updatedBySource = mappings.map((mapping) => ({
    sourceValue: mapping.sourceValue,
    replacementDate: mapping.replacementDate,
    candidateRows: candidates.filter((candidate) => candidate.sourceValue === mapping.sourceValue).length,
    updatedRows: 0,
  }));
  if (dryRun || candidates.length === 0) {
    return {
      clientId: request.clientId,
      uploadMonth: request.uploadMonth,
      dryRun,
      candidates,
      updatedRows: 0,
      updatedBySource,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const auditValues: unknown[] = [];
    const valuePlaceholders: string[] = [];
    for (const candidate of candidates) {
      const mapping = bySource.get(candidate.sourceValue);
      if (!mapping) continue;
      const offset = auditValues.length;
      auditValues.push(
        request.clientId,
        request.uploadMonth,
        candidate.sourceTable,
        candidate.rowId,
        candidate.location,
        candidate.roomNumber,
        candidate.serviceLine,
        candidate.originalSourceValue || candidate.sourceValue,
        mapping.replacementDate,
        request.repairedBy ?? null,
      );
      valuePlaceholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, ` +
        `$${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, ` +
        `$${offset + 9}, $${offset + 10})`,
      );
    }
    if (valuePlaceholders.length) {
      await client.query(
        `INSERT INTO rent_roll_move_in_date_repairs
          (client_id, upload_month, source_table, source_row_id, location,
           room_number, service_line, source_value, repaired_value, repaired_by)
         VALUES ${valuePlaceholders.join(", ")}`,
        auditValues,
      );
    }

    for (const mapping of mappings) {
      const candidateIds = candidates
        .filter((candidate) => candidate.sourceValue === mapping.sourceValue)
        .map((candidate) => candidate.rowId);
      const dataMappingIds = candidates
        .filter((candidate) => candidate.sourceTable === "rent_roll_data" && candidate.sourceValue === mapping.sourceValue)
        .map((candidate) => candidate.rowId);
      const historyMappingIds = candidates
        .filter((candidate) => candidate.sourceTable === "rent_roll_history" && candidate.sourceValue === mapping.sourceValue)
        .map((candidate) => candidate.rowId);
      if (dataMappingIds.length) {
        await client.query(
          `UPDATE rent_roll_data
              SET move_in_date_source = COALESCE(move_in_date_source, move_in_date),
                  move_in_date = $1
            WHERE client_id = $2 AND upload_month = $3 AND id = ANY($4::varchar[])`,
          [mapping.replacementDate, request.clientId, request.uploadMonth, dataMappingIds],
        );
      }
      if (historyMappingIds.length) {
        await client.query(
          `UPDATE rent_roll_history rh
              SET move_in_date_source = COALESCE(rh.move_in_date_source, rh.move_in_date),
                  move_in_date = $1
            FROM locations l
           WHERE rh.id = ANY($2::varchar[])
             AND rh.upload_month = $3
             AND l.id = rh.location_id
             AND l.client_id = $4`,
          [mapping.replacementDate, historyMappingIds, request.uploadMonth, request.clientId],
        );
      }
      const sourceResult = updatedBySource.find((entry) => entry.sourceValue === mapping.sourceValue);
      if (sourceResult) sourceResult.updatedRows = candidateIds.length;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    clientId: request.clientId,
    uploadMonth: request.uploadMonth,
    dryRun: false,
    candidates,
    updatedRows: candidates.length,
    updatedBySource,
  };
}

function monthStart(month: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

function isDateInTransitionInterval(
  moveInDate: string,
  priorMonth: string,
  currentMonth: string,
): boolean {
  const priorStart = monthStart(priorMonth);
  const currentStart = monthStart(currentMonth);
  if (!priorStart || !currentStart) return false;
  const nextMonthStart = new Date(
    Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() + 1, 1),
  );
  const canonical = parseSupportedMoveInDate(moveInDate);
  if (!canonical) return false;
  const moveIn = new Date(`${canonical}T00:00:00Z`);
  return moveIn > priorStart && moveIn < nextMonthStart;
}

function isConsecutiveMonth(priorMonth: string, currentMonth: string): boolean {
  const priorStart = monthStart(priorMonth);
  const currentStart = monthStart(currentMonth);
  if (!priorStart || !currentStart) return false;
  const expectedCurrent = new Date(
    Date.UTC(priorStart.getUTCFullYear(), priorStart.getUTCMonth() + 1, 1),
  );
  return expectedCurrent.getTime() === currentStart.getTime();
}

export function shouldInferMissingDeparture(
  transition: MissingDepartureTransition,
): boolean {
  const currentSl = transition.serviceLine.trim().toUpperCase();
  if (!transition.currentOccupied || !transition.priorOccupied) return false;
  if (!transition.currentMoveInDate || !transition.priorMoveInDate) return false;
  const currentMoveInDate = parseSupportedMoveInDate(transition.currentMoveInDate);
  const priorMoveInDate = parseSupportedMoveInDate(transition.priorMoveInDate);
  if (!currentMoveInDate || !priorMoveInDate) return false;
  if (!isConsecutiveMonth(transition.priorMonth, transition.currentMonth)) return false;
  if (currentMoveInDate <= priorMoveInDate) return false;
  if (
    !isDateInTransitionInterval(
      currentMoveInDate,
      transition.priorMonth,
      transition.currentMonth,
    )
  ) {
    return false;
  }
  if (transition.suspiciousDate || transition.recordedDeparture) return false;
  if (isBBedRow(currentSl, transition.roomNumber)) return false;
  if (currentSl === "HC" || currentSl === "HC/MC") {
    return isPrivatePayer(transition.payorType);
  }
  return (
    !(transition.payorType ?? "").toUpperCase().includes("BEDHOLD") &&
    !(transition.payorType ?? "").toUpperCase().includes("2ND OCCUPANT")
  );
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
  const key = historicalTurnoverCacheKey(clientId, locationId, locationName);
  const cached = historicalTurnoverCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const inFlight = historicalTurnoverInFlight.get(key);
  if (inFlight) return inFlight;

  const request = computeHistoricalTurnoverUncached(clientId, locationId, locationName)
    .then((value) => {
      historicalTurnoverCache.set(key, {
        expiresAt: Date.now() + HISTORICAL_TURNOVER_CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      historicalTurnoverInFlight.delete(key);
    });
  historicalTurnoverInFlight.set(key, request);
  return request;
}

async function computeHistoricalTurnoverUncached(
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

  // Move-outs, kept per month so the numerator can be restricted to the months
  // the denominator can actually cover.
  //
  // PAYER FILTER IS CONDITIONAL BY LINE
  //
  // HC / HC/MC: private-pay filter is mandatory. Without it tens of thousands
  // of Medicare and Managed Care short-stay rehab discharges flood the numerator
  // (portfolio HC reads 4,500% all-payer vs ~540% private-pay-only).
  //
  // All other lines: count all move-outs on a unit-turnover basis, EXCEPT:
  //   - BEDHOLDS: the resident temporarily vacated but the bed was held and
  //     they returned. No new resident moved in, so it is not the replacement
  //     event the solver models. This is the main source of inflated AL
  //     turnover (688 bedhold events in one trailing-year window).
  //   - 2ND OCCUPANT / companion positions: a companion departure is not a
  //     primary-unit turnover; the room continues to be occupied by the other
  //     resident. Counting it inflates the numerator without any corresponding
  //     denominator capacity freeing up.
  //
  // The filter itself lives in `moveOutPayerScopeSql` so the tests can assert
  // against the same predicate the measurement uses rather than a hand-copied
  // twin that drifts the moment either is edited.
  //
  // TWO FEEDS REPORT THE SAME DISCHARGES, SO ONE HAS TO WIN
  //
  // A bed-hold and a companion departure are the same RESIDENT counted wrongly;
  // the duplicate imports are the same EVENT stored twice. The table holds an
  // older numeric-department import layered under a newer "Export" one, and
  // where both cover a campus-month they report the same discharges. Worse, the
  // numeric feed cannot tell a memory-care neighbourhood from its parent
  // building, so its copy of an AL/MC discharge arrives labelled AL. Deferring
  // to the Export feed for any campus-month it covers is what makes each
  // discharge count once and lets AL/MC keep the ones that are its own.
  //
  // That rule is not applied here. It is applied once, for everybody, by
  // `move_in_out_events_active` — turnover is not the only consumer that was
  // double-counting (monthly move-in series and T3 move-ins per month, which
  // scales every rule's projected revenue impact, read the same rows), and a
  // predicate each query has to remember to repeat is a predicate the next
  // query will forget. Read the view; never the base table.
  const moveOutSql = `
    SELECT e.service_line AS sl, substring(e.event_date, 1, 7) AS m, COUNT(*)::int AS n
      FROM ${MOVE_IN_OUT_ACTIVE_VIEW} e
     WHERE e.client_id = $1
       AND e.event_type = 'move_out'
       AND e.counted = true
       AND substring(e.event_date, 1, 7) BETWEEN $2 AND $3
       AND ${moveOutPayerScopeSql("e")}
       ${locationName ? "AND e.location = $4" : ""}
     GROUP BY 1, 2`;

  // Some permanent departures are absent from the discharge feed. The rent
  // roll cannot identify the departed resident for this tenant, but it does
  // carry move-in date on nearly every occupied row. Treat a room as replaced
  // only when it is occupied in consecutive monthly snapshots and its move-in
  // date advances into that exact interval. This does not count vacancy fills,
  // newly opened rooms, or a static date repeated across uploads.
  //
  // A source conversion once stamped the same move-in date on hundreds of
  // rooms. `suspicious_dates` rejects any line/date shared by more than both 25
  // rooms and 5% of the line's physical rooms. A real portfolio does not move
  // that many residents into one service line on one day.
  const rentRollCte = `
    WITH rent_roll_parsed AS MATERIALIZED (
      SELECT rr.location,
             UPPER(rr.service_line) AS sl,
             BTRIM(rr.room_number) AS room_number,
             rr.upload_month AS m,
             rr.occupied_yn,
             rr.payor_type,
             rr.in_house_rate,
             BTRIM(rr.move_in_date) AS move_in_date_raw,
             CASE
               WHEN BTRIM(rr.move_in_date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                 CASE
                   WHEN SUBSTRING(BTRIM(rr.move_in_date) FROM 1 FOR 4)::int
                        BETWEEN 1 AND 9999 THEN
                     CASE
                       WHEN SUBSTRING(BTRIM(rr.move_in_date) FROM 6 FOR 2)::int
                            BETWEEN 1 AND 12 THEN
                         CASE
                           WHEN SUBSTRING(BTRIM(rr.move_in_date) FROM 9 FOR 2)::int
                                BETWEEN 1 AND EXTRACT(
                                  DAY FROM (
                                    MAKE_DATE(
                                      SUBSTRING(BTRIM(rr.move_in_date) FROM 1 FOR 4)::int,
                                      SUBSTRING(BTRIM(rr.move_in_date) FROM 6 FOR 2)::int,
                                      1
                                    ) + INTERVAL '1 month' - INTERVAL '1 day'
                                  )
                                )
                             THEN MAKE_DATE(
                               SUBSTRING(BTRIM(rr.move_in_date) FROM 1 FOR 4)::int,
                               SUBSTRING(BTRIM(rr.move_in_date) FROM 6 FOR 2)::int,
                               SUBSTRING(BTRIM(rr.move_in_date) FROM 9 FOR 2)::int
                             )
                         END
                     END
                 END
               WHEN BTRIM(rr.move_in_date) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN
                 CASE
                   WHEN SPLIT_PART(BTRIM(rr.move_in_date), '/', 3)::int
                        BETWEEN 1 AND 9999 THEN
                     CASE
                       WHEN SPLIT_PART(BTRIM(rr.move_in_date), '/', 1)::int
                            BETWEEN 1 AND 12 THEN
                         CASE
                           WHEN SPLIT_PART(BTRIM(rr.move_in_date), '/', 2)::int
                                BETWEEN 1 AND EXTRACT(
                                  DAY FROM (
                                    MAKE_DATE(
                                      SPLIT_PART(BTRIM(rr.move_in_date), '/', 3)::int,
                                      SPLIT_PART(BTRIM(rr.move_in_date), '/', 1)::int,
                                      1
                                    ) + INTERVAL '1 month' - INTERVAL '1 day'
                                  )
                                )
                             THEN MAKE_DATE(
                               SPLIT_PART(BTRIM(rr.move_in_date), '/', 3)::int,
                               SPLIT_PART(BTRIM(rr.move_in_date), '/', 1)::int,
                               SPLIT_PART(BTRIM(rr.move_in_date), '/', 2)::int
                             )
                         END
                     END
                 END
             END AS move_in_date
        FROM rent_roll_data rr
       WHERE rr.client_id = $1
         AND rr.upload_month BETWEEN
             to_char(to_date($2, 'YYYY-MM') - interval '1 month', 'YYYY-MM')
             AND $3
         AND rr.room_number IS NOT NULL
         AND ${bBedExclusionSql("rr.")}
         ${locationName ? "AND rr.location = $4" : ""}
    ),
    rent_roll AS MATERIALIZED (
      SELECT DISTINCT ON (location, sl, room_number, m)
             location, sl, room_number, m, occupied_yn, payor_type,
             in_house_rate, move_in_date_raw, move_in_date
        FROM rent_roll_parsed
       ORDER BY location, sl, room_number, m,
                occupied_yn DESC,
                (move_in_date IS NOT NULL) DESC,
                move_in_date DESC NULLS LAST,
                (in_house_rate IS NOT NULL) DESC
    ),
    line_room_counts AS (
      SELECT sl, COUNT(DISTINCT location || '|' || room_number)::float AS rooms
        FROM rent_roll
       GROUP BY sl
    ),
    suspicious_dates AS (
      SELECT r.sl, r.move_in_date
        FROM rent_roll r
        JOIN line_room_counts c USING (sl)
       WHERE r.move_in_date IS NOT NULL
       GROUP BY r.sl, r.move_in_date, c.rooms
      HAVING COUNT(DISTINCT r.location || '|' || r.room_number) > ${MASS_DEFAULT_ROOM_THRESHOLD}
         AND COUNT(DISTINCT r.location || '|' || r.room_number) > c.rooms * ${MASS_DEFAULT_LINE_SHARE}
    ),
    explicit_out_rooms AS (
      SELECT DISTINCT e.location,
             UPPER(e.service_line) AS sl,
             BTRIM(e.room_name) AS room_number,
             substring(e.event_date, 1, 7) AS m
        FROM ${MOVE_IN_OUT_ACTIVE_VIEW} e
       WHERE e.client_id = $1
         AND e.event_type = 'move_out'
         AND e.counted = true
         AND substring(e.event_date, 1, 7) BETWEEN $2 AND $3
         AND e.room_name IS NOT NULL
         AND ${moveOutPayerScopeSql("e")}
         ${locationName ? "AND e.location = $4" : ""}
    ),
    missing_room_months AS (
      SELECT current.sl,
             current.m,
             current.location,
             current.room_number,
             current.occupied_yn AS current_occupied,
             prior.occupied_yn AS prior_occupied,
             current.payor_type,
             to_char(current.move_in_date, 'YYYY-MM-DD') AS current_move_in_date,
             to_char(prior.move_in_date, 'YYYY-MM-DD') AS prior_move_in_date,
             (
               (current.move_in_date_raw IS NOT NULL AND current.move_in_date_raw <> ''
                AND current.move_in_date IS NULL)
               OR
               (prior.move_in_date_raw IS NOT NULL AND prior.move_in_date_raw <> ''
                AND prior.move_in_date IS NULL)
             ) AS invalid_move_in_date,
             bad.move_in_date IS NOT NULL AS suspicious_date,
             o.room_number IS NOT NULL AS recorded_departure,
             prior.m AS prior_m
        FROM rent_roll current
        JOIN rent_roll prior
          ON prior.location = current.location
         AND prior.sl = current.sl
         AND prior.room_number = current.room_number
         AND to_date(prior.m, 'YYYY-MM') =
             to_date(current.m, 'YYYY-MM') - interval '1 month'
        LEFT JOIN suspicious_dates bad
          ON bad.sl = current.sl
         AND bad.move_in_date = current.move_in_date
        LEFT JOIN explicit_out_rooms o
          ON o.location = current.location
         AND o.sl = current.sl
         AND o.m = current.m
         AND o.room_number = current.room_number
       WHERE current.occupied_yn = true
         AND prior.occupied_yn = true
         AND (
           (current.move_in_date_raw IS NOT NULL AND current.move_in_date_raw <> ''
            AND current.move_in_date IS NULL)
           OR
           (prior.move_in_date_raw IS NOT NULL AND prior.move_in_date_raw <> ''
            AND prior.move_in_date IS NULL)
           OR (
             current.move_in_date IS NOT NULL
             AND prior.move_in_date IS NOT NULL
             AND current.move_in_date > prior.move_in_date
             AND current.move_in_date > to_date(prior.m, 'YYYY-MM')
             AND current.move_in_date <
                 to_date(current.m, 'YYYY-MM') + interval '1 month'
           )
         )
    )`;

  // The malformed-date diagnostic is derived from the same transition rows as
  // inference. Keeping it as a second query used to parse and sort the entire
  // rent roll a second time, which dominated the portfolio request on large
  // clients. The invalid transition CTE is still capped exactly as before;
  // it now shares the materialized rent_roll and consecutive-month join with
  // the inferred departure result.
  const inferredMoveOutSql = `
    ${rentRollCte},
    invalid_move_in_date_transitions AS (
      SELECT 1
        FROM rent_roll current
        JOIN rent_roll prior
          ON prior.location = current.location
         AND prior.sl = current.sl
         AND prior.room_number = current.room_number
         AND to_date(prior.m, 'YYYY-MM') =
             to_date(current.m, 'YYYY-MM') - interval '1 month'
       WHERE current.occupied_yn = true
         AND prior.occupied_yn = true
         AND (
           (current.move_in_date_raw IS NOT NULL AND current.move_in_date_raw <> ''
            AND current.move_in_date IS NULL)
           OR
           (prior.move_in_date_raw IS NOT NULL AND prior.move_in_date_raw <> ''
            AND prior.move_in_date IS NULL)
         )
       LIMIT ${MAX_INVALID_MOVE_IN_DATE_TRANSITIONS}
    )
    SELECT missing_room_months.*,
           (SELECT COUNT(*)::int FROM invalid_move_in_date_transitions)
             AS invalid_move_in_date_transitions
      FROM missing_room_months`;

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

  const inferredParams: any[] = locationName
    ? [clientId, windowStart, windowEnd, locationName]
    : [clientId, windowStart, windowEnd];
  const [moveOutRes, inferredMoveOutRes, occRes, shareRes] = await Promise.all([
    pool.query(moveOutSql, eventParams),
    pool.query(inferredMoveOutSql, inferredParams),
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
  const invalidMoveInDateTransitions = Math.min(
    Number(inferredMoveOutRes.rows[0]?.invalid_move_in_date_transitions ?? 0),
    MAX_INVALID_MOVE_IN_DATE_TRANSITIONS,
  );
  if (invalidMoveInDateTransitions > 0) {
    console.warn(
      `[historical-turnover] skipped ${invalidMoveInDateTransitions} occupied-room transition(s) with malformed or unsupported move-in dates ` +
      `(client=${clientId}, window=${windowStart}..${windowEnd})`,
    );
  }

  const inferredBySlMonth = new Map<string, Map<string, number>>();
  for (const r of inferredMoveOutRes.rows) {
    if (r.invalid_move_in_date) continue;
    if (
      !shouldInferMissingDeparture({
        serviceLine: r.sl,
        roomNumber: r.room_number,
        currentMonth: r.m,
        priorMonth: r.prior_m,
        currentOccupied: r.current_occupied,
        priorOccupied: r.prior_occupied,
        currentMoveInDate: r.current_move_in_date,
        priorMoveInDate: r.prior_move_in_date,
        payorType: r.payor_type,
        suspiciousDate: r.suspicious_date,
        recordedDeparture: r.recorded_departure,
      })
    ) {
      continue;
    }
    const sl = normalizeEventSl(r.sl);
    if (!sl) continue;
    let byMonth = inferredBySlMonth.get(sl);
    if (!byMonth) {
      byMonth = new Map();
      inferredBySlMonth.set(sl, byMonth);
    }
    byMonth.set(r.m, (byMonth.get(r.m) ?? 0) + 1);
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
    const ppBasis = PRIVATE_PAY_ONLY_LINES.has(sl);
    const share = shareBySl.get(sl);

    // HC and HC/MC must have a private-pay share so the denominator can be
    // scaled to match the private-pay numerator. Other lines use physical units
    // (all-payer occ_units) as denominator and do not need the share.
    if (ppBasis && share === undefined) continue;

    const months = Array.from(occMonths.keys()).filter((m) => (occMonths.get(m) ?? 0) > 0);
    const monthsCovered = months.length;
    if (monthsCovered === 0) continue;

    const avgOccAll =
      months.reduce((s, m) => s + (occMonths.get(m) ?? 0), 0) / monthsCovered;

    // Denominator basis:
    //   HC / HC/MC → private-pay units, so numerator and denominator match
    //   all other lines → physical occupied units (all-payer)
    const avgOcc = ppBasis ? avgOccAll * (share as number) : avgOccAll;
    if (avgOcc <= 0) continue;

    // Count move-outs ONLY in the months occupancy can account for, then
    // annualise from that. Pairing a full year of move-outs with an average
    // over the four months a campus happens to have reports a turnover far
    // above anything that happened, and reports it as a 12-month measure.
    const byMonth = moveOutsBySlMonth.get(sl);
    const inferredByMonth = inferredBySlMonth.get(sl);
    const explicitMoveOuts = months.reduce((s, m) => s + (byMonth?.get(m) ?? 0), 0);
    const inferredMoveOuts = months.reduce((s, m) => s + (inferredByMonth?.get(m) ?? 0), 0);
    const moveOuts = explicitMoveOuts + inferredMoveOuts;
    const annualisedMoveOuts = (moveOuts / monthsCovered) * monthsInWindow;
    const turnoverPct = (annualisedMoveOuts / avgOcc) * 100;

    // Judge the rounded figure, so the badge never contradicts the number
    // printed beside it (an 85.04% against an 85% ceiling reads as a bug).
    const rounded = Math.round(turnoverPct * 10) / 10;
    const band = turnoverBandFor(sl);
    // A line whose band reaches the model's ceiling is one we already accept
    // as very fast, so a measurement ABOVE that ceiling is confirmation, not
    // contradiction — the only thing it tells us is that the model's maximum
    // binds. Lines whose band stops short (assisted living, the villas) get no
    // such reprieve: for them an over-ceiling figure really is out of band.
    const saturating =
      rounded > MODEL_MAX_TURNOVER_PCT && band.max >= MODEL_MAX_TURNOVER_PCT;
    const inBand = saturating || isTurnoverInBand(sl, rounded);
    const thinCoverage =
      monthsCovered < MIN_MONTHS_COVERED
        ? `Only ${monthsCovered} month${monthsCovered === 1 ? "" : "s"} of occupancy history — too few to annualise from.`
        : null;

    out.push({
      serviceLine: sl,
      moveOuts,
      explicitMoveOuts,
      inferredMoveOuts,
      // Keep one decimal so the denominator shown to operators reconciles to
      // the reported turnover and implied LOS instead of hiding material
      // differences at small campuses behind whole-unit rounding.
      avgOccupiedUnits: Math.round(avgOcc * 10) / 10,
      privatePayBasis: ppBasis,
      privatePaySharePct: share !== undefined ? Math.round(share * 1000) / 10 : 0,
      monthsCovered,
      turnoverPct: rounded,
      // The cap applies to what we PLAN with, not to what we measured or to
      // the stay length we report — those stay faithful to the data.
      plannedPct: Math.min(rounded, MODEL_MAX_TURNOVER_PCT),
      saturating,
      // 1200 = 12 months × 100 (to convert pct to fraction). Rounded to one
      // decimal so it matches the rounding applied to turnoverPct itself.
      losMonths: Math.round((1200 / rounded) * 10) / 10,
      plausible: inBand && thinCoverage === null,
      bandMin: band.min,
      bandMax: band.max,
      // Coverage is reported first: with only a few months behind it the
      // percent itself is not yet evidence of anything, in band or out.
      // A saturating line is in band by construction, so it has no reason.
      outOfBandReason:
        thinCoverage ?? (saturating ? null : explainTurnoverOutOfBand(sl, rounded)),
    });
  }

  out.sort((a, b) => a.serviceLine.localeCompare(b.serviceLine));
  return {
    windowStart,
    windowEnd,
    monthsInWindow,
    invalidMoveInDateTransitions,
    byServiceLine: out,
  };
}
