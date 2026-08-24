import * as XLSX from "xlsx";
import { isPrivatePayer, privatePaySql } from "@shared/payerScope";
import { pool } from "../db";
import { normalizeRoomType } from "@shared/roomTypes";

// ── Move-In / Move-Out event import + monthly count accessors ────────────────
// Authoritative event-level source for monthly move-in / move-out counts,
// imported from the "Move Ins & Outs Detail" workbook (Admissions +
// Discharges sheets). Counting rules:
//   • Move-in counted  = Census_Event 'Admission' (returns from hospital
//     leave are stored but NOT counted as new move-ins)
//   • Move-out counted = Discharge_Type 'Discharge - Return Not Anticipated'
//     (hospital leaves / therapeutic leaves / return-expected discharges are
//     stored but NOT counted as permanent move-outs)
// All rows are stored with a `counted` flag so raw data stays queryable.

/**
 * Department → service-line code.
 *
 * MEMORY CARE INSIDE THE HEALTH CENTER
 * `HC Legacy` is this client's branded memory-care neighbourhood inside the
 * Health Center, and it is the ONLY place a HC/MC discharge is identifiable in
 * the event feed. Without this entry the department text falls through to the
 * "Service Line" column, which says "Health Center" for the whole building, so
 * every memory-care discharge was stored as plain `HC`. Occupancy history and
 * the rent roll both carry `HC/MC` as a service line of its own, which left it
 * with a denominator and no numerator — measured turnover of exactly zero.
 *
 * The mapping is not a guess. Joining event `room_name` to the rent roll's
 * `room_number` at the same campus, 987 of the 1,038 counted `HC Legacy`
 * move-outs land in a room the rent roll classifies as HC/MC and only 2 land
 * in an HC-only room; the rest are rooms the rent roll has never carried.
 *
 * `AL Legacy` is deliberately NOT mapped to `AL/MC` here. AL/MC already
 * receives its own events from the `24-A/I` department, so folding the Legacy
 * rows in would count part of that line twice. Assisted-living memory care is
 * a separate question from this one.
 */
export const DEPT_TO_SERVICE_LINE: Record<string, string> = {
  "01-HCC": "HC",
  "02-AL": "AL",
  "03-VIL": "VIL",
  "24-A/I": "AL/MC",
  "HC LEGACY": "HC/MC",
};

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

/** Shared batch upsert for both import paths. */
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
        vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        params.push(
          clientId, e.eventType, e.censusId, e.patientId, e.division, e.location,
          e.dept, e.serviceLine, e.roomType, e.bedType, e.roomName, e.payer,
          e.eventDate, e.eventCategory, e.isReturn, e.counted,
        );
      }
      await client.query(`
        INSERT INTO move_in_out_events
          (client_id, event_type, census_id, patient_id, division, location, dept,
           service_line, room_type, bed_type, room_name, payer, event_date,
           event_category, is_return, counted)
        VALUES ${vals.join(",")}
        ON CONFLICT (client_id, event_type, census_id) DO UPDATE SET
          patient_id = EXCLUDED.patient_id, division = EXCLUDED.division,
          location = EXCLUDED.location, dept = EXCLUDED.dept,
          service_line = EXCLUDED.service_line, room_type = EXCLUDED.room_type,
          bed_type = EXCLUDED.bed_type, room_name = EXCLUDED.room_name,
          payer = EXCLUDED.payer, event_date = EXCLUDED.event_date,
          event_category = EXCLUDED.event_category, is_return = EXCLUDED.is_return,
          counted = EXCLUDED.counted
      `, params);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

    // Counting rules (same logic as legacy format)
    const counted = eventType === "move_in"
      ? moveEvent?.toLowerCase() === "admission"
      : moveCategory?.toLowerCase() === "discharge - return not anticipated";

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
      eventCategory: eventType === "move_in" ? moveEvent : moveCategory,
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
        counted: category?.toLowerCase() === "discharge - return not anticipated",
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

/** Whether this client has any imported move-in/out event data. */
export async function hasMoveInOutEvents(clientId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM move_in_out_events WHERE client_id = $1 LIMIT 1`, [clientId],
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
    FROM move_in_out_events
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
    FROM move_in_out_events
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
    FROM move_in_out_events
    WHERE ${where.join(" AND ")}
    GROUP BY 1, 2, 3
  `, params);
  for (const r of res.rows as any[]) {
    map.set(`${r.location}||${r.service_line}||${r.room_type}`, Number(r.t3_moveins) || 0);
  }
  return map;
}
