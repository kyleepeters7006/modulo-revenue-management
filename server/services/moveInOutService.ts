import * as XLSX from "xlsx";
import { isPrivatePayer, privatePaySql } from "@shared/payerScope";
import { pool } from "../db";
import { normalizeRoomType } from "@shared/roomTypes";
import {
  MOVE_IN_OUT_ACTIVE_VIEW,
  backfillEventImportFormats,
  importFormatForCensusId,
  resolveOverlappingEventImports,
} from "./moveInOutEventsView";

// ── Move-In / Move-Out event import + monthly count accessors ────────────────
// Authoritative event-level source for monthly move-in / move-out counts,
// imported from the "Move Ins & Outs Detail" workbook (Admissions +
// Discharges sheets). Counting rules:
//   • Move-in counted  = Census_Event 'Admission' (returns from hospital
//     leave are stored but NOT counted as new move-ins)
//   • Move-out counted = the resident permanently released the unit: a
//     'Discharge - Return Not Anticipated' or a death. Hospital leaves,
//     therapeutic leaves and return-expected discharges are stored but NOT
//     counted, because the resident keeps both the unit and their rate.
// All rows are stored with a `counted` flag so raw data stays queryable.
//
// Deaths are the reason this is a predicate and not a string comparison: both
// workbook shapes leave the discharge category BLANK when the resident died
// and name the event elsewhere, so a rule keyed on the category alone silently
// dropped them. That was 29% of Assisted Living departures.

/**
 * Department → service-line code.
 *
 * THE `* LEGACY` DEPARTMENTS ARE THE MEMORY-CARE NEIGHBOURHOODS
 * `Legacy` is this client's brand for a memory-care neighbourhood, and the
 * department is the ONLY place those discharges are identifiable in the event
 * feed. Without these entries the department falls through to the "Service
 * Line" column, which names the whole building — "Health Center" for
 * `HC Legacy`, "Assisted Living" for `AL Legacy` — so every memory-care
 * discharge was stored as plain `HC` or plain `AL`. Occupancy history and the
 * rent roll both carry `HC/MC` and `AL/MC` as service lines of their own, so
 * each was left with a denominator and a numerator that belonged to its
 * parent.
 *
 * Neither mapping is a guess. Joining the event's `room_name` to the rent
 * roll's `room_number` at the same campus:
 *   • 987 of 1,038 counted `HC Legacy` move-outs land in a room the rent roll
 *     classifies HC/MC; 2 land in an HC-only room.
 *   • 1,808 of 1,854 counted `AL Legacy` move-outs land in an AL/MC-only room
 *     and every one of the remainder is in a room AL/MC has also carried; not
 *     one lands in an AL-only room. All 94 campuses filing `AL Legacy`
 *     discharges report AL/MC occupancy.
 *
 * `24-A/I` IS SENIOR LIVING, NOT MEMORY CARE
 * It reads like an Alzheimer's unit and was mapped to `AL/MC`, which gave
 * assisted-living memory care a numerator drawn entirely from a different
 * service line — 14% measured annual turnover, i.e. a seven-year memory-care
 * stay. It is in fact the legacy feed's name for the line the Export feed
 * calls `SL`:
 *   • every one of its 342 counted move-outs lands in a room the rent roll
 *     classifies SL, and none in an AL/MC room — including at the 13 campuses
 *     that do have AL/MC rooms;
 *   • all 22 campuses filing it also file Export-feed `SL`, and none file it
 *     without;
 *   • month by month its counts track Export `SL` almost exactly (21/20,
 *     10/10, 7/7, 42/44, 19/19, …).
 *
 * The legacy feed has no memory-care department for assisted living at all —
 * its `02-AL` mixes the two, with ~1,120 of its move-outs in AL/MC rooms. That
 * is not a mapping problem but a duplication one: see {@link LEGACY_FEED_DEPTS}.
 */
export const DEPT_TO_SERVICE_LINE: Record<string, string> = {
  "01-HCC": "HC",
  "02-AL": "AL",
  "03-VIL": "VIL",
  "24-A/I": "SL",
  "HC LEGACY": "HC/MC",
  "AL LEGACY": "AL/MC",
};

/**
 * Departments belonging to the older numeric feed.
 *
 * This client's event table holds two overlapping imports of the same
 * discharges. The numeric feed (`01-HCC`, `02-AL`, `03-VIL`, `24-A/I`) covers
 * 2025-01 onward; the newer "Export" feed (`HC`, `HC Legacy`, `AL`,
 * `AL Legacy`, `SL`, `IL`) covers 2024-01 onward and runs a month ahead. Where
 * both cover a campus-month they report the same discharges, so any count
 * spanning the two is inflated — `01-HCC` ≈ `HC` + `HC Legacy`, `02-AL` ≈ `AL`
 * + `AL Legacy`, `24-A/I` ≈ `SL`.
 *
 * The Export feed wins that tie for two reasons: it covers a strictly wider
 * window (there is no month the numeric feed reaches and it does not), and it
 * is the only one that separates the memory-care neighbourhoods from their
 * parent buildings. Deferring to the numeric feed would fold AL/MC back into
 * AL for every month both cover.
 *
 * Precedence is decided per campus-month rather than globally, because a
 * handful of campus-months (58 of ~4,200) are reported by the numeric feed
 * alone. Dropping the feed outright would lose those discharges.
 *
 * @see supersededByExportFeedSql
 */
export const LEGACY_FEED_DEPTS = ["01-HCC", "02-AL", "03-VIL", "24-A/I"] as const;

/**
 * SQL predicate selecting the rows that survive feed precedence: everything
 * from the Export feed, plus numeric-feed rows for campus-months the Export
 * feed never reported.
 *
 * `eventsAlias` is the alias of the `move_in_out_events` row being filtered;
 * `coverageCte` is the name of a CTE of `(location, m)` campus-months the
 * Export feed covers. Kept as a correlated CTE lookup rather than a
 * `NOT EXISTS` over the whole table so the coverage set is built once.
 */
export function supersededByExportFeedSql(
  eventsAlias: string,
  coverageCte: string,
): string {
  const legacy = LEGACY_FEED_DEPTS.map((d) => `'${d}'`).join(", ");
  return `(
    COALESCE(upper(trim(${eventsAlias}.dept)), '') NOT IN (${legacy})
    OR NOT EXISTS (
      SELECT 1 FROM ${coverageCte} c
       WHERE c.location = ${eventsAlias}.location
         AND c.m = substring(${eventsAlias}.event_date, 1, 7)
    )
  )`;
}

/**
 * The campus-months the Export feed reports, as a CTE body for
 * {@link supersededByExportFeedSql}. Coverage means "this feed filed for that
 * campus-month at all", so it deliberately ignores the `counted` flag — a
 * month in which the Export feed recorded only hospital leaves is still a
 * month it covered, and the numeric feed's copy of it is still a duplicate.
 *
 * `clientParam` / `eventTypeParam` are the placeholders (e.g. `$1`) carrying
 * the client id and event type.
 */
export function exportFeedCoverageSql(
  clientParam: string,
  eventTypeParam: string,
): string {
  const legacy = LEGACY_FEED_DEPTS.map((d) => `'${d}'`).join(", ");
  return `
    SELECT DISTINCT location, substring(event_date, 1, 7) AS m
      FROM move_in_out_events
     WHERE client_id = ${clientParam}
       AND event_type = ${eventTypeParam}
       AND COALESCE(upper(trim(dept)), '') NOT IN (${legacy})`;
}

/**
 * Department text as it appears in a workbook is not normalised, so look it up
 * case- and whitespace-insensitively rather than pinning one spelling.
 */
export function serviceLineForDept(dept: string | null): string | null {
  if (!dept) return null;
  return DEPT_TO_SERVICE_LINE[dept.trim().toUpperCase()] ?? null;
}

// New "Export" sheet format — text service line → SL code
const SL_TEXT_TO_CODE: Record<string, string> = {
  "health center": "HC",
  "assisted living": "AL",
  "memory care": "AL/MC",
  "al/mc": "AL/MC",
  "skilled nursing": "SL",
  "independent living": "VIL",
  "villas": "VIL",
  "senior housing": "AL", // catch-all; prefer Department column when available
};

/** Excel serial (1900 date system) or string → YYYY-MM-DD, else null. */
function excelDateToISO(v: any): string | null {
  if (typeof v === "number" && isFinite(v) && v > 20000 && v < 80000) {
    // Date part of the Excel serial (day boundary); fractional part is time-of-day
    const dd = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return dd.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}

export interface MoveInOutImportStats {
  moveInsImported: number;
  moveOutsImported: number;
  countedMoveIns: number;
  countedMoveOuts: number;
  skippedNoDate: number;
  monthRange: { min: string | null; max: string | null };
}

type Ev = {
  eventType: "move_in" | "move_out";
  censusId: string; patientId: string | null;
  division: string | null; location: string; dept: string | null;
  serviceLine: string | null; roomType: string | null; bedType: string | null;
  roomName: string | null; payer: string | null;
  eventDate: string; eventCategory: string | null;
  isReturn: boolean; counted: boolean;
};

/**
 * Shared batch upsert for both import paths.
 *
 * Ends by re-resolving which import format owns each campus-month: the two
 * workbook formats cover the same admissions and discharges under different
 * synthetic census ids, so the ON CONFLICT dedupe above cannot see them as the
 * same event. Whichever format an upload adds to, the overlap is re-decided
 * immediately — an import must never leave the table double-counted, not even
 * until the next boot.
 */
async function upsertEvents(all: Ev[], clientId: string): Promise<MoveInOutImportStats> {
  const stats: MoveInOutImportStats = {
    moveInsImported: 0, moveOutsImported: 0, countedMoveIns: 0, countedMoveOuts: 0,
    skippedNoDate: 0,
    monthRange: { min: null, max: null },
  };
  for (const e of all) {
    if (e.eventType === "move_in") { stats.moveInsImported++; if (e.counted) stats.countedMoveIns++; }
    else { stats.moveOutsImported++; if (e.counted) stats.countedMoveOuts++; }
    const mm = e.eventDate.slice(0, 7);
    if (!stats.monthRange.min || mm < stats.monthRange.min) stats.monthRange.min = mm;
    if (!stats.monthRange.max || mm > stats.monthRange.max) stats.monthRange.max = mm;
  }
  const BATCH = 500;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < all.length; i += BATCH) {
      const chunk = all.slice(i, i + BATCH);
      const vals: string[] = [];
      const params: any[] = [];
      let p = 1;
      for (const e of chunk) {
        vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        params.push(
          clientId, e.eventType, e.censusId, e.patientId, e.division, e.location,
          e.dept, e.serviceLine, e.roomType, e.bedType, e.roomName, e.payer,
          e.eventDate, e.eventCategory, e.isReturn, e.counted,
          importFormatForCensusId(e.censusId),
        );
      }
      await client.query(`
        INSERT INTO move_in_out_events
          (client_id, event_type, census_id, patient_id, division, location, dept,
           service_line, room_type, bed_type, room_name, payer, event_date,
           event_category, is_return, counted, import_format)
        VALUES ${vals.join(",")}
        ON CONFLICT (client_id, event_type, census_id) DO UPDATE SET
          patient_id = EXCLUDED.patient_id, division = EXCLUDED.division,
          location = EXCLUDED.location, dept = EXCLUDED.dept,
          service_line = EXCLUDED.service_line, room_type = EXCLUDED.room_type,
          bed_type = EXCLUDED.bed_type, room_name = EXCLUDED.room_name,
          payer = EXCLUDED.payer, event_date = EXCLUDED.event_date,
          event_category = EXCLUDED.event_category, is_return = EXCLUDED.is_return,
          counted = EXCLUDED.counted, import_format = EXCLUDED.import_format
      `, params);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await resolveOverlappingEventImports(pool, clientId);
  return stats;
}

/**
 * Parse the new "Export" sheet format produced by the Trilogy Move Ins / Move Outs reports.
 * Each file is a single sheet named "Export" with columns:
 *   Date, Campus, Room/Bed, Service Line, Payer Name, Department,
 *   Move Event, Move Category, [Move Ins | Move Outs]
 * The presence of "Move Ins" or "Move Outs" as a column determines the event type.
 */
async function importExportSheetFormat(ws: XLSX.WorkSheet, clientId: string): Promise<MoveInOutImportStats> {
  // Use raw:true (default) so Excel date serials come through as numbers
  // that excelDateToISO can convert; raw:false turns them into unrecognisable strings.
  const rows: any[] = XLSX.utils.sheet_to_json(ws);
  if (rows.length === 0) throw new Error("Export sheet is empty");

  // Detect event type from column headers
  const sample = rows[0];
  const hasMoveIns  = "Move Ins"  in sample || sample["Move Ins"]  != null;
  const hasMoveOuts = "Move Outs" in sample || sample["Move Outs"] != null;
  if (!hasMoveIns && !hasMoveOuts) {
    throw new Error("Export sheet must have a 'Move Ins' or 'Move Outs' column");
  }
  const eventType: "move_in" | "move_out" = hasMoveIns ? "move_in" : "move_out";

  const events = new Map<string, Ev>();
  let skippedNoDate = 0;
  let rowIndex = 0;

  for (const r of rows) {
    rowIndex++;
    const campus = r["Campus"] != null ? String(r["Campus"]).trim() : null;
    const rawDate = r["Date"];
    const eventDate = excelDateToISO(rawDate);
    if (!campus || !eventDate) { skippedNoDate++; continue; }

    // Service line: prefer Department, fall back to the Service Line text.
    // The explicit department map comes FIRST because it is the only thing that
    // can tell a sub-neighbourhood apart from the building it sits in — the
    // "Service Line" column says "Health Center" for memory care too.
    const deptRaw = r["Department"] != null ? String(r["Department"]).trim() : null;
    const slText  = r["Service Line"] != null ? String(r["Service Line"]).trim().toLowerCase() : null;
    const serviceLine =
      serviceLineForDept(deptRaw)
      ?? (deptRaw && /^[A-Z\/]+$/.test(deptRaw) && deptRaw.length <= 6
        ? deptRaw  // already a code ("HC", "AL", "AL/MC", etc.)
        : (slText ? (SL_TEXT_TO_CODE[slText] ?? null) : null));

    const roomBed  = r["Room/Bed"] != null ? String(r["Room/Bed"]).trim() : null;
    const lastName = r["Last Name"] != null ? String(r["Last Name"]).trim() : "";
    const payer    = r["Payer Name"] != null ? String(r["Payer Name"]).trim() : null;
    const moveEvent    = r["Move Event"]    != null ? String(r["Move Event"]).trim()    : null;
    const moveCategory = r["Move Category"] != null ? String(r["Move Category"]).trim() : null;

    // Synthetic census ID — deduplicates same person/room/date/event within this upload
    const censusId = `exp|${eventDate}|${campus}|${roomBed ?? ""}|${lastName}|${moveEvent ?? ""}`;

    // A death is written with a blank Move Category and the event named in
    // Move Event, so the category alone drops it. Resolve the category first,
    // then apply the same departure rule the legacy format uses.
    const moveOutCategory = moveCategory || moveEvent;
    const counted = eventType === "move_in"
      ? moveEvent?.toLowerCase() === "admission"
      : isPermanentDeparture(moveOutCategory);

    const isReturn = eventType === "move_in" && moveEvent?.toLowerCase() === "return";

    events.set(`${eventType}|${censusId}`, {
      eventType,
      censusId,
      patientId: null,
      division: null,
      location: campus,
      dept: deptRaw,
      serviceLine,
      roomType: null,   // no reliable room-type mapping in this format
      bedType: roomBed ? roomBed.split("/")[1] ?? null : null,
      roomName: roomBed,
      payer,
      eventDate,
      eventCategory: eventType === "move_in" ? moveEvent : moveOutCategory,
      isReturn,
      counted,
    });
  }

  const all = Array.from(events.values()).filter(e => e.location);
  const stats = await upsertEvents(all, clientId);
  stats.skippedNoDate = skippedNoDate;
  return stats;
}

export async function importMoveInOutWorkbook(buffer: Buffer, clientId: string): Promise<MoveInOutImportStats> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  // ── Detect format ──────────────────────────────────────────────────────────
  const admSheet = wb.SheetNames.find(n => /admission/i.test(n));
  const disSheet = wb.SheetNames.find(n => /discharge/i.test(n));
  const exportSheet = wb.SheetNames.find(n => /^export$/i.test(n));

  // New "Export" sheet format: columns Campus, Date, Move Ins / Move Outs
  if (exportSheet && !admSheet && !disSheet) {
    return importExportSheetFormat(wb.Sheets[exportSheet], clientId);
  }

  if (!admSheet && !disSheet) {
    throw new Error(
      "Unrecognised workbook format. Upload either:\n" +
      "  • The new format: a single-sheet 'Export' workbook with 'Move Ins' or 'Move Outs' columns, or\n" +
      "  • The legacy format: a workbook with 'Admissions' and/or 'Discharges' sheets."
    );
  }

  // ── Legacy format (Admissions / Discharges sheets) ─────────────────────────
  const events = new Map<string, Ev>(); // `${eventType}|${censusId}` dedupe within file
  let skippedNoDate = 0;

  const mapCommon = (r: any) => {
    const dept = r.dept != null ? String(r.dept).trim() : null;
    return {
      patientId: r.PatientID != null ? String(r.PatientID) : null,
      division: r.division != null ? String(r.division).trim() : null,
      location: r.location != null ? String(r.location).trim() : "",
      dept,
      serviceLine: serviceLineForDept(dept),
      bedType: r.BedTypeDesc != null ? String(r.BedTypeDesc).trim() : null,
      roomType: r.BedTypeDesc != null ? normalizeRoomType(String(r.BedTypeDesc)) : null,
      roomName: r.RoomName != null ? String(r.RoomName).trim() : null,
    };
  };

  if (admSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[admSheet]);
    for (const r of rows) {
      const censusId = r.CensusID != null ? String(r.CensusID) : null;
      const eventDate = excelDateToISO(r.Census_Date);
      if (!censusId || !eventDate || r.location == null) { skippedNoDate++; continue; }
      const category = r.Census_Event != null ? String(r.Census_Event).trim() : null;
      const isReturn = category?.toLowerCase() === "return" || String(r["Is Return?"] ?? "0") === "1";
      events.set(`move_in|${censusId}`, {
        eventType: "move_in", censusId, ...mapCommon(r),
        payer: r.Primary_Payer != null ? String(r.Primary_Payer).trim() : null,
        eventDate, eventCategory: category, isReturn,
        counted: category?.toLowerCase() === "admission",
      });
    }
  }

  if (disSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[disSheet]);
    for (const r of rows) {
      const censusId = r.CensusID != null ? String(r.CensusID) : null;
      const eventDate = excelDateToISO(r.CensusDate);
      if (!censusId || !eventDate || r.location == null) { skippedNoDate++; continue; }
      const category = r.Discharge_Type != null ? String(r.Discharge_Type).trim() : null;
      events.set(`move_out|${censusId}`, {
        eventType: "move_out", censusId, ...mapCommon(r),
        payer: r.Discharge_Payer != null ? String(r.Discharge_Payer).trim() : null,
        eventDate, eventCategory: category, isReturn: false,
        // This sheet writes no Discharge_Type at all when the resident died,
        // so a blank here is a death rather than a missing value.
        counted: isPermanentDeparture(category, { blankMeansDeath: true }),
      });
    }
  }

  const all = Array.from(events.values()).filter(e => e.location);
  const stats = await upsertEvents(all, clientId);
  stats.skippedNoDate = skippedNoDate;
  return stats;
}

/**
 * Re-derive `service_line` from `dept` for rows already in the table.
 *
 * Event workbooks are historical: nobody re-uploads two years of admissions
 * because a department mapping changed, so a fix to {@link DEPT_TO_SERVICE_LINE}
 * only reaches the next import unless stored rows are repaired too. Rows whose
 * department is not in the map are left exactly as imported — this repairs the
 * mapping, it does not re-classify anything the mapping has no opinion about.
 *
 * Idempotent: only rows that disagree with the current mapping are written.
 *
 * @returns the number of rows corrected.
 */
export async function backfillEventServiceLinesFromDept(): Promise<number> {
  const depts = Object.keys(DEPT_TO_SERVICE_LINE);
  const lines = depts.map((d) => DEPT_TO_SERVICE_LINE[d]);
  const res = await pool.query(
    `UPDATE move_in_out_events e
        SET service_line = m.sl
       FROM unnest($1::text[], $2::text[]) AS m(dept, sl)
      WHERE upper(trim(e.dept)) = m.dept
        AND e.service_line IS DISTINCT FROM m.sl`,
    [depts, lines],
  );
  return res.rowCount ?? 0;
}

/**
 * Repair the import-format column and re-decide which format owns each
 * campus-month, for rows already in the table.
 *
 * Event workbooks are historical uploads: the two overlapping formats have
 * been sitting in the table since long before anything knew to tell them
 * apart, so the resolution has to reach stored rows and not just the next
 * import. Idempotent — after the first run it changes nothing.
 *
 * @returns how many rows had their format stamped and how many changed owner.
 */
export async function resolveStoredEventImportOverlap(): Promise<{
  formatsStamped: number;
  supersededChanged: number;
}> {
  const formatsStamped = await backfillEventImportFormats(pool);
  const supersededChanged = await resolveOverlappingEventImports(pool);
  return { formatsStamped, supersededChanged };
}

/**
 * Categories that mean the resident permanently released the unit.
 *
 * A death vacates a unit exactly as a discharge does — it re-lets at street
 * rate — so for pricing it is turnover. Hospital and therapeutic leaves are
 * absent from this list on purpose: the resident keeps the unit and the rate,
 * so the unit never re-prices and counting it would inflate turnover.
 */
const PERMANENT_DEPARTURE_CATEGORIES = [
  "discharge - return not anticipated",
  "expired",
  "deceased",
  "death",
];

/**
 * Whether a discharge category means the resident permanently left.
 *
 * @param blankMeansDeath treat an empty category as a death. True only for the
 * legacy Discharges sheet, which writes no `Discharge_Type` at all when the
 * resident died. The export sheet names the event instead, so its caller
 * resolves the category before asking and must NOT set this — a blank there is
 * genuinely unknown and stays uncounted.
 */
export function isPermanentDeparture(
  category: string | null | undefined,
  opts: { blankMeansDeath?: boolean } = {},
): boolean {
  const c = category?.trim().toLowerCase() ?? "";
  if (!c) return opts.blankMeansDeath === true;
  return PERMANENT_DEPARTURE_CATEGORIES.includes(c);
}

/**
 * The same rule as {@link isPermanentDeparture}, in SQL, for the backfill.
 *
 * The `blankMeansDeath` argument the predicate takes is decided here by the
 * stored import format, which is the only thing that can tell the two sheets
 * apart after the fact. Keep the two in step: a category added to the list
 * above reaches this automatically, but a change to the blank rule does not.
 */
const PERMANENT_DEPARTURE_SQL = `(
  lower(btrim(coalesce(event_category, ''))) IN (
    ${PERMANENT_DEPARTURE_CATEGORIES.map((c) => `'${c}'`).join(", ")}
  )
  OR (
    import_format = 'legacy'
    AND coalesce(btrim(event_category), '') = ''
  )
)`;

/**
 * Bring move-outs imported before deaths counted into line with the rule.
 *
 * Idempotent: matches nothing once it has run.
 *
 * Must run AFTER the import formats are stamped — the rule reads
 * `import_format` to decide whether a blank category is a death, and every row
 * defaults to 'legacy' before stamping, which would count blank export rows as
 * deaths.
 *
 * @returns how many stored move-outs changed count.
 */
export async function backfillDepartureRule(): Promise<number> {
  const counted = await pool.query(
    `UPDATE move_in_out_events
        SET counted = ${PERMANENT_DEPARTURE_SQL}
      WHERE event_type = 'move_out'
        AND counted IS DISTINCT FROM ${PERMANENT_DEPARTURE_SQL}`,
  );
  return counted.rowCount ?? 0;
}
/**
 * Whether this client has any imported move-in/out event data.
 *
 * Reads the active view like every other accessor: a client whose only rows
 * are superseded duplicates has no usable feed.
 */
export async function hasMoveInOutEvents(clientId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM ${MOVE_IN_OUT_ACTIVE_VIEW} WHERE client_id = $1 LIMIT 1`, [clientId],
  );
  return res.rows.length > 0;
}

/**
 * Monthly counted move-in series keyed `${location}|${serviceLine}|${roomType}`
 * → Map<YYYY-MM, count>. By default HC / HC-MC move-ins are restricted to
 * Private Pay payers (street pricing only affects private pay — see pricing
 * methodology). Pass `allPayers: true` for census-style counts (all payers),
 * e.g. when displaying move-ins/outs/net flows rather than pricing impact.
 */
export async function getMonthlyMoveInSeriesFromEvents(
  clientId: string,
  opts: { keySep?: string; allPayers?: boolean } = {},
): Promise<Map<string, Map<string, number>>> {
  const sep = opts.keySep ?? "|";
  const payerFilter = opts.allPayers
    ? ""
    : `AND (CASE WHEN service_line IN ('HC','HC/MC')
           THEN ${privatePaySql("payer")} ELSE TRUE END)`;
  const res = await pool.query(`
    SELECT location, service_line, room_type, SUBSTRING(event_date, 1, 7) AS mm, COUNT(*)::int AS n
    FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
    WHERE client_id = $1 AND event_type = 'move_in' AND counted = true
      ${payerFilter}
    GROUP BY 1, 2, 3, 4
  `, [clientId]);
  const map = new Map<string, Map<string, number>>();
  for (const r of res.rows as any[]) {
    const key = `${r.location}${sep}${r.service_line ?? ""}${sep}${r.room_type ?? ""}`;
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(r.mm, (map.get(key)!.get(r.mm) || 0) + Number(r.n));
  }
  return map;
}

/**
 * Monthly counted move-out series keyed `${location}|${serviceLine}|${roomType}`
 * → Map<YYYY-MM, count>.
 */
export async function getMonthlyMoveOutSeriesFromEvents(
  clientId: string,
  opts: { keySep?: string } = {},
): Promise<Map<string, Map<string, number>>> {
  const sep = opts.keySep ?? "|";
  const res = await pool.query(`
    SELECT location, service_line, room_type, SUBSTRING(event_date, 1, 7) AS mm, COUNT(*)::int AS n
    FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
    WHERE client_id = $1 AND event_type = 'move_out' AND counted = true
    GROUP BY 1, 2, 3, 4
  `, [clientId]);
  const map = new Map<string, Map<string, number>>();
  for (const r of res.rows as any[]) {
    const key = `${r.location}${sep}${r.service_line ?? ""}${sep}${r.room_type ?? ""}`;
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(r.mm, (map.get(key)!.get(r.mm) || 0) + Number(r.n));
  }
  return map;
}

export interface LatestGroupedMoveInOutCounts {
  month: string | null;
  moveIns: Map<string, number>;
  moveOuts: Map<string, number>;
}

export interface T3GroupedMoveInOutCounts {
  moveIns: Map<string, number>;
  moveOuts: Map<string, number>;
}

/**
 * Latest census-style move-in/out counts keyed by the same grouped
 * `${location}||${serviceLine}||${roomType}` identity as Reference Data.
 *
 * The event workbooks identify the occupied room but generally leave
 * `room_type` blank. Resolve each event through the spot-month rent roll so
 * its room type is not lost; the rent-roll match also corrects source service
 * lines such as event-feed `IL` to the application's `VIL`.
 */
export async function getLatestGroupedMoveInOutCounts(
  clientId: string,
  spotMonth: string,
): Promise<LatestGroupedMoveInOutCounts> {
  const res = await pool.query(`
    WITH anchor AS (
      SELECT MAX(SUBSTRING(event_date, 1, 7)) AS month
      FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
      WHERE client_id = $1
        AND counted = true
        AND SUBSTRING(event_date, 1, 7) <= $2
    ),
    resolved AS (
      SELECT
        e.location,
        COALESCE(rr.service_line, e.service_line) AS service_line,
        COALESCE(rtg.group_name, rr.room_type, e.room_type) AS room_type,
        e.event_type
      FROM ${MOVE_IN_OUT_ACTIVE_VIEW} e
      CROSS JOIN anchor a
      LEFT JOIN LATERAL (
        SELECT r.service_line, r.room_type, r.source_room_type
        FROM rent_roll_data r
        WHERE r.client_id = e.client_id
          AND r.upload_month = $2
          AND r.location = e.location
          AND e.room_name IS NOT NULL
          AND UPPER(BTRIM(r.room_number)) = UPPER(BTRIM(e.room_name))
        ORDER BY (r.service_line = e.service_line) DESC, r.occupied_yn DESC, r.id
        LIMIT 1
      ) rr ON TRUE
      LEFT JOIN room_type_groupings rtg
        ON rtg.client_id = e.client_id
       AND rtg.location = e.location
       AND rtg.service_line = rr.service_line
       AND rtg.source_room_type = rr.source_room_type
      WHERE e.client_id = $1
        AND e.counted = true
        AND SUBSTRING(e.event_date, 1, 7) = a.month
    )
    SELECT location, service_line, room_type, event_type, COUNT(*)::int AS n,
           (SELECT month FROM anchor) AS month
    FROM resolved
    GROUP BY location, service_line, room_type, event_type
  `, [clientId, spotMonth]);

  const moveIns = new Map<string, number>();
  const moveOuts = new Map<string, number>();
  let month: string | null = null;
  for (const r of res.rows as any[]) {
    month = r.month ?? month;
    if (!r.location || !r.service_line || !r.room_type) continue;
    const key = `${r.location}||${r.service_line}||${r.room_type}`;
    const target = r.event_type === "move_in" ? moveIns : r.event_type === "move_out" ? moveOuts : null;
    if (target) target.set(key, (target.get(key) || 0) + (Number(r.n) || 0));
  }
  return { month, moveIns, moveOuts };
}

/**
 * Census-style trailing-month move-in/out averages keyed by the same grouped
 * `${location}||${serviceLine}||${roomType}` identity as Reference Data.
 *
 * Unlike getT3MoveInsMapFromEvents (which is intentionally private-pay-only
 * for pricing impact), this accessor includes all payers because these columns
 * describe census movement. Events that omit room_type are resolved through the
 * spot-month rent roll before room-type grouping is applied.
 */
export async function getT3GroupedMoveInOutCounts(
  clientId: string,
  t3Months: string[],
  spotMonth: string,
): Promise<T3GroupedMoveInOutCounts> {
  const moveIns = new Map<string, number>();
  const moveOuts = new Map<string, number>();
  if (t3Months.length === 0) return { moveIns, moveOuts };

  const res = await pool.query(`
    WITH spot_rooms_exact AS MATERIALIZED (
      SELECT DISTINCT ON (
        location,
        UPPER(BTRIM(room_number)),
        service_line
      )
        location,
        UPPER(BTRIM(room_number)) AS room_key,
        service_line,
        room_type,
        source_room_type,
        occupied_yn,
        id
      FROM rent_roll_data
      WHERE client_id = $1
        AND upload_month = $3
        AND room_number IS NOT NULL
      ORDER BY
        location,
        UPPER(BTRIM(room_number)),
        service_line,
        occupied_yn DESC,
        id
    ),
    spot_rooms_fallback AS MATERIALIZED (
      SELECT DISTINCT ON (location, room_key)
        location,
        room_key,
        service_line,
        room_type,
        source_room_type
      FROM spot_rooms_exact
      ORDER BY location, room_key, occupied_yn DESC, id
    ),
    resolved AS (
      SELECT
        e.location,
        COALESCE(exact.service_line, fallback.service_line, e.service_line) AS service_line,
        COALESCE(rtg.group_name, exact.room_type, fallback.room_type, e.room_type) AS room_type,
        SUBSTRING(e.event_date, 1, 7) AS mm,
        e.event_type
      FROM ${MOVE_IN_OUT_ACTIVE_VIEW} e
      LEFT JOIN spot_rooms_exact exact
        ON exact.location = e.location
       AND exact.room_key = UPPER(BTRIM(e.room_name))
       AND exact.service_line = e.service_line
      LEFT JOIN spot_rooms_fallback fallback
        ON fallback.location = e.location
       AND fallback.room_key = UPPER(BTRIM(e.room_name))
      LEFT JOIN room_type_groupings rtg
        ON rtg.client_id = e.client_id
       AND rtg.location = e.location
       AND rtg.service_line = COALESCE(exact.service_line, fallback.service_line)
       AND rtg.source_room_type = COALESCE(exact.source_room_type, fallback.source_room_type)
      WHERE e.client_id = $1
        AND e.counted = true
        AND SUBSTRING(e.event_date, 1, 7) = ANY($2)
    )
    SELECT location, service_line, room_type, event_type, COUNT(*)::float AS n
    FROM resolved
    GROUP BY location, service_line, room_type, event_type
  `, [clientId, t3Months, spotMonth]);

  for (const r of res.rows as any[]) {
    if (!r.location || !r.service_line || !r.room_type) continue;
    const key = `${r.location}||${r.service_line}||${r.room_type}`;
    const target = r.event_type === "move_in" ? moveIns : r.event_type === "move_out" ? moveOuts : null;
    if (target) target.set(key, (target.get(key) || 0) + Number(r.n) / t3Months.length);
  }
  return { moveIns, moveOuts };
}

/**
 * T3 move-ins/month map keyed `${location}||${serviceLine}||${roomType}` from
 * event data, averaged over the given trailing months (YYYY-MM strings).
 * Same key format + semantics as ruleImpactService.getT3MoveInsMap.
 */
export async function getT3MoveInsMapFromEvents(
  clientId: string,
  t3Months: string[],
  scope: { location?: string | null; serviceLine?: string | null } = {},
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (t3Months.length === 0) return map;
  const where: string[] = [
    "client_id = $1", "event_type = 'move_in'", "counted = true",
    "SUBSTRING(event_date, 1, 7) = ANY($2)",
    `(CASE WHEN service_line IN ('HC','HC/MC') THEN ${privatePaySql("payer")} ELSE TRUE END)`,
  ];
  const params: any[] = [clientId, t3Months];
  let idx = 3;
  if (scope.location) { where.push(`location = $${idx++}`); params.push(scope.location); }
  if (scope.serviceLine) { where.push(`service_line = $${idx++}`); params.push(scope.serviceLine); }
  const res = await pool.query(`
    SELECT location, service_line, room_type, COUNT(*)::float / ${t3Months.length} AS t3_moveins
    FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
    WHERE ${where.join(" AND ")}
    GROUP BY 1, 2, 3
  `, params);
  for (const r of res.rows as any[]) {
    map.set(`${r.location}||${r.service_line}||${r.room_type}`, Number(r.t3_moveins) || 0);
  }
  return map;
}
