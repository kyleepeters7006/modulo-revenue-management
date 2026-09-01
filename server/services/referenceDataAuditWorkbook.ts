/**
 * Formula-driven Reference Data audit workbook.
 *
 * Source tabs intentionally resemble the upload templates.  The calculation
 * tabs do not copy the API response: they point back to those source tabs with
 * Excel formulas so an operator can inspect and change the source assumptions.
 */
import ExcelJS from "exceljs";
import { mkdtemp, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "../db";
import { isPrivatePayer } from "@shared/payerScope";
import { isBBedRow } from "@shared/bBed";
import { passesStreetGate } from "./rateBaselineView";
import { RATE_OUTLIER_FLOOR_RATIO } from "@shared/rateOutliers";

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const REFERENCE_DATA_AUDIT_CONTENT_TYPE = CONTENT_TYPE;
export const REFERENCE_DATA_AUDIT_FILENAME = "reference_data_audit.xlsx";

const HEADER_FILL = "FF1A2B4A";
const SUBHEAD_FILL = "FFD9E2F3";
const DESC_FILL = "FFFFF9E6";
const ALT_FILL = "FFF0F4FF";
const WHITE_FILL = "FFFFFFFF";
const FORMULA_FILL = "FFE8F4E8";
const REFERENCE_FILL = "FFEDEDED";
const WARNING_FILL = "FFFFE2E2";
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};
const FMT_MONEY = "#,##0.00;[Red]-#,##0.00";
const FMT_INT = "#,##0";
const FMT_PCT = "0.0%";
const FMT_NUM = "#,##0.00";

const LOCATION_HEADERS = [
  "Location Name", "Location Code", "Region", "Division", "Location Class",
  "Address", "City", "State", "Zip Code", "Total Units", "Same Store",
  "MatrixCare Name HC", "MatrixCare Name AL", "MatrixCare Name IL",
  "Customer Facility ID HC", "Customer Facility ID AL", "Customer Facility ID IL",
];
const RENT_HEADERS = [
  "Upload Month", "Date", "Location", "Room Number", "Room Type", "Service Line",
  "Occupied Y/N", "Size", "Street Rate", "In-House Rate", "Days Vacant", "View",
  "Renovated", "Preferred Location", "Other Premium Feature", "Location Rating",
  "Size Rating", "View Rating", "Renovation Rating", "Amenity Rating", "Care Level",
  "Care Rate", "Rent and Care Rate", "Promotion Allowance", "Resident ID",
  "Resident Name", "Move-In Date", "Move-Out Date", "Payor Type",
  "Record ID", "Source Room Type", "Reference Room Type", "Physical Room Key",
  "Street Rate Included", "In-House Rate Included", "Private Pay IH Eligible",
  "Physical Room First", "Physical Occupied First", "Competitor Base Rate",
  "Competitor Adjusted Rate",
];
const INQUIRY_HEADERS = [
  "Upload Month", "Date", "Location", "Inquiry Count", "Region", "Division",
  "Service Line", "Lead Source", "Tour Count", "Conversion Count", "Conversion Rate",
  "Days to Tour", "Days to Move-In",
];
const SURVEY_HEADERS = [
  "Survey Month", "KeyStats Location", "Competitor Name", "Competitor Address",
  "Distance (Miles)", "Competitor Type", "Room Type", "Square Footage",
  "Monthly Rate Low", "Monthly Rate High", "Monthly Rate Avg", "Care Fees Avg",
  "Care Level 1 Rate", "Care Level 2 Rate", "Care Level 3 Rate", "Care Level 4 Rate",
  "Medication Management Fee", "Community Fee", "Pet Fee", "Incentives", "Total Units",
  "Occupancy Rate", "Year Built", "Notes", "Weight",
];
const RTO_HEADERS = [
  "Month", "Division", "Campus", "Service Line", "Room Type", "Occ Units",
  "Available Units/Beds", "OCC%", "Reference Room Type",
];
const MOVE_HEADERS = [
  "Date", "Campus", "Department", "Service Line", "Room/Bed", "Last Name",
  "Payer Name", "Move Event", "Move Category", "Move Ins", "Event Month",
  "Event Type", "Counted", "Record ID",
];
const SOURCE_DESCRIPTIONS: Record<string, string[]> = {
  "Location Data": [
    "Current tenant locations. Matches the Location upload template.",
    "Internal location code.", "Geographic region.", "Division or sub-region.",
    "Campus classification.", "Street address.", "City.", "Two-letter state code.",
    "Postal code.", "Configured total units.", "Y/N same-store flag.",
    "MatrixCare HC name.", "MatrixCare AL name.", "MatrixCare IL name.",
    "Customer facility ID for HC.", "Customer facility ID for AL.",
    "Customer facility ID for IL.",
  ],
  "Rent Roll": [
    "Latest 12 upload months used by Reference Data.", "Snapshot date.",
    "Campus name.", "Unit or room identifier.", "Imported room type.",
    "Service line.", "Y if occupied.", "Unit size.", "Published asking rate.",
    "Billed in-house rate.", "Days vacant.", "View.", "Renovated flag.",
    "Preferred location.", "Other premium feature.", "Location rating.",
    "Size rating.", "View rating.", "Renovation rating.", "Amenity rating.",
    "Care level.", "Care rate.", "Rent plus care rate.", "Promotion allowance.",
    "Resident ID.", "Resident name.", "Move-in date.", "Move-out date.",
    "Payer type.", "Database record identifier.", "Raw room type used for grouping.",
    "Room type used by Reference Data grouping.", "Physical room identity used for distinct counts.",
    "1 when the row passes the shared street-rate outlier gate.", "1 when the row is an eligible in-house rate.",
    "1 when the occupied row is private-pay eligible for HC/HC-MC.", "Formula: first physical room row.",
    "Formula: first occupied row for the physical room.", "Stored competitor base rate used by Reference Data.",
    "Stored competitor adjusted rate used by Reference Data.",
  ],
  "Inquiry Data": [
    "Reporting period.", "As-of date.", "Campus name.", "Inquiry count.",
    "Region.", "Division.", "Service line; blank means campus total.", "Lead source.",
    "Tour count.", "Conversion count.", "Conversion rate.", "Average days to tour.",
    "Average days to move-in.",
  ],
  "Competitive Survey": [
    "Survey period.", "Campus benchmarked.", "Competitor name.", "Competitor address.",
    "Distance in miles.", "Competitor type.", "Competitor room type.", "Square footage.",
    "Low base rate.", "High base rate.", "Average base rate; HC is daily.",
    "Average care fee.", "Care level 1.", "Care level 2.", "Care level 3.",
    "Care level 4.", "Medication management fee.", "Community fee.", "Pet fee.",
    "Incentives.", "Competitor units.", "Occupancy percentage.", "Year built.",
    "Survey notes.", "Relative weight.",
  ],
  "RT Occupancy History": [
    "YYYY-MM period.", "Division.", "Campus.", "Service line.",
    "Raw/normalized room type from occupancy history.", "Occupied units.",
    "Available units or beds.", "Reported occupancy percentage.",
    "Room type mapped to the Reference Data grouping.",
  ],
  "Move Ins & Outs": [
    "Event date.", "Campus.", "Department.", "Service line.", "Room or bed.",
    "Last name.", "Payer.", "Move event.", "Move category.", "Imported marker.",
    "Derived event month.", "move_in or move_out.", "Whether the event is counted.",
    "Database record identifier.",
  ],
};

type AnyRow = Record<string, any>;
type SourceSheet = { ws: any; first: number; last: number; columns: Record<string, string> };

function colLetter(n: number): string {
  let value = n;
  let out = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function excelText(value: unknown): string {
  return String(value ?? "").replace(/"/g, "\"\"");
}

function formula(formulaText: string, result?: any): ExcelJS.CellFormulaValue {
  return { formula: formulaText, ...(result === undefined ? {} : { result }) } as ExcelJS.CellFormulaValue;
}

function styleDataRow(row: any, fill: string, formulaColumns: Set<number> = new Set()) {
  row.eachCell({ includeEmpty: true }, (cell: any, index: number) => {
    const isHyperlink = cell.value && typeof cell.value === "object" && "hyperlink" in cell.value;
    cell.font = isHyperlink
      ? { color: { argb: "FF0563C1" }, underline: "single", size: 10 }
      : { color: { argb: "FF1A1A1A" }, size: 10 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: formulaColumns.has(index) ? FORMULA_FILL : fill },
    };
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", wrapText: false };
  });
  row.height = 18;
}

function isStreamingWorkbook(wb: any): boolean {
  return typeof wb.commit === "function" && !wb.xlsx?.writeBuffer;
}

function setWorksheetViews(ws: any, wb: any, views: any[]) {
  if (isStreamingWorkbook(wb)) ws.views.push(...views);
  else ws.views = views;
}

function addSourceSheet(
  wb: any,
  name: string,
  headers: string[],
  descriptions: string[],
  rows: any[][],
  widths: number[],
  formulaRows?: Map<number, Set<number>>,
): SourceSheet {
  const ws = wb.addWorksheet(name, isStreamingWorkbook(wb) ? { views: [{ state: "frozen", ySplit: 2 }] } : undefined);
  ws.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: widths[index] ?? Math.min(32, Math.max(12, header.length + 2)),
  }));
  const headerRow = ws.getRow(1);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = BORDER;
  });
  headerRow.height = 30;
  const descriptionRow = ws.getRow(2);
  headers.forEach((_, index) => {
    const cell = descriptionRow.getCell(index + 1);
    cell.value = descriptions[index] ?? "";
    cell.font = { italic: true, color: { argb: "FF5C5C00" }, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DESC_FILL } };
    cell.alignment = { vertical: "top", wrapText: true };
    cell.border = BORDER;
  });
  descriptionRow.height = 62;
  rows.forEach((values, rowIndex) => {
    const row = ws.addRow(values);
    const formulaColumns = formulaRows?.get(rowIndex + 3) ?? new Set<number>();
    styleDataRow(row, rowIndex % 2 === 0 ? WHITE_FILL : ALT_FILL, formulaColumns);
    if (isStreamingWorkbook(wb)) row.commit();
  });
  const last = Math.max(3, rows.length + 2);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: headers.length } };
  setWorksheetViews(ws, wb, [{ state: "frozen", ySplit: 2 }]);
  return {
    ws,
    first: 3,
    last,
    columns: Object.fromEntries(headers.map((header, index) => [header, colLetter(index + 1)])),
  };
}

function range(sheet: SourceSheet, header: string): string {
  const column = sheet.columns[header];
  return `${quoteSheet(sheet.ws.name)}!$${column}$${sheet.first}:$${column}$${sheet.last}`;
}

function addFormulaCell(cell: any, formulaText: string, numFmt?: string, result?: any) {
  cell.value = formula(formulaText, result);
  if (numFmt) cell.numFmt = numFmt;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FORMULA_FILL } };
  cell.border = BORDER;
}

function normalizeMonth(value: any): string {
  if (!value) return "";
  const text = String(value);
  return /^\d{4}-\d{2}$/.test(text) ? text : text.slice(0, 7);
}

function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const next = year * 12 + mon;
  return `${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, "0")}`;
}

function physicalRoomKey(row: AnyRow): string {
  const room = String(row.room_number ?? "");
  const normalized = ["AL", "AL/MC", "SL", "VIL"].includes(row.service_line)
    ? room.replace(/\/[A-Za-z]+$/, "")
    : room;
  return `${row.upload_month}||${row.location}||${row.service_line}||${row.reference_room_type}||${normalized}`;
}

function ruleSpecificity(rule: AnyRow): number {
  let score = 0;
  if (rule.location_id) score += 4;
  const serviceLines = Array.isArray(rule.service_lines) && rule.service_lines.length
    ? rule.service_lines : rule.service_line ? [rule.service_line] : [];
  if (serviceLines.length) score += 2;
  if (Array.isArray(rule.action?.filters?.roomType) && rule.action.filters.roomType.length) score += 1;
  return score;
}

function serviceLineFamily(sl: string): string[] {
  if (sl === "AL/MC") return ["AL", "AL/MC"];
  if (sl === "HC/MC") return ["HC", "HC/MC"];
  return [sl];
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 0);
  } catch {
    return "{}";
  }
}

function supportedTriggerFields(trigger: AnyRow): { supported: boolean; reason?: string } {
  const conditions = Array.isArray(trigger?.conditions) && trigger.conditions.length
    ? trigger.conditions
    : trigger?.condition?.field ? [trigger.condition] : [];
  const supported = new Set([
    "occupancy", "campus_occupancy", "service_line_occupancy", "room_type_occupancy",
    "room_type_occupancy_trailing3", "room_type_occupancy_trailing6", "room_type_occupancy_trailing12",
    "service_line_occupancy_trailing3", "service_line_occupancy_trailing6", "service_line_occupancy_trailing12",
    "occupancy_trailing3", "occupancy_trailing6", "occupancy_trailing12",
    "ih_street_variance", "street_to_ih_var", "street_to_comp_var",
    "competitor_variance", "competitor_rate",
  ]);
  const unsupported = conditions.find((condition: AnyRow) => !supported.has(String(condition.field)));
  return unsupported
    ? { supported: false, reason: `trigger metric "${unsupported.field}" is not formula-represented` }
    : { supported: true };
}

function triggerMetricCell(field: string, row: number): string | null {
  const cells: Record<string, string> = {
    occupancy: `K${row}`,
    campus_occupancy: `AC${row}`,
    service_line_occupancy: `AD${row}`,
    room_type_occupancy: `AE${row}`,
    ih_street_variance: `AF${row}`,
    street_to_ih_var: `AF${row}`,
    street_to_comp_var: `AG${row}`,
    competitor_variance: `AG${row}`,
    competitor_rate: `AG${row}`,
    campus_occupancy_trailing3: `AH${row}`,
    service_line_occupancy_trailing3: `AI${row}`,
    room_type_occupancy_trailing3: `AJ${row}`,
    occupancy_trailing3: `AH${row}`,
    campus_occupancy_trailing6: `AK${row}`,
    service_line_occupancy_trailing6: `AL${row}`,
    room_type_occupancy_trailing6: `AM${row}`,
    occupancy_trailing6: `AK${row}`,
    campus_occupancy_trailing12: `AN${row}`,
    service_line_occupancy_trailing12: `AO${row}`,
    room_type_occupancy_trailing12: `AP${row}`,
    occupancy_trailing12: `AN${row}`,
  };
  return cells[field] ?? null;
}

function conditionExpression(condition: AnyRow, row: number): string | null {
  const metric = triggerMetricCell(String(condition.field), row);
  if (!metric) return null;
  let threshold = Number(condition.value);
  const field = String(condition.field);
  if (
    field.includes("occupancy") ||
    field === "ih_street_variance" ||
    field === "street_to_ih_var"
  ) {
    if (Math.abs(threshold) > 1) threshold /= 100;
  }
  const op = [">=", ">", "<=", "<", "="].includes(condition.operator) ? condition.operator : "=";
  return `AND(ISNUMBER(${metric}),${metric}${op}${threshold})`;
}

function actionFilterExpression(rule: AnyRow, row: number): string {
  const filters = rule.action?.filters ?? {};
  const parts: string[] = [];
  if (rule.location_id) parts.push(`$A${row}="${excelText(rule.location_id)}"`);
  const scopedSL = Array.isArray(rule.service_lines) && rule.service_lines.length
    ? rule.service_lines : rule.service_line ? [rule.service_line] : [];
  if (scopedSL.length) {
    const options = scopedSL.flatMap((sl: string) => serviceLineFamily(sl))
      .map((sl: string) => `$E${row}="${excelText(sl)}"`);
    parts.push(`OR(${options.join(",")})`);
  }
  if (Array.isArray(filters.location) && filters.location.length) {
    parts.push(`OR(${filters.location.map((location: string) => `$D${row}="${excelText(location)}"`).join(",")})`);
  }
  if (Array.isArray(filters.serviceLine) && filters.serviceLine.length) {
    const options = filters.serviceLine.flatMap((sl: string) => serviceLineFamily(sl))
      .map((sl: string) => `$E${row}="${excelText(sl)}"`);
    parts.push(`OR(${options.join(",")})`);
  }
  if (Array.isArray(filters.roomType) && filters.roomType.length) {
    parts.push(`OR(${filters.roomType.map((roomType: string) =>
      `OR($F${row}="${excelText(roomType)}",$G${row}="${excelText(roomType)}")`).join(",")})`);
  }
  if (filters.occupancyStatus === "occupied") parts.push(`$J${row}>0`);
  if (filters.occupancyStatus === "vacant") parts.push(`$J${row}<$I${row}`);
  return parts.length ? `AND(${parts.join(",")})` : "TRUE";
}

function triggerExpression(rule: AnyRow, row: number): { expression: string; supported: boolean; reason?: string } {
  const trigger = rule.trigger ?? {};
  const support = supportedTriggerFields(trigger);
  const conditions = Array.isArray(trigger.conditions) && trigger.conditions.length
    ? trigger.conditions
    : trigger.condition?.field ? [trigger.condition] : [];
  if (!support.supported) return { expression: "FALSE", supported: false, reason: support.reason };
  if (!conditions.length) return { expression: "TRUE", supported: true };
  const expressions = conditions.map((condition: AnyRow) => conditionExpression(condition, row)).filter(Boolean) as string[];
  if (!expressions.length) return { expression: "TRUE", supported: true };
  const operator = String(trigger.conditionOperator ?? "AND").toUpperCase() === "OR" ? "OR" : "AND";
  return { expression: `${operator}(${expressions.join(",")})`, supported: true };
}

function addReadMe(
  wb: any,
  clientName: string,
  clientId: string,
  generatedAt: string,
  months: string[],
  activeRuleCount: number,
  rowCount: number,
) {
  const ws = wb.addWorksheet("Read Me", isStreamingWorkbook(wb) ? { views: [{ state: "frozen", ySplit: 1 }] } : undefined);
  ws.columns = [{ width: 28 }, { width: 42 }, { width: 76 }];
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = "Reference Data Calculation Audit Workbook";
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  ws.getCell("A1").alignment = { vertical: "middle" };
  ws.getRow(1).height = 28;
  const rows: Array<[string, any, string]> = [
    ["Export timestamp", generatedAt, "Point-in-time export. Formula cells recalculate when the workbook is opened in Excel."],
    ["Tenant", clientName, `Authenticated tenant scope: ${clientId}. The browser cannot choose a different tenant.`],
    ["Rent-roll periods", months.join(", "), "Latest 12 upload months available to this tenant, newest first."],
    ["Spot month", months[0] ?? "No rent-roll data", "The newest rent-roll month. Rule preview tabs evaluate this month only, matching Reference Data."],
    ["Calculation scope", `${rowCount.toLocaleString()} campus / service-line / room-type / month rows`, "Rows are created from tenant rent-roll combinations used by Reference Data."],
    ["Active implemented rules", activeRuleCount, "Only active, non-historical, implemented-compatible rules are included."],
    ["Yellow cells", "Source / reference values", "Copied from tenant source tables or metadata. They are not formula outputs."],
    ["Green cells", "Formula outputs", "Calculated in Excel from sheet-qualified source ranges."],
    ["Gray cells", "Reference / snapshot values", "Metadata, raw JSON, or a live-system decision that is intentionally not silently replayed."],
    ["Red cells", "Not formula-represented", "The workbook states why a legacy or unsupported shape was not turned into a misleading formula."],
  ];
  rows.forEach((values, index) => {
    const row = ws.addRow(values);
     row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.border = BORDER;
      cell.alignment = { vertical: "top", wrapText: true };
    });
    row.getCell(1).font = { bold: true };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: index >= 5 && index === 5 ? DESC_FILL : REFERENCE_FILL } };
    row.height = 30;
  });
  ws.addRow([]);
  const titleRow = ws.addRow(["Tab map", "Purpose", "Review tip"]);
   titleRow.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = BORDER;
  });
  const tabMap: Array<[string, string, string]> = [
    ["Location Data", "Current campus metadata.", "Confirm campus names and tenant ownership."],
    ["Rent Roll", "Latest 12 months of unit-level source data plus audit helpers.", "The final helper columns expose the rate gate and physical-room logic."],
    ["Inquiry Data", "Inquiry and tour source metrics.", "Location normalization is documented in Calculation Notes."],
    ["Competitive Survey", "Tenant survey rows used for competitor context.", "HC average rates are daily."],
    ["RT Occupancy History", "Authoritative occupancy and capacity source.", "Reference Data uses this before rent-roll occupancy."],
    ["Move Ins & Outs", "Deduped event source used for move-in metrics.", "Counted indicates the active deduped view."],
    ["Manual Overrides", "Current overrides and their latest audit metadata.", "A link jumps to the in-sheet history table."],
    ["Active Rules", "Implemented rule metadata and priority/specificity.", "Rule Audit tabs use this ordering."],
    ["Reference Data Audit", "Formula-driven output by group and month.", "Green cells are live formulas over the source tabs."],
    ["Rule Audit - ##", "One tab per active rule.", "Review filter match, trigger conditions, adjusted rate, and impact."],
    ["Calculation Notes", "Basis and intentional limitations.", "Read before changing source cells."],
  ];
  tabMap.forEach(values => {
    const row = ws.addRow(values);
    styleDataRow(row, WHITE_FILL);
    row.getCell(1).font = { bold: true };
  });
  setWorksheetViews(ws, wb, [{ state: "frozen", ySplit: 1 }]);
  return ws;
}

export interface BuildReferenceDataAuditWorkbookInput {
  clientId: string;
  generatedBy?: string | null;
}

export async function buildReferenceDataAuditWorkbook(
  input: BuildReferenceDataAuditWorkbookInput,
): Promise<string> {
  const { clientId } = input;
  const monthResult = await pool.query<{ m: string }>(
    `SELECT DISTINCT upload_month AS m
       FROM rent_roll_data
      WHERE client_id = $1 AND upload_month IS NOT NULL
      ORDER BY upload_month DESC
      LIMIT 12`,
    [clientId],
  );
  const months = monthResult.rows.map(row => row.m).filter(Boolean);
  const latestMonth = months[0] ?? null;
  const firstMonth = months[months.length - 1] ?? null;
  const endMonth = latestMonth ? nextMonth(latestMonth) : null;

  const [
    clientResult,
    locationResult,
    rentResult,
    inquiryResult,
    surveyResult,
    rtoResult,
    moveResult,
    overrideResult,
    overrideHistoryResult,
    ruleResult,
    groupingResult,
  ] = await Promise.all([
    pool.query(`SELECT id, name FROM clients WHERE id = $1`, [clientId]),
    pool.query(
      `SELECT id, name, location_code, region, division, location_class, address, city,
              state, zip_code, total_units, same_store, matrixcare_name_hc,
              matrixcare_name_al, matrixcare_name_il, customer_facility_id_hc,
              customer_facility_id_al, customer_facility_id_il
         FROM locations WHERE client_id = $1 ORDER BY name`,
      [clientId],
    ),
    months.length
      ? pool.query(
        `SELECT rr.id, rr.upload_month, rr.date, rr.location, rr.location_id, rr.room_number,
                rr.room_type, rr.service_line, rr.occupied_yn, rr.size, rr.street_rate,
                rr.in_house_rate, rr.days_vacant, rr.view, rr.renovated,
                rr.preferred_location, rr.other_premium_feature, rr.location_rating,
                rr.size_rating, rr.view_rating, rr.renovation_rating, rr.amenity_rating,
                rr.care_level, rr.care_rate, rr.rent_and_care_rate,
                rr.promotion_allowance, rr.resident_id, rr.resident_name, rr.move_in_date,
                rr.move_out_date, rr.payor_type, rr.competitor_base_rate,
                rr.competitor_final_rate, rr.source_room_type,
                COALESCE(rtg.group_name, rr.room_type) AS reference_room_type,
                loc.region, loc.division,
                rb.baseline_street, rb.baseline_ih
           FROM rent_roll_data rr
           LEFT JOIN room_type_groupings rtg
             ON rtg.client_id = rr.client_id
            AND rtg.location = rr.location
            AND rtg.service_line = rr.service_line
            AND rtg.source_room_type = rr.source_room_type
           LEFT JOIN locations loc
             ON loc.client_id = rr.client_id
            AND (loc.id = rr.location_id OR (rr.location_id IS NULL AND loc.name = rr.location))
           LEFT JOIN rate_baseline_v rb
             ON rb.client_id = rr.client_id
            AND rb.upload_month = rr.upload_month
            AND rb.location = rr.location
            AND rb.service_line IS NOT DISTINCT FROM rr.service_line
          WHERE rr.client_id = $1 AND rr.upload_month = ANY($2::text[])
          ORDER BY rr.upload_month DESC, rr.location, rr.service_line, rr.room_type, rr.room_number`,
        [clientId, months],
      )
      : Promise.resolve({ rows: [] }),
    months.length
      ? pool.query(
        `SELECT upload_month, date, location, inquiry_count, region, division,
                service_line, lead_source, tour_count, conversion_count,
                conversion_rate, days_to_tour, days_to_move_in
           FROM inquiry_metrics
          WHERE client_id = $1 AND upload_month = ANY($2::text[])
          ORDER BY upload_month DESC, location, service_line`,
        [clientId, months],
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT survey_month, keystats_location, competitor_name, competitor_address,
              distance_miles, competitor_type, room_type, square_footage,
              monthly_rate_low, monthly_rate_high, monthly_rate_avg, care_fees_avg,
              care_level_1_rate, care_level_2_rate, care_level_3_rate, care_level_4_rate,
              medication_management_fee, community_fee, pet_fee, incentives, total_units,
              occupancy_rate, year_built, notes, 1 AS weight
         FROM competitive_survey_data
        WHERE client_id = $1 OR client_id IS NULL
        ORDER BY survey_month DESC, keystats_location, competitor_name`,
      [clientId],
    ),
    months.length
      ? pool.query(
        `SELECT month::int AS month_number, year::int AS year_number, division,
                location_name, service_line, raw_room_type, normalized_room_type,
                occ_units, available_units, occ_percent
           FROM room_type_occupancy_history
          WHERE client_id = $1
            AND (year::text || '-' || LPAD(month::text, 2, '0')) = ANY($2::text[])
          ORDER BY year DESC, month DESC, location_name, service_line, normalized_room_type`,
        [clientId, months],
      )
      : Promise.resolve({ rows: [] }),
    firstMonth && endMonth
      ? pool.query(
        `SELECT id, event_type, census_id, division, location, dept, service_line,
                room_type, bed_type, room_name, payer, event_date, event_category,
                counted, import_format, patient_id
           FROM move_in_out_events_active
          WHERE client_id = $1 AND event_date >= $2 AND event_date < $3
          ORDER BY event_date, location, service_line`,
        [clientId, `${firstMonth}-01`, `${endMonth}-01`],
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT id, location_id, location_name, service_line, room_type, override_rate,
              notes, created_at, updated_at, created_by, updated_by
         FROM manual_rate_overrides
        WHERE client_id = $1
        ORDER BY location_name, service_line, room_type`,
      [clientId],
    ),
    pool.query(
      `SELECT id, override_id, location_id, location_name, service_line, room_type,
              event_type, previous_rate, new_rate, notes, changed_by, changed_at
         FROM manual_rate_override_history
        WHERE client_id = $1
        ORDER BY changed_at DESC, id DESC`,
      [clientId],
    ),
    pool.query(
      `SELECT id, client_id, name, description, priority, action, trigger, location_id,
              service_line, service_lines, effective_date, notes, lifecycle_status,
              implemented_at, is_active, is_historical, created_at, updated_at
         FROM adjustment_rules
        WHERE is_active = true
          AND COALESCE(is_historical, false) = false
          AND COALESCE(lifecycle_status, 'implemented') <> 'proposed'
          AND (location_id IS NULL OR location_id IN (
            SELECT id FROM locations WHERE client_id = $1
          ))
        ORDER BY priority DESC NULLS LAST, created_at ASC`,
      [clientId],
    ),
    pool.query(
      `SELECT location, service_line, source_room_type, group_name
         FROM room_type_groupings
        WHERE client_id = $1`,
      [clientId],
    ),
  ]);

  const clientName = clientResult.rows[0]?.name ?? clientId;
  const locationsById = new Map(locationResult.rows.map((row: AnyRow) => [row.id, row]));
  const groupingRows = groupingResult.rows as AnyRow[];
  const groupingMap = new Map<string, string>();
  groupingRows.forEach(row => groupingMap.set(
    `${row.location}||${row.service_line}||${row.source_room_type}`,
    row.group_name,
  ));
  const mapRtoRoomType = (row: AnyRow): string => {
    const exact = groupingMap.get(`${row.location_name}||${row.service_line}||${row.normalized_room_type}`);
    if (exact) return exact;
    const match = groupingRows.find(group =>
      group.location === row.location_name &&
      group.service_line === row.service_line &&
      String(group.source_room_type).toLowerCase() === String(row.normalized_room_type).toLowerCase());
    return match?.group_name ?? row.normalized_room_type;
  };

  const workbookDir = await mkdtemp(path.join(os.tmpdir(), "reference-data-audit-"));
  const workbookFilePath = path.join(workbookDir, REFERENCE_DATA_AUDIT_FILENAME);
  const wb: any = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: workbookFilePath,
    useStyles: true,
    useSharedStrings: false,
  });
  wb.creator = "Inflect";
  wb.created = new Date();
  if (wb.calcProperties) wb.calcProperties.fullCalcOnLoad = true;
  const worksheetRefs: any[] = [];
  worksheetRefs.push(addReadMe(wb, clientName, clientId, new Date().toISOString(), months, 0, 0));

  const locationRows = (locationResult.rows as AnyRow[]).map(row => [
    row.name, row.location_code, row.region, row.division, row.location_class,
    row.address, row.city, row.state, row.zip_code, row.total_units,
    row.same_store == null ? "" : row.same_store ? "Y" : "N",
    row.matrixcare_name_hc, row.matrixcare_name_al, row.matrixcare_name_il,
    row.customer_facility_id_hc, row.customer_facility_id_al, row.customer_facility_id_il,
  ]);
  const locationSheet = addSourceSheet(wb, "Location Data", LOCATION_HEADERS, SOURCE_DESCRIPTIONS["Location Data"], locationRows,
    [28, 14, 14, 14, 18, 30, 16, 8, 10, 12, 12, 22, 22, 22, 22, 22, 22]);
  worksheetRefs.push(locationSheet.ws);

  const rentRows = (rentResult.rows as AnyRow[]).map((row, index) => {
    const isPrivate = isPrivatePayer(row.payor_type);
    const isCompanion = isBBedRow(row.service_line, row.room_number);
    const streetIncluded = !isCompanion && Number(row.street_rate) > 0 &&
      passesStreetGate(Number(row.street_rate), row.baseline_street);
    const ihIncluded = Boolean(row.occupied_yn) &&
      !isCompanion &&
      Number(row.in_house_rate) > 0 &&
      (row.baseline_ih == null || Number(row.in_house_rate) >= RATE_OUTLIER_FLOOR_RATIO * Number(row.baseline_ih)) &&
      (!["HC", "HC/MC"].includes(row.service_line) || isPrivate);
    const physicalKey = physicalRoomKey(row);
    return [
      row.upload_month, row.date, row.location, row.room_number, row.room_type, row.service_line,
      row.occupied_yn ? "Y" : "N", row.size, row.street_rate, row.in_house_rate, row.days_vacant,
      row.view, row.renovated == null ? "" : row.renovated ? "Y" : "N", row.preferred_location,
      row.other_premium_feature, row.location_rating, row.size_rating, row.view_rating,
      row.renovation_rating, row.amenity_rating, row.care_level, row.care_rate,
      row.rent_and_care_rate, row.promotion_allowance, row.resident_id, row.resident_name,
      row.move_in_date, row.move_out_date, row.payor_type, row.id, row.source_room_type ?? row.room_type,
      row.reference_room_type ?? row.room_type, physicalKey, streetIncluded ? 1 : 0,
      ihIncluded ? 1 : 0, isPrivate ? 1 : 0,
      formula(`--(COUNTIF($AG$3:$AG${index + 3},AG${index + 3})=1)`),
      formula(`--AND(G${index + 3}="Y",COUNTIFS($AG$3:$AG${index + 3},AG${index + 3},$G$3:$G${index + 3},"Y")=1)`),
      row.competitor_base_rate, row.competitor_final_rate,
    ];
  });
  const rentSheet = addSourceSheet(wb, "Rent Roll", RENT_HEADERS, SOURCE_DESCRIPTIONS["Rent Roll"], rentRows,
    [14, 14, 24, 14, 18, 14, 13, 16, 13, 14, 13, 14, 11, 18, 22, 16, 13, 14, 17, 15, 13, 11, 17, 18, 14, 18, 14, 14, 16, 38, 20, 28, 48, 18, 20, 20, 20, 22]);
  worksheetRefs.push(rentSheet.ws);
  const inquiryRows = (inquiryResult.rows as AnyRow[]).map(row => [
    row.upload_month, row.date, row.location, row.inquiry_count, row.region, row.division,
    row.service_line, row.lead_source, row.tour_count, row.conversion_count,
    row.conversion_rate, row.days_to_tour, row.days_to_move_in,
  ]);
  const inquirySheet = addSourceSheet(wb, "Inquiry Data", INQUIRY_HEADERS, SOURCE_DESCRIPTIONS["Inquiry Data"], inquiryRows,
    [14, 14, 24, 14, 14, 14, 14, 20, 12, 16, 16, 15, 15]);
  worksheetRefs.push(inquirySheet.ws);

  const surveyRows = (surveyResult.rows as AnyRow[]).map(row => [
    row.survey_month, row.keystats_location, row.competitor_name, row.competitor_address,
    row.distance_miles, row.competitor_type, row.room_type, row.square_footage,
    row.monthly_rate_low, row.monthly_rate_high, row.monthly_rate_avg, row.care_fees_avg,
    row.care_level_1_rate, row.care_level_2_rate, row.care_level_3_rate, row.care_level_4_rate,
    row.medication_management_fee, row.community_fee, row.pet_fee, row.incentives,
    row.total_units, row.occupancy_rate, row.year_built, row.notes, row.weight,
  ]);
  const surveySheet = addSourceSheet(wb, "Competitive Survey", SURVEY_HEADERS, SOURCE_DESCRIPTIONS["Competitive Survey"], surveyRows,
    [14, 24, 28, 38, 16, 16, 18, 15, 16, 16, 16, 14, 16, 16, 16, 16, 22, 14, 10, 20, 12, 14, 12, 30, 8]);
  worksheetRefs.push(surveySheet.ws);

  const rtoRows = (rtoResult.rows as AnyRow[]).map(row => {
    const month = `${row.year_number}-${String(row.month_number).padStart(2, "0")}`;
    return [month, row.division, row.location_name, row.service_line, row.raw_room_type,
      row.occ_units, row.available_units, row.occ_percent, mapRtoRoomType(row)];
  });
  const rtoSheet = addSourceSheet(wb, "RT Occupancy History", RTO_HEADERS, SOURCE_DESCRIPTIONS["RT Occupancy History"], rtoRows,
    [14, 16, 28, 14, 34, 12, 20, 10, 28]);
  worksheetRefs.push(rtoSheet.ws);

  const moveRows = (moveResult.rows as AnyRow[]).map(row => {
    const eventDate = String(row.event_date ?? "");
    return [
      eventDate, row.location, row.dept, row.service_line, row.room_name, row.patient_id,
      row.payer, row.event_type === "move_in" ? "Admission" : "Discharge",
      row.event_category, 1, eventDate.slice(0, 7), row.event_type,
      row.counted ? "Y" : "N", row.id,
    ];
  });
  const moveSheet = addSourceSheet(wb, "Move Ins & Outs", MOVE_HEADERS, SOURCE_DESCRIPTIONS["Move Ins & Outs"], moveRows,
    [14, 28, 18, 16, 14, 18, 20, 16, 30, 12, 14, 14, 12, 38]);
  worksheetRefs.push(moveSheet.ws);

  const historyByKey = new Map<string, AnyRow[]>();
  (overrideHistoryResult.rows as AnyRow[]).forEach(row => {
    const key = `${row.location_name}||${row.service_line}||${row.room_type}`;
    const list = historyByKey.get(key) ?? [];
    list.push(row);
    historyByKey.set(key, list);
  });
  const manualHeaders = [
    "Location", "Service Line", "Room Type", "Current Override Rate", "Notes",
    "Created At", "Updated At", "Created By", "Updated By", "History Event Count",
    "Latest Previous Rate", "Latest Event", "Latest New Rate", "Latest Changed By",
    "Latest Changed At", "History Link",
  ];
  const historyStart = overrideResult.rows.length + 5;
  const historyRowByKey = new Map<string, number>();
  (overrideHistoryResult.rows as AnyRow[]).forEach((row, index) => {
    const key = `${row.location_name}||${row.service_line}||${row.room_type}`;
    if (!historyRowByKey.has(key)) historyRowByKey.set(key, historyStart + 2 + index);
  });
  const manualRows = (overrideResult.rows as AnyRow[]).map(row => {
    const history = historyByKey.get(`${row.location_name}||${row.service_line}||${row.room_type}`) ?? [];
    const latest = history[0];
    const historyRow = historyRowByKey.get(`${row.location_name}||${row.service_line}||${row.room_type}`);
    return [
      row.location_name, row.service_line, row.room_type, row.override_rate, row.notes,
      row.created_at, row.updated_at, row.created_by, row.updated_by, history.length,
      latest?.previous_rate ?? null, latest?.event_type ?? null, latest?.new_rate ?? null,
      latest?.changed_by ?? null, latest?.changed_at ?? null,
      historyRow ? { text: "Jump to history", hyperlink: `#'Manual Overrides'!A${historyRow}` } : null,
    ];
  });
  const manualSheet = addSourceSheet(wb, "Manual Overrides", manualHeaders,
    manualHeaders.map(header => header === "History Link" ? "Internal link to the history section below." : "Tenant-scoped current override metadata."),
    manualRows, [28, 14, 24, 20, 34, 22, 22, 22, 22, 18, 20, 16, 18, 22, 22, 18]);
  worksheetRefs.push(manualSheet.ws);
  const historyTitle = manualSheet.ws.addRow(["Override History (immutable events)"]);
  historyTitle.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1F3864" } };
  for (let index = 1; index <= manualHeaders.length; index++) {
    historyTitle.getCell(index).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_FILL } };
  }
  const historyHeaders = ["Location", "Service Line", "Room Type", "Event Type", "Previous Rate", "New Rate", "Notes", "Changed By", "Changed At", "Override ID", "History ID"];
  const historyHeaderRow = manualSheet.ws.addRow(historyHeaders);
  historyHeaders.forEach((header, index) => {
    const cell = historyHeaderRow.getCell(index + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = BORDER;
  });
  (overrideHistoryResult.rows as AnyRow[]).forEach((row, index) => {
    const data = manualSheet.ws.addRow([
      row.location_name, row.service_line, row.room_type, row.event_type, row.previous_rate,
      row.new_rate, row.notes, row.changed_by, row.changed_at, row.override_id, row.id,
    ]);
    styleDataRow(data, index % 2 === 0 ? WHITE_FILL : ALT_FILL);
    if (isStreamingWorkbook(wb)) data.commit();
  });
  setWorksheetViews(manualSheet.ws, wb, [{ state: "frozen", ySplit: 2 }]);

  const activeRules: AnyRow[] = (ruleResult.rows as AnyRow[])
    .map(rule => ({ ...rule, specificity: ruleSpecificity(rule) }))
    .sort((a: AnyRow, b: AnyRow) => b.specificity - a.specificity ||
      (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const ruleHeaders = [
    "Rule ID", "Name", "Priority", "Specificity", "Location ID", "Location",
    "Service Line Scope", "Action Target", "Adjustment Type", "Adjustment Value",
    "Filters JSON", "Trigger JSON", "Lifecycle", "Implemented At", "Effective Date",
    "Notes", "Formula Status",
  ];
  const ruleRows = activeRules.map(rule => {
    const location = rule.location_id ? locationsById.get(rule.location_id)?.name ?? "" : "";
    const triggerSupport = supportedTriggerFields(rule.trigger ?? {});
    const formulaStatus = rule.action?.target === "in_house_rate"
      ? "Not formula-represented: in-house target is not a Reference Data street-rule preview"
      : triggerSupport.supported ? "Formula represented" : `Not formula-represented: ${triggerSupport.reason}`;
    return [
      rule.id, rule.name, rule.priority ?? 0, rule.specificity, rule.location_id, location,
      (Array.isArray(rule.service_lines) && rule.service_lines.length ? rule.service_lines :
        rule.service_line ? [rule.service_line] : []).join(", "),
      rule.action?.target ?? "street_rate", rule.action?.adjustmentType ?? "percentage",
      Number(rule.action?.adjustmentValue ?? 0), jsonText(rule.action?.filters ?? {}),
      jsonText(rule.trigger ?? {}), rule.lifecycle_status ?? "implemented", rule.implemented_at,
      rule.effective_date, rule.notes, formulaStatus,
    ];
  });
  const activeRuleSheet = addSourceSheet(wb, "Active Rules", ruleHeaders,
    ruleHeaders.map(header => header === "Formula Status" ? "Explicit representation status; unsupported legacy shapes are not silently replayed." : "Implemented active-rule metadata."),
    ruleRows, [38, 34, 10, 12, 38, 28, 22, 18, 18, 18, 42, 42, 16, 22, 16, 34, 62]);
  worksheetRefs.push(activeRuleSheet.ws);

  const auditHeaders = [
    "Location ID", "Division", "Region", "Campus", "Service Line", "Room Type",
    "Source Room Type", "Month", "Total Units", "Occupied Units", "RT Occupancy",
    "Vacant Units", "Vacancy %", "Avg Days Vacant", "Street Rate", "Street Rate Basis",
    "In-House Rate", "In-House Rate Basis", "Competitor Base", "Competitor Adjusted",
    "Competitor Variance %", "Move-Ins Latest", "Move-Ins T3 Avg", "Move-Outs Latest",
    "Proposed Rule Rate", "Manual Override Rate", "Final Proposed Rate", "Rule Basis",
    "Campus Occupancy", "Service-Line Occupancy", "IH-to-Street Variance %",
    "Street-to-Comp Variance %", "Campus Occ T3", "SL Occ T3", "RT Occ T3",
    "Campus Occ T6", "SL Occ T6", "RT Occ T6", "Campus Occ T12", "SL Occ T12",
    "RT Occ T12", "Formula / Basis Notes", "Manual Override History",
  ];
  const auditWs = wb.addWorksheet("Reference Data Audit", isStreamingWorkbook(wb) ? { views: [{ state: "frozen", ySplit: 1, xSplit: 8 }] } : undefined);
  worksheetRefs.push(auditWs);
  auditWs.columns = auditHeaders.map(header => ({ header, key: header, width: header.length < 18 ? 16 : Math.min(34, header.length + 4) }));
  auditHeaders.forEach((header, index) => {
    const cell = auditWs.getCell(1, index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = BORDER;
  });
  auditWs.getRow(1).height = 34;
  const comboMap = new Map<string, AnyRow>();
  (rentResult.rows as AnyRow[]).forEach(row => {
    const refRoom = row.reference_room_type ?? row.room_type;
    const key = `${row.location_id ?? ""}||${row.location}||${row.service_line}||${refRoom}||${row.upload_month}`;
    if (!comboMap.has(key)) comboMap.set(key, {
      location_id: row.location_id ?? "",
      division: row.division ?? "—",
      region: row.region ?? "—",
      campus: row.location,
      service_line: row.service_line,
      room_type: refRoom,
      source_room_type: row.source_room_type ?? row.room_type,
      month: row.upload_month,
    });
  });
  const auditGroups = Array.from(comboMap.values()).sort((a, b) =>
    String(a.division).localeCompare(String(b.division)) ||
    String(a.campus).localeCompare(String(b.campus)) ||
    String(a.service_line).localeCompare(String(b.service_line)) ||
    String(a.room_type).localeCompare(String(b.room_type)) ||
    String(a.month).localeCompare(String(b.month)));
  const readMe = wb.getWorksheet("Read Me");
  if (readMe) {
    readMe.getCell("B6").value = `${auditGroups.length.toLocaleString()} campus / service-line / room-type / month rows`;
    readMe.getCell("B7").value = activeRules.length;
  }
  const rr = rentSheet;
  const rrRange = (header: string) => range(rr, header);
  const rtoRange = (header: string) => range(rtoSheet, header);
  const moveRange = (header: string) => range(moveSheet, header);
  const surveyRange = (header: string) => range(surveySheet, header);
  const sourceCriteria = (row: number): string[] => [
    rrRange("Location"), `$D${row}`,
    rrRange("Service Line"), `$E${row}`,
    rrRange("Reference Room Type"), `$F${row}`,
    rrRange("Upload Month"), `$H${row}`,
  ];
  const rtoCriteria = (row: number): string[] => [
    rtoRange("Campus"), `$D${row}`,
    rtoRange("Service Line"), `$E${row}`,
    rtoRange("Reference Room Type"), `$F${row}`,
    rtoRange("Month"), `$H${row}`,
  ];
  const moveCriteria = (row: number): string[] => [
    moveRange("Campus"), `$D${row}`,
    moveRange("Service Line"), `$E${row}`,
    moveRange("Event Month"), `$H${row}`,
    moveRange("Event Type"), `"move_in"`,
    moveRange("Counted"), `"Y"`,
  ];
  auditGroups.forEach((group, index) => {
    const rowNumber = index + 2;
    const row = auditWs.getRow(rowNumber);
    const values: any[] = [
      group.location_id, group.division, group.region, group.campus, group.service_line,
      group.room_type, group.source_room_type, group.month,
    ];
    values.forEach((value, cellIndex) => {
      row.getCell(cellIndex + 1).value = value;
      row.getCell(cellIndex + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: REFERENCE_FILL } };
      row.getCell(cellIndex + 1).border = BORDER;
    });
    const hasRto = `COUNTIFS(${rtoCriteria(rowNumber).join(",")})>0`;
    const totalFallback = `SUMIFS(${rrRange("Physical Room First")},${sourceCriteria(rowNumber).join(",")})`;
    const occupiedFallback = `SUMIFS(${rrRange("Physical Occupied First")},${sourceCriteria(rowNumber).join(",")})`;
    const totalFormula = `IF(${hasRto},SUMIFS(${rtoRange("Available Units/Beds")},${rtoCriteria(rowNumber).join(",")}),${totalFallback})`;
    const occupiedFormula = `IF(${hasRto},SUMIFS(${rtoRange("Occ Units")},${rtoCriteria(rowNumber).join(",")}),${occupiedFallback})`;
    addFormulaCell(row.getCell(9), totalFormula, FMT_INT);
    addFormulaCell(row.getCell(10), occupiedFormula, FMT_INT);
    addFormulaCell(row.getCell(11), `IFERROR(J${rowNumber}/I${rowNumber},"")`, FMT_PCT);
    addFormulaCell(row.getCell(12), `IF(I${rowNumber}="","",I${rowNumber}-J${rowNumber})`, FMT_INT);
    addFormulaCell(row.getCell(13), `IFERROR(L${rowNumber}/I${rowNumber},"")`, FMT_PCT);
    addFormulaCell(row.getCell(14), `IFERROR(AVERAGEIFS(${rrRange("Days Vacant")},${sourceCriteria(rowNumber).join(",")}),"")`, FMT_NUM);
    addFormulaCell(row.getCell(15), `IFERROR(AVERAGEIFS(${rrRange("Street Rate")},${sourceCriteria(rowNumber).join(",")},${rrRange("Street Rate Included")},1),"")`, FMT_MONEY);
    row.getCell(16).value = "Shared rate_baseline_v gate; B-bed rows excluded by source eligibility flag";
    row.getCell(16).fill = { type: "pattern", pattern: "solid", fgColor: { argb: REFERENCE_FILL } };
    row.getCell(16).alignment = { wrapText: true };
    addFormulaCell(row.getCell(17), `IFERROR(AVERAGEIFS(${rrRange("In-House Rate")},${sourceCriteria(rowNumber).join(",")},${rrRange("In-House Rate Included")},1),"")`, FMT_MONEY);
    row.getCell(18).value = "Occupied only; HC/HC-MC private-pay scope; shared outlier gate";
    row.getCell(18).fill = { type: "pattern", pattern: "solid", fgColor: { argb: REFERENCE_FILL } };
    row.getCell(18).alignment = { wrapText: true };
    addFormulaCell(row.getCell(19), `IFERROR(AVERAGEIFS(${rrRange("Competitor Base Rate")},${sourceCriteria(rowNumber).join(",")},${rrRange("Competitor Base Rate")},">0"),"")`, FMT_MONEY);
    addFormulaCell(row.getCell(20), `IFERROR(AVERAGEIFS(${rrRange("Competitor Adjusted Rate")},${sourceCriteria(rowNumber).join(",")},${rrRange("Competitor Adjusted Rate")},">100"),"")`, FMT_MONEY);
    addFormulaCell(row.getCell(21), `IFERROR((T${rowNumber}-O${rowNumber})/O${rowNumber},"")`, FMT_PCT);
    addFormulaCell(row.getCell(22), `SUMIFS(${moveRange("Move Ins")},${moveCriteria(rowNumber).join(",")})`, FMT_INT);
    addFormulaCell(row.getCell(23), `IFERROR(SUMIFS(${moveRange("Move Ins")},${moveRange("Campus")},$D${rowNumber},${moveRange("Service Line")},$E${rowNumber},${moveRange("Event Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-2),"yyyy-mm"),${moveRange("Event Month")},"<="&$H${rowNumber},${moveRange("Event Type")},"move_in",${moveRange("Counted")},"Y")/3,"")`, FMT_NUM);
    addFormulaCell(row.getCell(24), `SUMIFS(${moveRange("Move Ins")},${moveRange("Campus")},$D${rowNumber},${moveRange("Service Line")},$E${rowNumber},${moveRange("Event Month")},$H${rowNumber},${moveRange("Event Type")},"move_out",${moveRange("Counted")},"Y")`, FMT_INT);
    const ruleRateRefs: string[] = [];
    activeRules.forEach((_, ruleIndex) => {
      const ruleSheetName = `Rule Audit - ${String(ruleIndex + 1).padStart(2, "0")}`;
      const ruleRow = rowNumber;
      ruleRateRefs.push(`IF(${quoteSheet(ruleSheetName)}!$M${ruleRow}="Yes",${quoteSheet(ruleSheetName)}!$L${ruleRow},"")`);
    });
    const firstRuleRate = ruleRateRefs.reduceRight((fallback, ref) => ref.replace(/,""\)$/, `,${fallback})`), `""`);
    addFormulaCell(row.getCell(25), ruleRateRefs.length ? firstRuleRate : `""`, FMT_MONEY);
    const manualFormula = `IFERROR(SUMIFS(${quoteSheet("Manual Overrides")}!$D$3:$D$${Math.max(3, manualRows.length + 2)},${quoteSheet("Manual Overrides")}!$A$3:$A$${Math.max(3, manualRows.length + 2)},$D${rowNumber},${quoteSheet("Manual Overrides")}!$B$3:$B$${Math.max(3, manualRows.length + 2)},$E${rowNumber},${quoteSheet("Manual Overrides")}!$C$3:$C$${Math.max(3, manualRows.length + 2)},$F${rowNumber}),"")`;
    addFormulaCell(row.getCell(26), manualFormula, FMT_MONEY);
    addFormulaCell(row.getCell(27), `IF(Z${rowNumber}<>"",Z${rowNumber},Y${rowNumber})`, FMT_MONEY);
    addFormulaCell(row.getCell(28), `IF(Z${rowNumber}<>"","Manual override",IF(Y${rowNumber}<>"","First matching rule by specificity/priority","No rule rate"))`);
    addFormulaCell(row.getCell(29), `IFERROR(SUMIFS(${rtoRange("Occ Units")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Month")},$H${rowNumber})/SUMIFS(${rtoRange("Available Units/Beds")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Month")},$H${rowNumber}),IFERROR(SUMIFS(${rrRange("Physical Occupied First")},${rrRange("Location")},$D${rowNumber},${rrRange("Upload Month")},$H${rowNumber})/SUMIFS(${rrRange("Physical Room First")},${rrRange("Location")},$D${rowNumber},${rrRange("Upload Month")},$H${rowNumber}),""))`, FMT_PCT);
    addFormulaCell(row.getCell(30), `IFERROR(SUMIFS(${rtoRange("Occ Units")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Service Line")},$E${rowNumber},${rtoRange("Month")},$H${rowNumber})/SUMIFS(${rtoRange("Available Units/Beds")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Service Line")},$E${rowNumber},${rtoRange("Month")},$H${rowNumber}),IFERROR(SUMIFS(${rrRange("Physical Occupied First")},${rrRange("Location")},$D${rowNumber},${rrRange("Service Line")},$E${rowNumber},${rrRange("Upload Month")},$H${rowNumber})/SUMIFS(${rrRange("Physical Room First")},${rrRange("Location")},$D${rowNumber},${rrRange("Service Line")},$E${rowNumber},${rrRange("Upload Month")},$H${rowNumber}),""))`, FMT_PCT);
    addFormulaCell(row.getCell(31), `IFERROR((Q${rowNumber}-O${rowNumber})/O${rowNumber},"")`, FMT_PCT);
    addFormulaCell(row.getCell(32), `IFERROR((T${rowNumber}-O${rowNumber})/O${rowNumber},"")`, FMT_PCT);
    const occFormula = (window: number) => `IFERROR(SUMIFS(${rtoRange("Occ Units")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-${window - 1}),"yyyy-mm"),${rtoRange("Month")},"<="&$H${rowNumber})/SUMIFS(${rtoRange("Available Units/Beds")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-${window - 1}),"yyyy-mm"),${rtoRange("Month")},"<="&$H${rowNumber}),"")`;
    const slOccFormula = (window: number) => `IFERROR(SUMIFS(${rtoRange("Occ Units")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Service Line")},$E${rowNumber},${rtoRange("Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-${window - 1}),"yyyy-mm"),${rtoRange("Month")},"<="&$H${rowNumber})/SUMIFS(${rtoRange("Available Units/Beds")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Service Line")},$E${rowNumber},${rtoRange("Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-${window - 1}),"yyyy-mm"),${rtoRange("Month")},"<="&$H${rowNumber}),"")`;
    const rtOccFormula = (window: number) => `IFERROR(SUMIFS(${rtoRange("Occ Units")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Service Line")},$E${rowNumber},${rtoRange("Reference Room Type")},$F${rowNumber},${rtoRange("Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-${window - 1}),"yyyy-mm"),${rtoRange("Month")},"<="&$H${rowNumber})/SUMIFS(${rtoRange("Available Units/Beds")},${rtoRange("Campus")},$D${rowNumber},${rtoRange("Service Line")},$E${rowNumber},${rtoRange("Reference Room Type")},$F${rowNumber},${rtoRange("Month")},">="&TEXT(EDATE(DATEVALUE($H${rowNumber}&"-01"),-${window - 1}),"yyyy-mm"),${rtoRange("Month")},"<="&$H${rowNumber}),"")`;
    [[33, 3], [36, 6], [39, 12]].forEach(([campusColumn, window]) => {
      addFormulaCell(row.getCell(campusColumn), occFormula(window), FMT_PCT);
      addFormulaCell(row.getCell(campusColumn + 1), slOccFormula(window), FMT_PCT);
      addFormulaCell(row.getCell(campusColumn + 2), rtOccFormula(window), FMT_PCT);
    });
    row.getCell(42).value = "Formula cells use RTO first, then rent-roll physical-room fallback; source flags carry the shared rate gate and payer scope.";
    row.getCell(42).fill = { type: "pattern", pattern: "solid", fgColor: { argb: REFERENCE_FILL } };
    row.getCell(42).alignment = { wrapText: true };
    const manualHistory = historyByKey.get(`${group.campus}||${group.service_line}||${group.room_type}`)?.[0];
    if (manualHistory) {
      row.getCell(43).value = { text: "View override history", hyperlink: `#'Manual Overrides'!A${historyRowByKey.get(`${group.campus}||${group.service_line}||${group.room_type}`)}` };
      row.getCell(43).font = { color: { argb: "FF0563C1" }, underline: "single" };
    } else {
      row.getCell(43).value = "No history row";
    }
    for (let index = 1; index <= auditHeaders.length; index++) {
      row.getCell(index).border = BORDER;
      row.getCell(index).alignment = { vertical: "top", wrapText: index === 16 || index === 18 || index === 28 || index >= 42 };
    }
    row.height = 32;
    if (isStreamingWorkbook(wb)) row.commit();
  });
  auditWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, auditGroups.length + 1), column: auditHeaders.length } };
  setWorksheetViews(auditWs, wb, [{ state: "frozen", ySplit: 1, xSplit: 8 }]);
  auditWs.getColumn(15).numFmt = FMT_MONEY;
  auditWs.getColumn(17).numFmt = FMT_MONEY;
  auditWs.getColumn(19).numFmt = FMT_MONEY;
  auditWs.getColumn(20).numFmt = FMT_MONEY;
  auditWs.getColumn(25).numFmt = FMT_MONEY;
  auditWs.getColumn(26).numFmt = FMT_MONEY;
  auditWs.getColumn(27).numFmt = FMT_MONEY;

  activeRules.forEach((rule, ruleIndex) => {
    const suffix = String(ruleIndex + 1).padStart(2, "0");
    const ws = wb.addWorksheet(`Rule Audit - ${suffix}`, isStreamingWorkbook(wb) ? { views: [{ state: "frozen", ySplit: 1, xSplit: 5 }] } : undefined);
    const headers = [
      "Audit Row", "Campus", "Service Line", "Room Type", "Month", "Filter Match",
      "Trigger Conditions", "Base Rate", "Adjustment", "Adjusted Rate", "Move-Ins T3 Avg",
      "Monthly Impact", "Selected by Priority", "Formula Status", "Raw Trigger", "Raw Filters",
    ];
    ws.columns = headers.map(header => ({ header, key: header, width: header.length < 18 ? 16 : Math.min(46, header.length + 5) }));
    headers.forEach((header, index) => {
      const cell = ws.getCell(1, index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = BORDER;
    });
    ws.getRow(1).height = 34;
    const status = ruleRows[ruleIndex]?.[16] ?? "";
    auditGroups.forEach((_, groupIndex) => {
      const auditRow = groupIndex + 2;
      const ruleRow = groupIndex + 2;
      const row = ws.getRow(ruleRow);
      row.getCell(1).value = auditRow;
      row.getCell(2).value = formula(`=${quoteSheet("Reference Data Audit")}!$D$${auditRow}`);
      row.getCell(3).value = formula(`=${quoteSheet("Reference Data Audit")}!$E$${auditRow}`);
      row.getCell(4).value = formula(`=${quoteSheet("Reference Data Audit")}!$F$${auditRow}`);
      row.getCell(5).value = formula(`=${quoteSheet("Reference Data Audit")}!$H$${auditRow}`);
      const filterExpr = actionFilterExpression(rule, auditRow);
      const trigger = triggerExpression(rule, auditRow);
      row.getCell(6).value = formula(`=IF(${quoteSheet("Reference Data Audit")}!$H$${auditRow}<>${quoteSheet("Read Me")}!$B$5,"No",IF(${filterExpr},"Yes","No"))`);
      row.getCell(7).value = formula(`=IF($F${ruleRow}<>"Yes","No",IF(${trigger.expression},"Yes","No"))`);
      const base = rule.action?.target === "care_rate" ? `$Q${auditRow}` : `$O${auditRow}`;
      row.getCell(8).value = formula(`=IF(OR($F${ruleRow}<>"Yes",$G${ruleRow}<>"Yes"),"",${quoteSheet("Reference Data Audit")}!${base})`, FMT_MONEY);
      const adjType = rule.action?.adjustmentType ?? "percentage";
      const adjValue = Number(rule.action?.adjustmentValue ?? 0);
      const adjustmentFormula = adjType === "fixed" ? `${adjValue}` : `(1+${adjValue}/100)`;
      row.getCell(9).value = adjType === "fixed" ? adjValue : adjValue / 100;
      row.getCell(10).value = formula(`=IF($H${ruleRow}="","",IF("${adjType}"="fixed",$H${ruleRow}+${adjustmentFormula},$H${ruleRow}*${adjustmentFormula}))`, FMT_MONEY);
      row.getCell(11).value = formula(`=${quoteSheet("Reference Data Audit")}!$W$${auditRow}`, FMT_NUM);
      row.getCell(12).value = formula(`=IF(OR($J${ruleRow}="",$H${ruleRow}=""),"",($J${ruleRow}-$H${ruleRow})*$K${ruleRow})`, FMT_MONEY);
      row.getCell(13).value = formula(`=IF(AND($F${ruleRow}="Yes",$G${ruleRow}="Yes"),"Yes","No")`);
      row.getCell(14).value = status;
      row.getCell(15).value = jsonText(rule.trigger ?? {});
      row.getCell(16).value = jsonText(rule.action?.filters ?? {});
      for (let cellIndex = 1; cellIndex <= headers.length; cellIndex++) {
        row.getCell(cellIndex).border = BORDER;
        row.getCell(cellIndex).alignment = { vertical: "top", wrapText: cellIndex >= 14 };
        if ([1, 2, 3, 4, 5, 9, 14, 15, 16].includes(cellIndex)) {
          row.getCell(cellIndex).fill = { type: "pattern", pattern: "solid", fgColor: { argb: REFERENCE_FILL } };
        } else if ([6, 7, 8, 10, 11, 12, 13].includes(cellIndex)) {
          row.getCell(cellIndex).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FORMULA_FILL } };
        }
      }
      if (!trigger.supported || rule.action?.target === "in_house_rate") {
        row.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNING_FILL } };
      }
      if (isStreamingWorkbook(wb)) row.commit();
    });
    worksheetRefs.push(ws);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, auditGroups.length + 1), column: headers.length } };
    setWorksheetViews(ws, wb, [{ state: "frozen", ySplit: 1, xSplit: 5 }]);
    ws.getColumn(8).numFmt = FMT_MONEY;
    ws.getColumn(9).numFmt = (rule.action?.adjustmentType ?? "percentage") === "fixed" ? FMT_MONEY : FMT_PCT;
    ws.getColumn(10).numFmt = FMT_MONEY;
    ws.getColumn(11).numFmt = FMT_NUM;
    ws.getColumn(12).numFmt = FMT_MONEY;
  });

  const notes = wb.addWorksheet("Calculation Notes", isStreamingWorkbook(wb) ? { views: [{ state: "frozen", ySplit: 1 }] } : undefined);
  worksheetRefs.push(notes);
  notes.columns = [{ width: 30 }, { width: 110 }];
  const noteRows: Array<[string, string]> = [
    ["Unit of analysis", "Reference Data Audit has one row per campus + service line + Reference Data room-type group + rent-roll upload month. Active-rule previews are evaluated on the latest spot month, matching the live Reference Data rule preview."],
    ["Source periods", "Rent Roll and Inquiry Data use the latest 12 rent-roll upload months available for the authenticated tenant. Move Ins & Outs uses the same bounded month window. Competitive Survey is tenant-scoped plus intentionally shared rows with NULL client_id."],
    ["Occupancy precedence", "RT Occupancy History is authoritative for available units and occupied units whenever a matching campus/service-line/room-type/month row exists. The formulas fall back to distinct physical-room rent-roll flags only when history has no matching row."],
    ["B-bed treatment", "Senior-housing room numbers with a /B, /C, etc. suffix share a physical room. The Rent Roll helper columns reduce them to one physical room for capacity and occupancy fallback, and rate eligibility excludes those companion rows. HC and HC/MC beds remain separate."],
    ["Payer scope", "In-house averages use occupied rows and the shared rate outlier gate. HC and HC/MC additionally require the shared private-pay predicate; senior housing is not payer-filtered for this measure."],
    ["Rate basis", "AL, AL/MC, SL, and VIL rates are monthly. HC and HC/MC source rates are daily. The workbook preserves the source basis and does not convert daily rates into monthly dollars."],
    ["Street-rate gate", `Rent Roll eligibility flags are calculated using the shared rate_baseline_v decision at export time (relative floor ${RATE_OUTLIER_FLOOR_RATIO} of the applicable baseline). The audit formulas average only eligible rows.`],
    ["Competitor values", "Competitor columns are formula-linked to the rent-roll values used by the live Reference Data snapshot. Latest-survey coverage and care-adjusted benchmark details remain visible in the source survey tab rather than being silently reconstructed."],
    ["Move-ins", "Move-in formulas use counted rows from the deduped active event view. The T3 value is the bounded three-month event total divided by three; a zero means data exists but no counted event matched."],
    ["Manual overrides", "A manual override is shown separately and wins over the formula-driven rule preview in Final Proposed Rate. The in-sheet history section preserves current links and immutable audit events."],
    ["Rule precedence", "Rule Audit tabs are ordered by specificity, then priority, then creation order, matching the active Reference Data preview ordering. Reference Data Audit takes the first matching selected rule, then applies manual override precedence."],
    ["Unsupported legacy shapes", "A trigger field not in the supported formula catalog, or an in_house_rate target that is not a Reference Data street-rule preview, is marked Not formula-represented with raw JSON. It is never replaced by a blanket TRUE formula."],
    ["Formula recalculation", "ExcelJS writes formulas and requests full calculation on load. Excel or another compatible spreadsheet engine must recalculate formulas; the workbook is intentionally not a pasted static report."],
  ];
  const noteHeader = notes.addRow(["Topic", "Basis"]);
   noteHeader.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = BORDER;
  });
  noteRows.forEach((values, index) => {
    const row = notes.addRow(values);
    styleDataRow(row, index % 2 === 0 ? WHITE_FILL : ALT_FILL);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.height = 54;
    if (isStreamingWorkbook(wb)) row.commit();
  });
  setWorksheetViews(notes, wb, [{ state: "frozen", ySplit: 1 }]);

  delete (globalThis as any).__auditRentSheet;
  worksheetRefs.forEach(ws => ws.commit?.());
  await wb.commit();
  return workbookFilePath;
}