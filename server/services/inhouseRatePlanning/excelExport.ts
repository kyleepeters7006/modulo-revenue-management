/**
 * In-House Rate Planning — Excel export.
 *
 * The point of this workbook is that it is auditable. Every number a resident
 * receives is written as a LIVE Excel formula over labelled input cells, not as
 * a pasted value, so an operator can change the maximum increase (or the street
 * multiplier, or a single resident's current rate) and watch the totals move.
 *
 * ── The one value that is not a formula ────────────────────────────────────
 * `lambda` is the scalar the solver bisects for: every resident's increase is
 * `clamp(lambda * shape, min, max)`, and lambda is chosen so the revenue-
 * weighted average lands exactly on the required target. A bisection has no
 * closed form, so it cannot be written as a cell formula. It is therefore
 * exported as a solved INPUT, clearly labelled, with the achieved average
 * written next to it as a live formula — so the reconciliation is visible, and
 * Excel's Goal Seek can re-derive lambda if an operator changes an assumption.
 *
 * ── One rate space ─────────────────────────────────────────────────────────
 * Everything here is in normalized MONTHLY dollars, exactly as the solver works.
 * HC and HC/MC bill daily; for those the workbook adds explicit daily columns
 * derived from the monthly figure rather than mixing the two bases in one
 * column, which would be wrong by roughly 30x.
 */
import ExcelJS from "exceljs";
import type { PlanResult } from "@shared/inhousePlanning";
import { DAYS_PER_MONTH } from "@shared/careRates";
import { RATE_PRODUCT_LABEL } from "@shared/rateProduct";
import type { PlanAudit } from "./index";
import { injectCharts, type ChartSpec } from "../xlsxCharts";

// ── formats ────────────────────────────────────────────────────────────────
/** Money: comma separated, no decimals, as requested. */
const FMT_MONEY = '#,##0;[Red]-#,##0';
/** Money that can legitimately be zero-or-negative and should read as a delta. */
const FMT_DELTA = '+#,##0;[Red]-#,##0;0';
const FMT_PCT = "0.0%";
const FMT_PCT2 = "0.00%";
const FMT_INT = "#,##0";
const FMT_NUM2 = "#,##0.00";
const FMT_DATE = "yyyy-mm-dd";

const HEADER_FILL = "FF1F3864";
const SUBHEAD_FILL = "FFD9E2F3";
const TOTAL_FILL = "FFFFF2CC";
const INPUT_FILL = "FFFFF9E6";
const BAND_FILL = "FFF7F9FC";
const SNAPSHOT_FILL = "FFEDEDED";

const CONSTRAINT_LABEL: Record<string, string> = {
  none: "Formula",
  min: "Held up to minimum",
  max: "Capped at maximum",
  street_cap: "Capped at street",
  at_or_above_street: "Already at/above street",
};

/**
 * What the street rate in this row is the asking rate FOR, and where it came
 * from when it is not the resident's own unit. "Single occupant" rows carry no
 * note; anything else is stated outright so a reviewer can audit the ceiling.
 */
function streetBasisLabel(r: {
  rateProduct: keyof typeof RATE_PRODUCT_LABEL;
  streetRateSource: string;
  streetRateMonthly: number;
}): string {
  if (r.streetRateMonthly <= 0) return "None available";
  const product = RATE_PRODUCT_LABEL[r.rateProduct];
  switch (r.streetRateSource) {
    case "product_median":
      return `${product} (campus median)`;
    case "service_line_median":
      return `${product} (service-line median)`;
    case "derived_formula":
      return `${product} (derived formula)`;
    default:
      return product;
  }
}

function styleHeaderRow(row: ExcelJS.Row, fill = HEADER_FILL) {
  row.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFBFBFBF" } },
      left: { style: "thin", color: { argb: "FFBFBFBF" } },
      bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
      right: { style: "thin", color: { argb: "FFBFBFBF" } },
    };
  });
  row.height = 30;
}

function sectionTitle(ws: ExcelJS.Worksheet, rowIx: number, text: string, span: number) {
  const row = ws.getRow(rowIx);
  row.getCell(1).value = text;
  row.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1F3864" } };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_FILL } };
  for (let c = 2; c <= span; c++) {
    row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_FILL } };
  }
  row.height = 20;
  return row;
}

/** A labelled input cell: the operator is meant to change these. */
function inputRow(
  ws: ExcelJS.Worksheet,
  rowIx: number,
  label: string,
  value: ExcelJS.CellValue,
  numFmt?: string,
  note?: string,
) {
  const row = ws.getRow(rowIx);
  row.getCell(1).value = label;
  row.getCell(1).font = { bold: true };
  const v = row.getCell(2);
  v.value = value;
  if (numFmt) v.numFmt = numFmt;
  v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
  v.border = {
    top: { style: "thin", color: { argb: "FFD0B060" } },
    left: { style: "thin", color: { argb: "FFD0B060" } },
    bottom: { style: "thin", color: { argb: "FFD0B060" } },
    right: { style: "thin", color: { argb: "FFD0B060" } },
  };
  v.alignment = { horizontal: "right" };
  if (note) {
    row.getCell(3).value = note;
    row.getCell(3).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    row.getCell(3).alignment = { wrapText: true, vertical: "middle" };
  }
  return row;
}

/** A computed cell: a live formula, shaded differently from inputs. */
function formulaRow(
  ws: ExcelJS.Worksheet,
  rowIx: number,
  label: string,
  formula: string,
  numFmt?: string,
  note?: string,
) {
  const row = ws.getRow(rowIx);
  row.getCell(1).value = label;
  row.getCell(1).font = { bold: true };
  const v = row.getCell(2);
  v.value = { formula } as ExcelJS.CellFormulaValue;
  if (numFmt) v.numFmt = numFmt;
  v.alignment = { horizontal: "right" };
  if (note) {
    row.getCell(3).value = note;
    row.getCell(3).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    row.getCell(3).alignment = { wrapText: true, vertical: "middle" };
  }
  return row;
}

/** A plain context cell: neither an input nor a formula. */
function labelRow(
  ws: ExcelJS.Worksheet,
  rowIx: number,
  label: string,
  value: ExcelJS.CellValue,
  note?: string,
) {
  const row = ws.getRow(rowIx);
  row.getCell(1).value = label;
  row.getCell(1).font = { bold: true };
  row.getCell(2).value = value;
  row.getCell(2).alignment = { horizontal: "right" };
  if (note) {
    row.getCell(3).value = note;
    row.getCell(3).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    row.getCell(3).alignment = { wrapText: true, vertical: "middle" };
  }
  return row;
}

/**
 * A value carried over from the solve that this workbook genuinely cannot
 * recompute. Shaded distinctly from the yellow inputs so nobody edits it
 * expecting the sheet to respond.
 */
function snapshotRow(
  ws: ExcelJS.Worksheet,
  rowIx: number,
  label: string,
  value: ExcelJS.CellValue,
  numFmt?: string,
  note?: string,
) {
  const row = labelRow(ws, rowIx, label, value, note);
  const v = row.getCell(2);
  if (numFmt) v.numFmt = numFmt;
  v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SNAPSHOT_FILL } };
  v.font = { color: { argb: "FF555555" } };
  v.border = {
    top: { style: "thin", color: { argb: "FFC0C0C0" } },
    left: { style: "thin", color: { argb: "FFC0C0C0" } },
    bottom: { style: "thin", color: { argb: "FFC0C0C0" } },
    right: { style: "thin", color: { argb: "FFC0C0C0" } },
  };
  return row;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function addMonthsToKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export interface BuildExportInput {
  plan: PlanResult;
  audit: PlanAudit;
  /** Who generated it, for the provenance line. */
  generatedBy?: string;
}

export async function buildRatePlanWorkbook(input: BuildExportInput): Promise<Buffer> {
  const { plan, audit } = input;
  const daily = plan.rateBasis === "daily";

  // Every total, weighted average and chart range on the other sheets is built
  // over the resident block. With no residents those ranges invert (the last
  // data row would fall above the first), which Excel reads as a corrupt file
  // rather than an empty one. The service already refuses to produce an empty
  // plan; fail loudly here too rather than emitting a broken workbook.
  if (audit.residents.length === 0) {
    throw new Error(
      "Rate plan export: this plan has no residents in scope, so there is nothing to export.",
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Rate Planning";
  wb.created = new Date();

  const wsSummary = wb.addWorksheet("Plan summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const wsDetail = wb.addWorksheet("Resident detail");
  const wsMoveIn = wb.addWorksheet("Move-in trends");
  const wsHistory = wb.addWorksheet("Rate history");
  const wsMethod = wb.addWorksheet("Method");

  // Detail is built first: the summary's totals are formulas over its rows.
  const detail = buildDetailSheet(wsDetail, plan, audit, daily);
  buildSummarySheet(wsSummary, plan, audit, daily, detail, input.generatedBy);
  const moveIn = buildMoveInSheet(wsMoveIn, plan, audit);
  const history = buildHistorySheet(wsHistory, plan, audit);
  buildMethodSheet(wsMethod, plan, audit, daily, detail);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const charts: ChartSpec[] = [];
  if (moveIn.cohortRows > 0) {
    charts.push({
      sheetName: "Move-in trends",
      type: "bar",
      title: "Residents by move-in year",
      valueAxisFormat: FMT_INT,
      series: [
        {
          name: "Residents",
          categoriesRef: `'Move-in trends'!$A$${moveIn.cohortFirst}:$A$${moveIn.cohortLast}`,
          valuesRef: `'Move-in trends'!$B$${moveIn.cohortFirst}:$B$${moveIn.cohortLast}`,
        },
      ],
      anchor: { fromCol: 9, fromRow: moveIn.cohortFirst - 2, toCol: 17, toRow: moveIn.cohortFirst + 14 },
    });
    charts.push({
      sheetName: "Move-in trends",
      type: "line",
      title: "Current rate vs street rate by move-in year",
      valueAxisFormat: FMT_INT,
      series: [
        {
          name: "Average current rate",
          categoriesRef: `'Move-in trends'!$A$${moveIn.cohortFirst}:$A$${moveIn.cohortLast}`,
          valuesRef: `'Move-in trends'!$C$${moveIn.cohortFirst}:$C$${moveIn.cohortLast}`,
          color: "4472C4",
        },
        {
          name: "Average street rate",
          categoriesRef: `'Move-in trends'!$A$${moveIn.cohortFirst}:$A$${moveIn.cohortLast}`,
          valuesRef: `'Move-in trends'!$D$${moveIn.cohortFirst}:$D$${moveIn.cohortLast}`,
          color: "ED7D31",
        },
      ],
      anchor: { fromCol: 9, fromRow: moveIn.cohortFirst + 16, toCol: 17, toRow: moveIn.cohortFirst + 32 },
    });
  }
  if (moveIn.recentRows > 0) {
    charts.push({
      sheetName: "Move-in trends",
      type: "bar",
      title: "Move-ins per month (last 24 months)",
      valueAxisFormat: FMT_INT,
      series: [
        {
          name: "Move-ins",
          categoriesRef: `'Move-in trends'!$A$${moveIn.recentFirst}:$A$${moveIn.recentLast}`,
          valuesRef: `'Move-in trends'!$B$${moveIn.recentFirst}:$B$${moveIn.recentLast}`,
          color: "70AD47",
        },
      ],
      anchor: { fromCol: 9, fromRow: moveIn.recentFirst - 2, toCol: 17, toRow: moveIn.recentFirst + 14 },
    });
  }
  if (history.monthRows > 0) {
    charts.push({
      sheetName: "Rate history",
      type: "line",
      title: "Realized in-house rate by month",
      valueAxisFormat: FMT_INT,
      series: [
        {
          name: "Realized rate (monthly equivalent)",
          categoriesRef: `'Rate history'!$A$${history.monthFirst}:$A$${history.monthLast}`,
          valuesRef: `'Rate history'!$B$${history.monthFirst}:$B$${history.monthLast}`,
        },
      ],
      anchor: { fromCol: 6, fromRow: history.monthFirst - 2, toCol: 15, toRow: history.monthFirst + 16 },
    });
  }
  if (history.quarterRows > 0) {
    charts.push({
      sheetName: "Rate history",
      type: "bar",
      title: "Projected vs prior-year rate by quarter",
      valueAxisFormat: FMT_INT,
      series: [
        {
          name: "Prior year",
          categoriesRef: `'Rate history'!$A$${history.quarterFirst}:$A$${history.quarterLast}`,
          valuesRef: `'Rate history'!$B$${history.quarterFirst}:$B$${history.quarterLast}`,
          color: "A5A5A5",
        },
        {
          name: "Projected with this plan",
          categoriesRef: `'Rate history'!$A$${history.quarterFirst}:$A$${history.quarterLast}`,
          valuesRef: `'Rate history'!$C$${history.quarterFirst}:$C$${history.quarterLast}`,
          color: "4472C4",
        },
      ],
      anchor: { fromCol: 8, fromRow: history.quarterFirst - 2, toCol: 17, toRow: history.quarterFirst + 16 },
    });
  }

  return injectCharts(buffer, charts);
}

// ── Resident detail ────────────────────────────────────────────────────────

interface DetailLayout {
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  totalRow: number;
  count: number;
  col: Record<string, string>;
}

function buildDetailSheet(
  ws: ExcelJS.Worksheet,
  plan: PlanResult,
  audit: PlanAudit,
  daily: boolean,
): DetailLayout {
  // Column letters are referenced from the summary and method sheets, so the
  // order is fixed here once and read from `col` everywhere else.
  const columns: Array<{ key: string; header: string; width: number; fmt?: string }> = [
    { key: "campus", header: "Campus", width: 26 },
    { key: "room", header: "Room", width: 10 },
    { key: "roomType", header: "Room type", width: 18 },
    { key: "care", header: "Care level", width: 12 },
    { key: "payor", header: "Payor", width: 14 },
    { key: "moveIn", header: "Move-in date", width: 13, fmt: FMT_DATE },
    { key: "tenure", header: "Tenure (months)", width: 11, fmt: FMT_INT },
    { key: "companion", header: "Companion bed", width: 11 },
    { key: "weight", header: "Resident-day weight", width: 12, fmt: FMT_NUM2 },
    { key: "current", header: "Current rate (monthly)", width: 14, fmt: FMT_MONEY },
    { key: "street", header: "Street rate (monthly)", width: 14, fmt: FMT_MONEY },
    // The street rate is the asking rate for the PRODUCT this resident
    // occupies — a second-occupant rate for a companion bed, a semi-private
    // rate for a shared health-care bed. Without this column a reader has no
    // way to tell why two residents in the same building face different
    // ceilings, and would reasonably assume one of them is wrong.
    { key: "product", header: "Street rate basis", width: 22 },
    { key: "effStreet", header: "Effective street\n= street x multiplier", width: 15, fmt: FMT_MONEY },
    { key: "headroom", header: "Room to street\n= eff street / current - 1", width: 14, fmt: FMT_PCT },
    { key: "shape", header: "Shape\n= (headroom / mean) ^ exponent", width: 13, fmt: FMT_NUM2 },
    { key: "minEff", header: "Min allowed", width: 11, fmt: FMT_PCT },
    { key: "maxEff", header: "Max allowed", width: 11, fmt: FMT_PCT },
    { key: "raw", header: "Uncapped\n= lambda x shape", width: 12, fmt: FMT_PCT },
    { key: "increase", header: "Increase %\n= MEDIAN(min, uncapped, max)", width: 13, fmt: FMT_PCT2 },
    { key: "increaseDollars", header: "Increase $ / month", width: 13, fmt: FMT_DELTA },
    { key: "newRate", header: "New rate (monthly)", width: 14, fmt: FMT_MONEY },
    { key: "newGap", header: "New room to street", width: 13, fmt: FMT_PCT },
    { key: "annual", header: "Increase $ / year", width: 13, fmt: FMT_DELTA },
    { key: "revenueWeight", header: "Revenue weight\n= weight x current", width: 14, fmt: FMT_INT },
    { key: "constraint", header: "What limited it", width: 22 },
  ];
  if (daily) {
    columns.push(
      { key: "currentDaily", header: "Current rate (daily)", width: 13, fmt: FMT_NUM2 },
      { key: "newDaily", header: "New rate (daily)", width: 13, fmt: FMT_NUM2 },
    );
  }

  const col: Record<string, string> = {};
  columns.forEach((c, i) => {
    col[c.key] = colLetter(i + 1);
    const column = ws.getColumn(i + 1);
    column.width = c.width;
    if (c.fmt) column.numFmt = c.fmt;
  });

  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value =
    `Resident detail — every column from "Effective street" onward is a live Excel formula. ` +
    `Change an assumption on "Plan summary" and this sheet recalculates.`;
  titleRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(1, 1, 1, columns.length);

  const headerRow = 2;
  const hr = ws.getRow(headerRow);
  columns.forEach((c, i) => (hr.getCell(i + 1).value = c.header));
  styleHeaderRow(hr);

  const firstDataRow = headerRow + 1;
  // Inputs live on the summary sheet; refer to them absolutely.
  const S = "'Plan summary'!";
  const refLambda = `${S}$B$${SUMMARY_CELLS.lambda}`;
  const refExponent = `${S}$B$${SUMMARY_CELLS.exponent}`;
  const refMinInc = `${S}$B$${SUMMARY_CELLS.minIncrease}`;
  const refMaxInc = `${S}$B$${SUMMARY_CELLS.maxIncrease}`;
  const refAllowAbove = `${S}$B$${SUMMARY_CELLS.allowAboveStreet}`;
  const refMultiplier = `${S}$B$${SUMMARY_CELLS.streetMultiplier}`;
  const refMeanHeadroom = `${S}$B$${SUMMARY_CELLS.meanHeadroom}`;
  const refSourceMonth = `${S}$B$${SUMMARY_CELLS.sourceMonth}`;

  audit.residents.forEach((r, i) => {
    const rowIx = firstDataRow + i;
    const row = ws.getRow(rowIx);
    const c = (key: string) => `${col[key]}${rowIx}`;

    row.getCell(1).value = r.location;
    row.getCell(2).value = r.roomNumber;
    row.getCell(3).value = r.roomType ?? "";
    row.getCell(4).value = r.careLevel ?? "";
    row.getCell(5).value = r.payorType ?? "";
    row.getCell(6).value = r.moveInDate ? new Date(`${r.moveInDate}T00:00:00Z`) : "";
    // Tenure as of the rent-roll month the population was read from.
    row.getCell(7).value = r.moveInDate
      ? ({
          formula: `IF(${c("moveIn")}="","",DATEDIF(${c("moveIn")},DATE(VALUE(LEFT(${refSourceMonth},4)),VALUE(RIGHT(${refSourceMonth},2)),1),"m"))`,
        } as ExcelJS.CellFormulaValue)
      : "";
    row.getCell(8).value = r.isCompanionBed ? "Yes" : "";
    row.getCell(9).value = r.weight;
    row.getCell(10).value = r.currentRateMonthly;
    row.getCell(11).value = r.streetRateMonthly;

    // ── the derivation, as live formulas ──
    const idx = (key: string) => columns.findIndex((x) => x.key === key) + 1;
    row.getCell(idx("product")).value = streetBasisLabel(r);
    const setF = (key: string, formula: string) => {
      row.getCell(idx(key)).value = { formula } as ExcelJS.CellFormulaValue;
    };

    setF("effStreet", `IF(${c("street")}>0,${c("street")}*${refMultiplier},0)`);
    // No usable street rate means no evidence of a ceiling, so the configured
    // maximum is the only bound — mirroring computeBounds().
    setF(
      "headroom",
      `IF(AND(${c("effStreet")}>0,${c("current")}>0),MAX(0,${c("effStreet")}/${c("current")}-1),${refMaxInc})`,
    );
    setF(
      "shape",
      `IF(OR(${refExponent}=0,${refMeanHeadroom}<=0),1,(${c("headroom")}/${refMeanHeadroom})^${refExponent})`,
    );
    setF(
      "maxEff",
      `MAX(0,IF(${refAllowAbove}=TRUE,${refMaxInc},MIN(${refMaxInc},${c("headroom")})))`,
    );
    setF("minEff", `MIN(MAX(0,${refMinInc}),${c("maxEff")})`);
    setF("raw", `${refLambda}*${c("shape")}`);
    // MEDIAN of (floor, value, ceiling) is exactly clamp() and stays correct
    // when the floor has been pushed down to meet the ceiling.
    setF("increase", `MEDIAN(${c("minEff")},${c("raw")},${c("maxEff")})`);
    setF("increaseDollars", `${c("current")}*${c("increase")}`);
    setF("newRate", `${c("current")}*(1+${c("increase")})`);
    setF("newGap", `IF(${c("effStreet")}>0,${c("effStreet")}/${c("newRate")}-1,"")`);
    setF("annual", `${c("increaseDollars")}*12`);
    setF("revenueWeight", `${c("weight")}*${c("current")}`);
    row.getCell(idx("constraint")).value = CONSTRAINT_LABEL[r.constraint] ?? r.constraint;
    if (daily) {
      setF("currentDaily", `${c("current")}/${DAYS_PER_MONTH}`);
      setF("newDaily", `${c("newRate")}/${DAYS_PER_MONTH}`);
    }

    if (i % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
      });
    }
  });

  const count = audit.residents.length;
  const lastDataRow = firstDataRow + Math.max(0, count - 1);
  const totalRow = lastDataRow + 1;

  // ── totals ──
  const tr = ws.getRow(totalRow);
  const idxOf = (key: string) => columns.findIndex((x) => x.key === key) + 1;
  const range = (key: string) => `${col[key]}${firstDataRow}:${col[key]}${lastDataRow}`;

  tr.getCell(1).value = `TOTAL — ${count.toLocaleString()} resident${count === 1 ? "" : "s"}`;
  tr.getCell(idxOf("weight")).value = { formula: `SUM(${range("weight")})` } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("current")).value = { formula: `SUM(${range("current")})` } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("street")).value = { formula: `SUM(${range("street")})` } as ExcelJS.CellFormulaValue;
  // The headline average is revenue weighted, exactly as the solver defines it.
  tr.getCell(idxOf("increase")).value = {
    formula: `IF(SUM(${range("revenueWeight")})=0,0,SUMPRODUCT(${range("revenueWeight")},${range("increase")})/SUM(${range("revenueWeight")}))`,
  } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("increaseDollars")).value = {
    formula: `SUM(${range("increaseDollars")})`,
  } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("newRate")).value = { formula: `SUM(${range("newRate")})` } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("annual")).value = { formula: `SUM(${range("annual")})` } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("revenueWeight")).value = {
    formula: `SUM(${range("revenueWeight")})`,
  } as ExcelJS.CellFormulaValue;
  tr.getCell(idxOf("constraint")).value = {
    formula: `COUNTIF(${range("constraint")},"Formula")&" free, "&COUNTIF(${range("constraint")},"Capped at street")&" street-capped"`,
  } as ExcelJS.CellFormulaValue;

  tr.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = { top: { style: "double", color: { argb: "FF1F3864" } } };
  });
  tr.getCell(idxOf("increase")).numFmt = FMT_PCT2;

  // Freeze the header AND the three identity columns, so scrolling right
  // through the derivation keeps campus / room / room type in view.
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: headerRow, topLeftCell: `D${firstDataRow}` }];
  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastDataRow, column: columns.length },
  };

  return { headerRow, firstDataRow, lastDataRow, totalRow, count, col };
}

// ── Plan summary ───────────────────────────────────────────────────────────

/**
 * Fixed row numbers for the summary sheet. The detail sheet's formulas point at
 * these absolutely, so they are declared once here rather than being discovered
 * while writing — a shifted row would silently repoint every resident's formula
 * at the wrong assumption, producing a workbook that is wrong but looks fine.
 * `assertSummaryLayout` re-reads the finished sheet and fails the export if a
 * label ever drifts away from its declared row.
 */
const SUMMARY_CELLS = {
  // Scope — context, not arithmetic.
  sourceMonth: 6,
  campus: 7,
  serviceLine: 8,

  // Live inputs: every one of these feeds a formula somewhere.
  minIncrease: 11,
  maxIncrease: 12,
  equalizationLabel: 13,
  exponent: 14,
  allowAboveStreet: 15,
  streetEffective: 16,
  inhouseEffective: 17,
  currentStreet: 18,
  recommendedStreet: 19,
  lambda: 20,

  // Derived from the block above.
  streetIncrease: 23,
  streetMultiplier: 24,
  meanHeadroom: 25,
  achievedAvg: 26,

  // Recorded from the projection — genuinely NOT recalculated here.
  growthTarget: 29,
  turnover: 30,
  requiredAvg: 31,
  reconcile: 32,
} as const;

/**
 * The label each row must carry, verified after the sheet is written. This is
 * the guard that makes the hard-coded row numbers above safe to depend on.
 */
const SUMMARY_LABELS: Record<keyof typeof SUMMARY_CELLS, string> = {
  sourceMonth: "Rent roll month",
  campus: "Campus",
  serviceLine: "Service line",
  minIncrease: "Minimum increase per resident",
  maxIncrease: "Maximum increase per resident",
  equalizationLabel: "Equalization strength",
  exponent: "Equalization exponent",
  allowAboveStreet: "Allow in-house above street",
  streetEffective: "Street rate effective date",
  inhouseEffective: "In-house effective date",
  currentStreet: "Current street rate (monthly)",
  recommendedStreet: "Recommended street rate (monthly)",
  lambda: "Lambda (solved calibration scalar)",
  streetIncrease: "Street increase",
  streetMultiplier: "Street multiplier at in-house date",
  meanHeadroom: "Mean room to street (revenue weighted)",
  achievedAvg: "Achieved weighted-average increase",
  growthTarget: "Annual rate growth target",
  turnover: "Annual resident turnover",
  requiredAvg: "Required weighted-average increase",
  reconcile: "Reconciliation (achieved - required)",
};

function assertSummaryLayout(ws: ExcelJS.Worksheet) {
  for (const [key, row] of Object.entries(SUMMARY_CELLS)) {
    const expected = SUMMARY_LABELS[key as keyof typeof SUMMARY_CELLS];
    const actual = String(ws.getRow(row).getCell(1).value ?? "").trim();
    if (actual !== expected) {
      throw new Error(
        `Rate plan export: summary row ${row} should be "${expected}" but is "${actual}". ` +
          `The detail sheet's formulas reference these rows absolutely, so the layout and ` +
          `SUMMARY_CELLS must be corrected together before this workbook can be trusted.`,
      );
    }
  }
}

function buildSummarySheet(
  ws: ExcelJS.Worksheet,
  plan: PlanResult,
  audit: PlanAudit,
  daily: boolean,
  detail: DetailLayout,
  generatedBy?: string,
) {
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 76;

  const L = SUMMARY_LABELS;
  const C = SUMMARY_CELLS;

  const title = ws.getRow(1);
  title.getCell(1).value = "In-House Rate Planning";
  title.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F3864" } };
  title.height = 24;

  ws.getRow(2).getCell(1).value =
    `${plan.scope.location ?? "All campuses"} · ${plan.scope.serviceLine} · rent roll ${plan.scope.sourceMonth}` +
    (daily ? " · billed daily" : " · billed monthly");
  ws.getRow(2).getCell(1).font = { size: 11, color: { argb: "FF444444" } };

  ws.getRow(3).getCell(1).value =
    `Generated ${new Date().toISOString().slice(0, 10)}${generatedBy ? ` by ${generatedBy}` : ""}. ` +
    `Yellow cells drive live formulas — edit one and the workbook recalculates. ` +
    `Grey cells are recorded from the projection and do NOT recalculate here.`;
  ws.getRow(3).getCell(1).font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // ── scope ──
  sectionTitle(ws, 5, "SCOPE", 3);
  labelRow(ws, C.sourceMonth, L.sourceMonth, plan.scope.sourceMonth,
    "The month the resident population was read from. Tenure on the detail sheet is measured to here.");
  labelRow(ws, C.campus, L.campus, plan.scope.location ?? "All campuses");
  labelRow(ws, C.serviceLine, L.serviceLine, plan.scope.serviceLine);

  // ── live inputs ──
  sectionTitle(ws, 10, "LIVE INPUTS — edit any of these and the workbook recalculates", 3);
  inputRow(ws, C.minIncrease, L.minIncrease, plan.assumptions.minInhouseIncreasePct / 100, FMT_PCT);
  inputRow(ws, C.maxIncrease, L.maxIncrease, plan.assumptions.maxInhouseIncreasePct / 100, FMT_PCT);
  labelRow(ws, C.equalizationLabel, L.equalizationLabel, plan.assumptions.equalizationStrength,
    "A name for the exponent below, which is the value the formulas actually use.");
  inputRow(ws, C.exponent, L.exponent, audit.equalizationExponent, FMT_NUM2,
    "0 = everyone gets the same increase. 1 = increases scale fully with room to street. 0.5 = half way.");
  inputRow(ws, C.allowAboveStreet, L.allowAboveStreet, plan.assumptions.allowInhouseAboveStreet, undefined,
    "When FALSE a resident's new rate may never pass their street rate, which caps their increase at their room to street.");
  inputRow(ws, C.streetEffective, L.streetEffective, plan.assumptions.streetRateEffectiveDate, undefined,
    "Held as text in ISO form so the date comparison below sorts correctly.");
  inputRow(ws, C.inhouseEffective, L.inhouseEffective, plan.assumptions.inhouseEffectiveDate, undefined,
    "If this lands on or after the street date, residents are measured against the RAISED street rate.");
  inputRow(ws, C.currentStreet, L.currentStreet, audit.currentStreetRateMonthly, FMT_MONEY,
    "Average street rate across the scope, excluding companion (B) beds.");
  inputRow(ws, C.recommendedStreet, L.recommendedStreet, audit.recommendedStreetRateMonthly, FMT_MONEY,
    "Solved alongside lambda. Editable here so you can test a different street move.");
  inputRow(ws, C.lambda, L.lambda, audit.lambda, FMT_PCT2,
    "The calibration scalar: each resident's increase is MEDIAN(min, lambda x shape, max). It is found by " +
    "bisection so the revenue-weighted average lands on the target — a search with no closed form, so it " +
    "cannot be a cell formula and is published here as a solved input. After changing anything above, " +
    "re-solve it with Data > What-If Analysis > Goal Seek: set the achieved average to the required average " +
    "by changing this cell.");

  // ── derived ──
  const D = "'Resident detail'!";
  const rw = `${D}$${detail.col.revenueWeight}$${detail.firstDataRow}:$${detail.col.revenueWeight}$${detail.lastDataRow}`;
  const hd = `${D}$${detail.col.headroom}$${detail.firstDataRow}:$${detail.col.headroom}$${detail.lastDataRow}`;
  const inc = `${D}$${detail.col.increase}$${detail.firstDataRow}:$${detail.col.increase}$${detail.lastDataRow}`;

  sectionTitle(ws, 22, "DERIVED FROM THE INPUTS ABOVE", 3);
  formulaRow(ws, C.streetIncrease, L.streetIncrease,
    `IF(B${C.currentStreet}=0,0,B${C.recommendedStreet}/B${C.currentStreet}-1)`, FMT_PCT,
    "Raising street rate is the only lever that creates in-house headroom.");
  // Mirrors streetMultiplierAtInhouse(): the raised street rate only applies if
  // the street increase has already landed by the in-house effective date. An
  // empty date means no comparison is possible, which resolves to no uplift.
  formulaRow(ws, C.streetMultiplier, L.streetMultiplier,
    `IF(AND(B${C.streetEffective}<>"",B${C.inhouseEffective}<>"",B${C.streetEffective}<=B${C.inhouseEffective}),` +
      `1+B${C.streetIncrease},1)`,
    FMT_NUM2,
    "1.00 when the in-house increase lands before the street increase; otherwise 1 + street increase. " +
    "This is the ceiling that applies on the in-house effective date, and it drives every resident's room to street.");
  formulaRow(ws, C.meanHeadroom, L.meanHeadroom,
    `IF(SUM(${rw})=0,0,SUMPRODUCT(${rw},${hd})/SUM(${rw}))`, FMT_PCT2,
    "The shape curve is normalized by this, which is what makes lambda read as 'the average increase'.");
  formulaRow(ws, C.achievedAvg, L.achievedAvg,
    `IF(SUM(${rw})=0,0,SUMPRODUCT(${rw},${inc})/SUM(${rw}))`, FMT_PCT2,
    "Live from the detail sheet. This is the cell to Goal Seek when re-solving lambda.");

  // ── snapshot ──
  sectionTitle(ws, 28, "RECORDED FROM THE PROJECTION — these do NOT recalculate here", 3);
  snapshotRow(ws, C.growthTarget, L.growthTarget, plan.assumptions.rateGrowthTargetPct / 100, FMT_PCT,
    "Year-over-year realized-rate growth the plan has to deliver.");
  snapshotRow(ws, C.turnover, L.turnover, plan.assumptions.annualTurnoverPct / 100, FMT_PCT,
    "Residents replaced each year; replacements enter at the street rate in force that day.");
  snapshotRow(ws, C.requiredAvg, L.requiredAvg, plan.requiredWeightedAvgIncreasePct / 100, FMT_PCT2,
    "What the growth target needs. It comes from the quarter-by-quarter projection on the Rate history " +
    "sheet, which simulates turnover day by day — that simulation is not reproducible as a spreadsheet " +
    "formula, so changing the target or turnover above will NOT move this number. Recalculate the plan " +
    "in the app to get a new one.");
  formulaRow(ws, C.reconcile, L.reconcile, `B${C.achievedAvg}-B${C.requiredAvg}`, FMT_PCT2,
    "Zero means the plan delivers exactly the target. Non-zero means a guardrail is binding — see the plan status below.");

  // ── results ──
  sectionTitle(ws, 34, "RESULT — all live formulas over the resident detail sheet", 3);
  const cur = `${D}$${detail.col.current}$${detail.firstDataRow}:$${detail.col.current}$${detail.lastDataRow}`;
  const dol = `${D}$${detail.col.increaseDollars}$${detail.firstDataRow}:$${detail.col.increaseDollars}$${detail.lastDataRow}`;
  const ann = `${D}$${detail.col.annual}$${detail.firstDataRow}:$${detail.col.annual}$${detail.lastDataRow}`;
  const nrt = `${D}$${detail.col.newRate}$${detail.firstDataRow}:$${detail.col.newRate}$${detail.lastDataRow}`;
  const con = `${D}$${detail.col.constraint}$${detail.firstDataRow}:$${detail.col.constraint}$${detail.lastDataRow}`;

  let r = 35;
  formulaRow(ws, r++, "Residents in plan", `COUNT(${cur})`, FMT_INT);
  formulaRow(ws, r++, "Residents receiving an increase", `COUNTIF(${inc},">0")`, FMT_INT);
  formulaRow(ws, r++, "Held at the minimum", `COUNTIF(${con},"${CONSTRAINT_LABEL.min}")`, FMT_INT);
  formulaRow(ws, r++, "Capped at the maximum", `COUNTIF(${con},"${CONSTRAINT_LABEL.max}")`, FMT_INT);
  formulaRow(ws, r++, "Capped by street rate", `COUNTIF(${con},"${CONSTRAINT_LABEL.street_cap}")`, FMT_INT);
  formulaRow(ws, r++, "Already at or above street", `COUNTIF(${con},"${CONSTRAINT_LABEL.at_or_above_street}")`, FMT_INT,
    "These residents get nothing: there is no room below street to move into.");
  r++;
  formulaRow(ws, r++, "Average current rate (monthly)", `IFERROR(AVERAGE(${cur}),0)`, FMT_MONEY);
  formulaRow(ws, r++, "Average new rate (monthly)", `IFERROR(AVERAGE(${nrt}),0)`, FMT_MONEY);
  formulaRow(ws, r++, "Smallest increase", `IFERROR(MIN(${inc}),0)`, FMT_PCT2);
  formulaRow(ws, r++, "Largest increase", `IFERROR(MAX(${inc}),0)`, FMT_PCT2);
  r++;
  const monthlyRow = r;
  formulaRow(ws, r++, "TOTAL INCREASE PER MONTH", `SUM(${dol})`, FMT_MONEY,
    "The revenue this plan adds every month once the in-house effective date passes.");
  const annualRow = r;
  formulaRow(ws, r++, "TOTAL INCREASE PER YEAR", `SUM(${ann})`, FMT_MONEY,
    "Twelve months at the new rates. Not a forecast — turnover and move-outs are modelled on the Rate history sheet.");
  formulaRow(ws, r++, "Total current monthly revenue", `SUM(${cur})`, FMT_MONEY);
  formulaRow(ws, r++, "Total new monthly revenue", `SUM(${nrt})`, FMT_MONEY);
  formulaRow(ws, r++, "Revenue lift", `IF(SUM(${cur})=0,0,SUM(${nrt})/SUM(${cur})-1)`, FMT_PCT2);

  for (const highlight of [monthlyRow, annualRow]) {
    const cell = ws.getRow(highlight).getCell(2);
    cell.font = { bold: true, size: 12 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    ws.getRow(highlight).getCell(1).font = { bold: true, size: 12 };
  }

  r++;
  sectionTitle(ws, r++, "PLAN STATUS", 3);
  ws.getRow(r).getCell(1).value = "Target reachable as configured";
  ws.getRow(r).getCell(1).font = { bold: true };
  ws.getRow(r).getCell(2).value = plan.feasible ? "Yes" : "No";
  ws.getRow(r).getCell(2).font = { bold: true, color: { argb: plan.feasible ? "FF206020" : "FFB00000" } };
  r++;
  if (plan.bindingQuarterLabel) {
    ws.getRow(r).getCell(1).value = "Binding quarter";
    ws.getRow(r).getCell(1).font = { bold: true };
    ws.getRow(r).getCell(2).value = plan.bindingQuarterLabel;
    r++;
  }
  if (plan.infeasibility) {
    ws.getRow(r).getCell(1).value = "Why not";
    ws.getRow(r).getCell(1).font = { bold: true };
    ws.getRow(r).getCell(3).value = plan.infeasibility.message;
    ws.getRow(r).getCell(3).alignment = { wrapText: true, vertical: "top" };
    r++;
  }

  if (plan.warnings.length) {
    r++;
    sectionTitle(ws, r++, "DATA QUALITY WARNINGS", 3);
    for (const w of plan.warnings) {
      ws.getRow(r).getCell(3).value = w;
      ws.getRow(r).getCell(3).alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).getCell(1).value = "•";
      r++;
    }
  }

  assertSummaryLayout(ws);
}

// ── Move-in trends ─────────────────────────────────────────────────────────

interface MoveInLayout {
  cohortFirst: number;
  cohortLast: number;
  cohortRows: number;
  recentFirst: number;
  recentLast: number;
  recentRows: number;
}

function buildMoveInSheet(ws: ExcelJS.Worksheet, plan: PlanResult, audit: PlanAudit): MoveInLayout {
  ws.getColumn(1).width = 16;
  for (let c = 2; c <= 8; c++) ws.getColumn(c).width = 16;

  ws.getRow(1).getCell(1).value = "Move-in trends";
  ws.getRow(1).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
  ws.getRow(2).getCell(1).value =
    "Tenure is what creates room to street: a resident who moved in years ago is further below today's street rate, " +
    "so the equalization curve gives them a larger increase. These tables are the evidence behind that.";
  ws.getRow(2).getCell(1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, 8);
  ws.getRow(2).height = 28;

  // ── cohorts by move-in year ──
  interface Bucket {
    label: string;
    count: number;
    current: number;
    street: number;
    headroom: number;
    increaseDollars: number;
    weightedIncrease: number;
    revenueWeight: number;
  }
  const byYear = new Map<string, Bucket>();
  const blank = (label: string): Bucket => ({
    label, count: 0, current: 0, street: 0, headroom: 0, increaseDollars: 0, weightedIncrease: 0, revenueWeight: 0,
  });

  for (const r of audit.residents) {
    const label = r.moveInDate ? r.moveInDate.slice(0, 4) : "Unknown";
    const b = byYear.get(label) ?? blank(label);
    b.count += 1;
    b.current += r.currentRateMonthly;
    b.street += r.streetRateMonthly;
    b.headroom += r.headroom;
    b.increaseDollars += r.currentRateMonthly * r.increase;
    const w = r.weight * r.currentRateMonthly;
    b.weightedIncrease += w * r.increase;
    b.revenueWeight += w;
    byYear.set(label, b);
  }

  const cohorts = Array.from(byYear.values()).sort((a, b) => {
    if (a.label === "Unknown") return 1;
    if (b.label === "Unknown") return -1;
    return a.label.localeCompare(b.label);
  });

  const cohortHeaderRow = 4;
  sectionTitle(ws, cohortHeaderRow - 1, "RESIDENTS BY MOVE-IN YEAR", 8);
  const ch = ws.getRow(cohortHeaderRow);
  ["Move-in year", "Residents", "Avg current rate", "Avg street rate", "Avg room to street",
   "Weighted increase", "Increase $/month", "Share of residents"].forEach((h, i) => (ch.getCell(i + 1).value = h));
  styleHeaderRow(ch);

  const cohortFirst = cohortHeaderRow + 1;
  cohorts.forEach((b, i) => {
    const row = ws.getRow(cohortFirst + i);
    row.getCell(1).value = b.label;
    row.getCell(2).value = b.count;
    row.getCell(2).numFmt = FMT_INT;
    row.getCell(3).value = b.count ? b.current / b.count : 0;
    row.getCell(3).numFmt = FMT_MONEY;
    row.getCell(4).value = b.count ? b.street / b.count : 0;
    row.getCell(4).numFmt = FMT_MONEY;
    row.getCell(5).value = b.count ? b.headroom / b.count : 0;
    row.getCell(5).numFmt = FMT_PCT;
    row.getCell(6).value = b.revenueWeight ? b.weightedIncrease / b.revenueWeight : 0;
    row.getCell(6).numFmt = FMT_PCT2;
    row.getCell(7).value = b.increaseDollars;
    row.getCell(7).numFmt = FMT_MONEY;
    row.getCell(8).value = { formula: `IF($B$${cohortFirst + cohorts.length}=0,0,B${cohortFirst + i}/$B$${cohortFirst + cohorts.length})` } as ExcelJS.CellFormulaValue;
    row.getCell(8).numFmt = FMT_PCT;
  });
  const cohortLast = cohortFirst + Math.max(0, cohorts.length - 1);
  const cohortTotal = cohortFirst + cohorts.length;
  const ctr = ws.getRow(cohortTotal);
  ctr.getCell(1).value = "TOTAL";
  ctr.getCell(2).value = { formula: `SUM(B${cohortFirst}:B${cohortLast})` } as ExcelJS.CellFormulaValue;
  ctr.getCell(2).numFmt = FMT_INT;
  ctr.getCell(7).value = { formula: `SUM(G${cohortFirst}:G${cohortLast})` } as ExcelJS.CellFormulaValue;
  ctr.getCell(7).numFmt = FMT_MONEY;
  ctr.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = { top: { style: "double", color: { argb: "FF1F3864" } } };
  });

  // ── move-ins per month, last 24 months of the rent roll ──
  const recentHeaderRow = cohortTotal + 3;
  sectionTitle(ws, recentHeaderRow - 1, "MOVE-INS PER MONTH (LAST 24 MONTHS)", 8);
  const rh = ws.getRow(recentHeaderRow);
  ["Month", "Move-ins", "Avg rate they came in at", "Avg room to street today"].forEach(
    (h, i) => (rh.getCell(i + 1).value = h),
  );
  styleHeaderRow(rh);

  const end = monthKey(`${plan.scope.sourceMonth}-01`);
  const months: string[] = [];
  for (let i = 23; i >= 0; i--) months.push(addMonthsToKey(end, -i));

  const recent = new Map<string, { n: number; rate: number; headroom: number }>();
  for (const m of months) recent.set(m, { n: 0, rate: 0, headroom: 0 });
  for (const r of audit.residents) {
    if (!r.moveInDate) continue;
    const k = r.moveInDate.slice(0, 7);
    const slot = recent.get(k);
    if (!slot) continue;
    slot.n += 1;
    slot.rate += r.currentRateMonthly;
    slot.headroom += r.headroom;
  }

  const recentFirst = recentHeaderRow + 1;
  months.forEach((m, i) => {
    const slot = recent.get(m)!;
    const row = ws.getRow(recentFirst + i);
    row.getCell(1).value = m;
    row.getCell(2).value = slot.n;
    row.getCell(2).numFmt = FMT_INT;
    row.getCell(3).value = slot.n ? slot.rate / slot.n : 0;
    row.getCell(3).numFmt = FMT_MONEY;
    row.getCell(4).value = slot.n ? slot.headroom / slot.n : 0;
    row.getCell(4).numFmt = FMT_PCT;
  });
  const recentLast = recentFirst + months.length - 1;
  const rtr = ws.getRow(recentLast + 1);
  rtr.getCell(1).value = "TOTAL";
  rtr.getCell(2).value = { formula: `SUM(B${recentFirst}:B${recentLast})` } as ExcelJS.CellFormulaValue;
  rtr.getCell(2).numFmt = FMT_INT;
  rtr.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = { top: { style: "double", color: { argb: "FF1F3864" } } };
  });

  ws.views = [{ state: "frozen", ySplit: cohortHeaderRow }];

  return {
    cohortFirst,
    cohortLast,
    cohortRows: cohorts.length,
    recentFirst,
    recentLast,
    recentRows: months.length,
  };
}

// ── Rate history ───────────────────────────────────────────────────────────

interface HistoryLayout {
  monthFirst: number;
  monthLast: number;
  monthRows: number;
  quarterFirst: number;
  quarterLast: number;
  quarterRows: number;
}

function buildHistorySheet(ws: ExcelJS.Worksheet, plan: PlanResult, audit: PlanAudit): HistoryLayout {
  ws.getColumn(1).width = 16;
  for (let c = 2; c <= 7; c++) ws.getColumn(c).width = 18;

  ws.getRow(1).getCell(1).value = "Rate history and the target";
  ws.getRow(1).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };
  ws.getRow(2).getCell(1).value =
    "Realized rate is private-pay in-house room revenue divided by resident-days, in monthly-equivalent dollars. " +
    "It is the ROOM rate only — care fees are priced separately and an in-house increase does not move them.";
  ws.getRow(2).getCell(1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, 7);
  ws.getRow(2).height = 28;

  const quarterHeaderRow = 4;
  sectionTitle(ws, quarterHeaderRow - 1, "QUARTERLY YEAR-OVER-YEAR — what the plan is judged against", 7);
  const qh = ws.getRow(quarterHeaderRow);
  ["Quarter", "Prior-year rate", "Projected with plan", "Required rate", "YoY growth", "Target met", "Prior-year basis"]
    .forEach((h, i) => (qh.getCell(i + 1).value = h));
  styleHeaderRow(qh);

  const quarterFirst = quarterHeaderRow + 1;
  plan.quarters.forEach((q, i) => {
    const row = ws.getRow(quarterFirst + i);
    row.getCell(1).value = q.label;
    row.getCell(2).value = q.priorYear.realizedRateMonthly ?? null;
    row.getCell(2).numFmt = FMT_MONEY;
    row.getCell(3).value = q.projectedRateMonthly;
    row.getCell(3).numFmt = FMT_MONEY;
    row.getCell(4).value = q.requiredRateMonthly;
    row.getCell(4).numFmt = FMT_MONEY;
    // Live, so it moves if a prior-year figure is corrected by hand.
    row.getCell(5).value = {
      formula: `IF(B${quarterFirst + i}=0,"",C${quarterFirst + i}/B${quarterFirst + i}-1)`,
    } as ExcelJS.CellFormulaValue;
    row.getCell(5).numFmt = FMT_PCT2;
    row.getCell(6).value = {
      formula: `IF(B${quarterFirst + i}="","n/a",IF(C${quarterFirst + i}>=D${quarterFirst + i},"Yes","No"))`,
    } as ExcelJS.CellFormulaValue;
    row.getCell(7).value =
      q.priorYear.basis === "actual"
        ? `Actual (${q.priorYear.monthsAvailable}/${q.priorYear.monthsExpected} months)`
        : q.priorYear.basis === "partial"
          ? `Partial (${q.priorYear.monthsAvailable}/${q.priorYear.monthsExpected} months)`
          : "Projected from trend — not measured";
    if (q.isBinding) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9E9" } };
      });
      row.getCell(1).font = { bold: true };
    }
  });
  const quarterLast = quarterFirst + Math.max(0, plan.quarters.length - 1);

  // ── monthly realized history ──
  const monthHeaderRow = quarterLast + 3;
  sectionTitle(ws, monthHeaderRow - 1, "MONTHLY REALIZED RATE — the measured history", 7);
  const mh = ws.getRow(monthHeaderRow);
  ["Month", "Realized rate (monthly)", "Resident-days", "Implied revenue", "Change vs prior month"].forEach(
    (h, i) => (mh.getCell(i + 1).value = h),
  );
  styleHeaderRow(mh);

  const monthFirst = monthHeaderRow + 1;
  const history = audit.monthlyRealized;
  history.forEach((m, i) => {
    const rowIx = monthFirst + i;
    const row = ws.getRow(rowIx);
    row.getCell(1).value = m.month;
    row.getCell(2).value = m.rateMonthly;
    row.getCell(2).numFmt = FMT_MONEY;
    row.getCell(3).value = m.residentDays;
    row.getCell(3).numFmt = FMT_INT;
    row.getCell(4).value = {
      formula: `B${rowIx}*C${rowIx}/${DAYS_PER_MONTH}`,
    } as ExcelJS.CellFormulaValue;
    row.getCell(4).numFmt = FMT_MONEY;
    row.getCell(5).value =
      i === 0
        ? ""
        : ({ formula: `IF(B${rowIx - 1}=0,"",B${rowIx}/B${rowIx - 1}-1)` } as ExcelJS.CellFormulaValue);
    row.getCell(5).numFmt = FMT_PCT2;
  });
  const monthLast = monthFirst + Math.max(0, history.length - 1);

  if (history.length) {
    const mtr = ws.getRow(monthLast + 1);
    mtr.getCell(1).value = "TOTAL / AVERAGE";
    mtr.getCell(2).value = {
      formula: `IF(SUM(C${monthFirst}:C${monthLast})=0,0,SUMPRODUCT(B${monthFirst}:B${monthLast},C${monthFirst}:C${monthLast})/SUM(C${monthFirst}:C${monthLast}))`,
    } as ExcelJS.CellFormulaValue;
    mtr.getCell(2).numFmt = FMT_MONEY;
    mtr.getCell(3).value = { formula: `SUM(C${monthFirst}:C${monthLast})` } as ExcelJS.CellFormulaValue;
    mtr.getCell(3).numFmt = FMT_INT;
    mtr.getCell(4).value = { formula: `SUM(D${monthFirst}:D${monthLast})` } as ExcelJS.CellFormulaValue;
    mtr.getCell(4).numFmt = FMT_MONEY;
    mtr.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
      cell.border = { top: { style: "double", color: { argb: "FF1F3864" } } };
    });
  }

  ws.views = [{ state: "frozen", ySplit: quarterHeaderRow }];

  return {
    monthFirst,
    monthLast,
    monthRows: history.length,
    quarterFirst,
    quarterLast,
    quarterRows: plan.quarters.length,
  };
}

// ── Method ─────────────────────────────────────────────────────────────────

function buildMethodSheet(
  ws: ExcelJS.Worksheet,
  plan: PlanResult,
  audit: PlanAudit,
  daily: boolean,
  detail: DetailLayout,
) {
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 62;
  ws.getColumn(4).width = 58;

  ws.getRow(1).getCell(1).value = "How every number in this workbook is calculated";
  ws.getRow(1).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1F3864" } };

  const hdr = ws.getRow(3);
  ["", "Step", "What it means", "Formula in this workbook"].forEach((h, i) => (hdr.getCell(i + 1).value = h));
  styleHeaderRow(hdr);

  const ex = detail.firstDataRow; // the first resident row, used in examples
  const c = detail.col;
  const steps: Array<[string, string, string]> = [
    [
      "Effective street rate",
      "The street rate this resident is measured against on the in-house effective date. If the street increase lands first, the ceiling has already moved up.",
      `${c.effStreet}${ex} = IF(${c.street}${ex}>0, ${c.street}${ex} * street multiplier, 0)`,
    ],
    [
      "Room to street (headroom)",
      "How far this rate could rise before it reaches street. A resident with no usable street rate has no evidence of a ceiling, so the configured maximum is used instead of inventing one.",
      `${c.headroom}${ex} = MAX(0, ${c.effStreet}${ex} / ${c.current}${ex} - 1)`,
    ],
    [
      "Mean room to street",
      "The revenue-weighted average headroom across everyone in scope. Normalizing by this is what makes lambda read as 'the average increase' rather than an arbitrary scalar.",
      `'Plan summary'!B${SUMMARY_CELLS.meanHeadroom} = SUMPRODUCT(revenue weight, headroom) / SUM(revenue weight)`,
    ],
    [
      "Shape",
      "Where this resident sits on the equalization curve. At exponent 0 everybody gets the same increase; at 1 the increase scales fully with how far below street they are.",
      `${c.shape}${ex} = (${c.headroom}${ex} / mean headroom) ^ exponent`,
    ],
    [
      "Allowed range",
      "The maximum is the configured ceiling, tightened to the headroom when a new rate may not pass street. The minimum can never push a resident through that cap.",
      `${c.maxEff}${ex} = MAX(0, MIN(max increase, ${c.headroom}${ex}))\n${c.minEff}${ex} = MIN(MAX(0, min increase), ${c.maxEff}${ex})`,
    ],
    [
      "Uncapped increase",
      "The curve's raw answer before guardrails. Lambda is the single scalar that calibrates the whole curve.",
      `${c.raw}${ex} = lambda * ${c.shape}${ex}`,
    ],
    [
      "Increase applied",
      "The uncapped value held inside the allowed range. MEDIAN of the three is exactly a clamp, and stays correct even when the floor has been pushed down to meet the ceiling.",
      `${c.increase}${ex} = MEDIAN(${c.minEff}${ex}, ${c.raw}${ex}, ${c.maxEff}${ex})`,
    ],
    [
      "New rate for the room",
      "What this resident will be billed once the in-house effective date passes.",
      `${c.newRate}${ex} = ${c.current}${ex} * (1 + ${c.increase}${ex})\n${c.increaseDollars}${ex} = ${c.current}${ex} * ${c.increase}${ex}`,
    ],
    [
      "Weighted average increase",
      "Revenue weighted by resident-days, so the average reconciles to the aggregate rate move rather than to a headcount average. This is the number the target is set against.",
      `'Plan summary'!B${SUMMARY_CELLS.achievedAvg} = SUMPRODUCT(revenue weight, increase) / SUM(revenue weight)`,
    ],
    [
      "Lambda",
      "The one value that is solved, not derived. It is found by bisection so the weighted average lands exactly on the required target — a search with no closed form, so it cannot be written as a cell formula. To re-solve after changing an assumption, use Data > What-If Analysis > Goal Seek: set the achieved average cell to the required average by changing the lambda cell.",
      `'Plan summary'!B${SUMMARY_CELLS.lambda} = ${(audit.lambda * 100).toFixed(4)}% (solved)`,
    ],
  ];

  let r = 4;
  steps.forEach(([step, meaning, formula], i) => {
    const row = ws.getRow(r);
    row.getCell(1).value = i + 1;
    row.getCell(1).font = { bold: true, color: { argb: "FF1F3864" } };
    row.getCell(1).alignment = { vertical: "top", horizontal: "center" };
    row.getCell(2).value = step;
    row.getCell(2).font = { bold: true };
    row.getCell(2).alignment = { vertical: "top", wrapText: true };
    row.getCell(3).value = meaning;
    row.getCell(3).alignment = { vertical: "top", wrapText: true };
    row.getCell(4).value = formula;
    row.getCell(4).font = { name: "Consolas", size: 10 };
    row.getCell(4).alignment = { vertical: "top", wrapText: true };
    row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    if (i % 2 === 1) {
      for (const cc of [1, 2, 3]) {
        row.getCell(cc).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
      }
    }
    row.height = Math.max(44, 15 * Math.ceil(meaning.length / 60));
    r++;
  });

  r += 1;
  ws.getRow(r).getCell(2).value = "Scope rules that decide who appears here";
  ws.getRow(r).getCell(2).font = { bold: true, size: 12, color: { argb: "FF1F3864" } };
  r++;
  const notes = [
    "Only private-pay, occupied residents are included. Other payers are on fixed rates that a street-driven increase does not move.",
    "Companion (B) beds still receive increases — they are real residents with real rates — but they are excluded from street-rate averages.",
    "Rows with no in-house rate, or a rate outside the plausibility band for their campus and service line, are excluded rather than guessed at.",
    daily
      ? `This service line bills daily. All calculation happens in monthly-equivalent dollars — mixing the two bases is wrong by roughly ${DAYS_PER_MONTH}x — and the daily columns are derived at the end by dividing by ${DAYS_PER_MONTH}.`
      : "This service line bills monthly, so every rate in this workbook is already in the unit residents are billed in.",
    "Resident-day weight is the stay's overlap with the measurement window, so a resident who was present for half of it counts half as much.",
  ];
  for (const n of notes) {
    ws.getRow(r).getCell(2).value = "•";
    ws.getRow(r).getCell(2).alignment = { horizontal: "right" };
    ws.getRow(r).getCell(3).value = n;
    ws.getRow(r).getCell(3).alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r, 3, r, 4);
    ws.getRow(r).height = Math.max(30, 14 * Math.ceil(n.length / 90));
    r++;
  }

  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ── util ───────────────────────────────────────────────────────────────────

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
