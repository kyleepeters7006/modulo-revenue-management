import ExcelJS from "exceljs";
import {
  annualRateGrowthBridge,
  annualRateGrowthRevenue,
  annualReportServiceLineLabel,
  type AnnualReportPlanSnapshot,
} from "@shared/inhouseAnnualReportSnapshot";
import type { PlanResult } from "@shared/inhousePlanning";
import { DAYS_PER_MONTH } from "@shared/careRates";

const NAVY = "FF1F3864";
const TEAL = "FF0F766E";
const LIGHT_BLUE = "FFD9E2F3";
const LIGHT_YELLOW = "FFFFF2CC";
const LIGHT_GRAY = "FFF2F2F2";
const BORDER = "FFB7C3D0";
const MONEY = '#,##0.00;[Red]-#,##0.00';
const INTEGER = '#,##0';
const PERCENT = "0.0%";
const PERCENT_2 = "0.00%";
const DATE = "yyyy-mm-dd";
const AUDIT_HEADER_ROW = 4;
const AUDIT_FIRST_DATA_ROW = AUDIT_HEADER_ROW + 1;

type DetailPlan = PlanResult & {
  standardization?: PlanResult["standardization"];
};

type ReportPlanEntry = {
  sl: string;
  plan: AnnualReportPlanSnapshot;
};

type CampusPlanContext = {
  locationId: string;
  locationName: string;
  plans: ReportPlanEntry[];
  generatedAt?: string | Date | null;
};

export interface AnnualReportAuditWorkbookInput {
  report: {
    id: string;
    generatedAt: string | Date;
    scopeKey: string;
    locationId: string | null;
    serviceLines: string[];
    plans: ReportPlanEntry[];
    tierGrid?: unknown;
  };
  detailPlans: Array<{ sl: string; plan: DetailPlan }>;
  detailGeneratedAt?: string | Date | null;
  /**
   * Campus-level compact snapshots from the same portfolio/division run.
   * Portfolio resident detail is still the source of the audit rows; these
   * snapshots provide the campus-specific street and annual bridge values
   * that cannot be reconstructed from a resident row alone.
   */
  campusPlans?: CampusPlanContext[];
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown): Date | "" {
  if (!value) return "";
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00Z` : String(value));
  return Number.isNaN(date.getTime()) ? "" : date;
}

function percent(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value / 100;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const usable = values.filter((entry) => Number.isFinite(entry.value) && entry.weight > 0);
  const weight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  return weight > 0
    ? usable.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight
    : 0;
}

function campusNameKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function campusPlanLookup(
  campusPlans: CampusPlanContext[] | undefined,
): Map<string, AnnualReportPlanSnapshot> {
  const lookup = new Map<string, AnnualReportPlanSnapshot>();
  for (const campus of campusPlans ?? []) {
    for (const entry of campus.plans ?? []) {
      const sl = String(entry?.sl ?? "").trim();
      if (!sl) continue;
      const names = [
        campus.locationName,
        (entry.plan as any)?.scope?.location,
      ]
        .map(campusNameKey)
        .filter(Boolean);
      for (const name of names) {
        lookup.set(`${sl}::${name}`, entry.plan);
      }
    }
  }
  return lookup;
}

function styleHeader(row: ExcelJS.Row, fill = NAVY) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
      left: { style: "thin", color: { argb: BORDER } },
      bottom: { style: "thin", color: { argb: BORDER } },
      right: { style: "thin", color: { argb: BORDER } },
    };
  });
  row.height = 32;
}

function styleTitle(ws: ExcelJS.Worksheet, text: string, lastColumn: number) {
  ws.mergeCells(1, 1, 1, lastColumn);
  const cell = ws.getCell(1, 1);
  cell.value = text;
  cell.font = { bold: true, size: 16, color: { argb: NAVY } };
  cell.alignment = { vertical: "middle" };
  ws.getRow(1).height = 24;
}

function styleNote(ws: ExcelJS.Worksheet, row: number, text: string, lastColumn: number) {
  ws.mergeCells(row, 1, row, lastColumn);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { italic: true, size: 9, color: { argb: "FF555555" } };
  cell.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 30;
}

function styleTotal(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_YELLOW } };
    cell.border = { top: { style: "thin", color: { argb: BORDER } } };
  });
}

function formula(cell: ExcelJS.Cell, expression: string, result: number | string | null) {
  cell.value = { formula: expression, result: result ?? 0 } as ExcelJS.CellFormulaValue;
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function residentDetailBounds(detailPlans: Array<{ sl: string; plan: DetailPlan }>) {
  const residentCount = detailPlans.reduce(
    (sum, entry) => sum + (entry.plan.residents?.length ?? 0),
    0,
  );
  return {
    first: AUDIT_FIRST_DATA_ROW,
    last: AUDIT_FIRST_DATA_ROW + residentCount - 1,
  };
}

function residentWeightedFormula(
  valueColumn: string,
  summaryRow: number,
  detailFirst: number,
  detailLast: number,
): string {
  const sheet = quoteSheet("Resident detail");
  const serviceLines = `${sheet}!$A$${detailFirst}:$A$${detailLast}`;
  const weights = `${sheet}!$J$${detailFirst}:$J$${detailLast}`;
  const values = `${sheet}!$${valueColumn}$${detailFirst}:$${valueColumn}$${detailLast}`;
  return `=IFERROR(SUMPRODUCT(--(${serviceLines}=$A${summaryRow}),${weights},${values})/SUMIF(${serviceLines},$A${summaryRow},${weights}),0)`;
}

function residentSumIfFormula(
  valueColumn: string,
  summaryRow: number,
  detailFirst: number,
  detailLast: number,
): string {
  const sheet = quoteSheet("Resident detail");
  return `=SUMIF(${sheet}!$A$${detailFirst}:$A$${detailLast},$A${summaryRow},${sheet}!$${valueColumn}$${detailFirst}:$${valueColumn}$${detailLast})`;
}

function residentCountIfFormula(
  summaryRow: number,
  detailFirst: number,
  detailLast: number,
): string {
  const sheet = quoteSheet("Resident detail");
  return `=COUNTIF(${sheet}!$A$${detailFirst}:$A$${detailLast},$A${summaryRow})`;
}

function applyNumberFormats(ws: ExcelJS.Worksheet, rowStart: number, rowEnd: number, columns: number[], format: string) {
  for (let row = rowStart; row <= rowEnd; row++) {
    for (const column of columns) ws.getCell(row, column).numFmt = format;
  }
}

function explainPriorPeriod(
  bridge: ReturnType<typeof annualRateGrowthBridge>,
  standardization: DetailPlan["standardization"] | undefined,
): string {
  if (!bridge) {
    return "A prior-period percentage could not be calculated because the saved report did not have a usable prior-year rate baseline.";
  }
  const rateEffect = standardization?.yearOverYear?.rateEffectPct;
  const mixEffect = standardization?.yearOverYear?.mixEffectPct;
  const rateText = rateEffect == null
    ? "the saved report did not have a usable matched-room rate-effect decomposition"
    : `matched-room rate movement of ${rateEffect.toFixed(2)} percentage points`;
  const mixText = mixEffect == null
    ? "the mix effect was unavailable"
    : `a ${mixEffect.toFixed(2)} percentage-point mix effect`;
  const direction = bridge.priorPeriodIncreasePct >= 0 ? "increase" : "decrease";
  return `The ${Math.abs(bridge.priorPeriodIncreasePct).toFixed(2)}% prior-period ${direction} is the residual historical movement: ${bridge.fullYearYoyPct.toFixed(2)}% full-year modeled YoY less the ${bridge.planIncreasePct.toFixed(2)}% new plan increase. It reflects rates already realized before the plan effective date, including ${rateText} and ${mixText}; it is not an additional resident-level increase created by this plan.`;
}

function buildReportTotals(
  ws: ExcelJS.Worksheet,
  input: AnnualReportAuditWorkbookInput,
) {
  const entries = input.report.plans;
  const columns = [
    "Service line", "Starting IH avg / mo", "Planned IH avg / mo", "Plan IH %",
    "Starting Street avg / mo", "Planned Street avg / mo", "Street %",
    "Planned Street over IH", "Prior-year realized avg / mo", "Plan-year projected avg / mo",
    "Prior-period %", "Plan %", "Total YoY %", "Total YoY revenue growth",
    "Residents", "Portfolio share",
  ];
  ws.columns = columns.map((header, index) => ({
    header,
    key: `c${index + 1}`,
    width: [18, 19, 19, 12, 22, 22, 12, 19, 24, 25, 14, 11, 13, 24, 12, 14][index],
  }));
  styleTitle(ws, "Annual report audit — report totals", columns.length);
  styleNote(
    ws,
    2,
    `Report ${input.report.id} · scope ${input.report.scopeKey} · generated ${new Date(input.report.generatedAt).toLocaleString("en-US")} · detail snapshot ${input.detailGeneratedAt ? new Date(input.detailGeneratedAt).toLocaleString("en-US") : "not timestamped"}. Numeric service-line cells link to the Resident detail tab; derived percentages and the total row are Excel formulas.`,
    columns.length,
  );
  const headerRow = AUDIT_HEADER_ROW;
  columns.forEach((header, index) => { ws.getCell(headerRow, index + 1).value = header; });
  styleHeader(ws.getRow(headerRow));
  const first = AUDIT_FIRST_DATA_ROW;
  const total = first + entries.length;
  const detailBounds = residentDetailBounds(input.detailPlans);
  const totalResidents = entries.reduce(
    (sum, entry) => sum + number(entry.plan.summary?.residentCount),
    0,
  );

  entries.forEach((entry, index) => {
    const rowNumber = first + index;
    const plan = entry.plan;
    const residents = number(plan.summary?.residentCount);
    const planIncrease = number(plan.summary?.weightedAvgIncreasePct);
    const bridge = annualRateGrowthBridge(plan.quarters, plan.rateBasis, planIncrease);
    const currentInhouse = number(plan.summary?.currentAvgInhouseRateMonthly);
    const plannedInhouse = number(plan.summary?.newAvgInhouseRateMonthly);
    const currentStreet = number(plan.currentStreetRateMonthly);
    const plannedStreet = number(plan.recommendedStreetRateMonthly);
    ws.getCell(rowNumber, 1).value = annualReportServiceLineLabel(entry.sl);
    formula(ws.getCell(rowNumber, 2), residentWeightedFormula("K", rowNumber, detailBounds.first, detailBounds.last), currentInhouse);
    formula(ws.getCell(rowNumber, 3), residentWeightedFormula("R", rowNumber, detailBounds.first, detailBounds.last), plannedInhouse);
    formula(ws.getCell(rowNumber, 4), `=IFERROR(C${rowNumber}/B${rowNumber}-1,0)`, percent(planIncrease));
    formula(ws.getCell(rowNumber, 5), residentWeightedFormula("L", rowNumber, detailBounds.first, detailBounds.last), currentStreet);
    formula(ws.getCell(rowNumber, 6), residentWeightedFormula("W", rowNumber, detailBounds.first, detailBounds.last), plannedStreet);
    formula(ws.getCell(rowNumber, 7), `=IFERROR(F${rowNumber}/E${rowNumber}-1,0)`, percent(number(plan.streetIncreasePct)));
    formula(ws.getCell(rowNumber, 8), `=IFERROR(F${rowNumber}/C${rowNumber}-1,0)`, plannedInhouse > 0 ? plannedStreet / plannedInhouse - 1 : null);
    formula(ws.getCell(rowNumber, 9), residentWeightedFormula("X", rowNumber, detailBounds.first, detailBounds.last), bridge?.priorYearAverageRateMonthly ?? null);
    formula(ws.getCell(rowNumber, 10), residentWeightedFormula("Y", rowNumber, detailBounds.first, detailBounds.last), bridge?.projectedPlanYearAverageRateMonthly ?? null);
    formula(ws.getCell(rowNumber, 11), `=M${rowNumber}-L${rowNumber}`, percent(bridge?.priorPeriodIncreasePct));
    formula(ws.getCell(rowNumber, 12), `=D${rowNumber}`, percent(bridge?.planIncreasePct));
    formula(ws.getCell(rowNumber, 13), `=IFERROR(J${rowNumber}/I${rowNumber}-1,0)`, percent(bridge?.fullYearYoyPct));
    formula(
      ws.getCell(rowNumber, 14),
      residentSumIfFormula("AB", rowNumber, detailBounds.first, detailBounds.last),
      bridge ? annualRateGrowthRevenue(bridge, residents) ?? 0 : 0,
    );
    formula(ws.getCell(rowNumber, 15), residentCountIfFormula(rowNumber, detailBounds.first, detailBounds.last), residents);
    formula(
      ws.getCell(rowNumber, 16),
      `=IFERROR(O${rowNumber}/O${total},0)`,
      totalResidents > 0 ? residents / totalResidents : 0,
    );
  });

  ws.getCell(total, 1).value = "Total";
  const last = total - 1;
  if (last >= first) {
    formula(ws.getCell(total, 2), `=SUMPRODUCT(B${first}:B${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 3), `=SUMPRODUCT(C${first}:C${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 4), `=C${total}/B${total}-1`, 0);
    formula(ws.getCell(total, 5), `=SUMPRODUCT(E${first}:E${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 6), `=SUMPRODUCT(F${first}:F${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 7), `=F${total}/E${total}-1`, 0);
    formula(ws.getCell(total, 8), `=F${total}/C${total}-1`, 0);
    formula(ws.getCell(total, 9), `=SUMPRODUCT(I${first}:I${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 10), `=SUMPRODUCT(J${first}:J${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 11), `=M${total}-L${total}`, 0);
    formula(ws.getCell(total, 12), `=SUMPRODUCT(L${first}:L${last},O${first}:O${last})/SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 13), `=J${total}/I${total}-1`, 0);
    formula(ws.getCell(total, 14), `=SUM(N${first}:N${last})`, 0);
    formula(ws.getCell(total, 15), `=SUM(O${first}:O${last})`, 0);
    formula(ws.getCell(total, 16), `=SUM(P${first}:P${last})`, 1);
  }
  styleTotal(ws.getRow(total));
  applyNumberFormats(ws, first, total, [2, 3, 5, 6, 9, 10], MONEY);
  applyNumberFormats(ws, first, total, [4, 7, 8, 11, 12, 13, 16], PERCENT);
  applyNumberFormats(ws, first, total, [14], MONEY);
  applyNumberFormats(ws, first, total, [15], INTEGER);
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: total, column: columns.length } };
}

function buildPriorPeriodSheet(
  ws: ExcelJS.Worksheet,
  input: AnnualReportAuditWorkbookInput,
  detailByLine: Map<string, DetailPlan>,
) {
  const columns = [
    "Service line", "Prior-year avg / mo", "Plan-year avg / mo", "Full-year YoY %",
    "Plan increase %", "Prior-period %", "Matched-room rate effect (pp)",
    "Mix effect (pp)", "Matched rooms", "Ending rooms", "Coverage %", "English explanation",
  ];
  ws.columns = columns.map((header, index) => ({
    header,
    key: `c${index + 1}`,
    width: [18, 20, 20, 15, 15, 15, 24, 16, 14, 13, 13, 85][index],
  }));
  styleTitle(ws, "Prior-period bridge and explanation", columns.length);
  styleNote(
    ws,
    2,
    "The annual report splits full-year modeled YoY into the new plan increase and the prior-period residual. The residual is not a second plan lever. It is the movement already embedded in historical realized rates, with matched-room rate movement and room-mix movement shown separately where the saved calculation has that diagnostic.",
    columns.length,
  );
  const headerRow = 4;
  columns.forEach((header, index) => { ws.getCell(headerRow, index + 1).value = header; });
  styleHeader(ws.getRow(headerRow));
  const first = headerRow + 1;

  input.report.plans.forEach((entry, index) => {
    const row = first + index;
    const plan = entry.plan;
    const planIncrease = number(plan.summary?.weightedAvgIncreasePct);
    const bridge = annualRateGrowthBridge(plan.quarters, plan.rateBasis, planIncrease);
    const detail = detailByLine.get(entry.sl);
    const yoy = detail?.standardization?.yearOverYear;
    ws.getCell(row, 1).value = annualReportServiceLineLabel(entry.sl);
    ws.getCell(row, 2).value = bridge?.priorYearAverageRateMonthly ?? null;
    ws.getCell(row, 3).value = bridge?.projectedPlanYearAverageRateMonthly ?? null;
    ws.getCell(row, 4).value = percent(bridge?.fullYearYoyPct);
    ws.getCell(row, 5).value = percent(planIncrease);
    ws.getCell(row, 6).value = percent(bridge?.priorPeriodIncreasePct);
    ws.getCell(row, 7).value = percent(yoy?.rateEffectPct);
    ws.getCell(row, 8).value = percent(yoy?.mixEffectPct);
    ws.getCell(row, 9).value = yoy?.matchedRooms ?? null;
    ws.getCell(row, 10).value = yoy?.endingRooms ?? null;
    ws.getCell(row, 11).value = percent(yoy?.coverageByCountPct);
    ws.getCell(row, 12).value = explainPriorPeriod(bridge, detail?.standardization);
  });

  const total = first + input.report.plans.length;
  ws.getCell(total, 1).value = "Total";
  const last = total - 1;
  if (last >= first) {
    formula(ws.getCell(total, 2), `=SUMPRODUCT(B${first}:B${last},I${first}:I${last})/SUM(I${first}:I${last})`, 0);
    formula(ws.getCell(total, 3), `=SUMPRODUCT(C${first}:C${last},I${first}:I${last})/SUM(I${first}:I${last})`, 0);
    formula(ws.getCell(total, 4), `=C${total}/B${total}-1`, 0);
    formula(ws.getCell(total, 5), `=SUMPRODUCT(E${first}:E${last},I${first}:I${last})/SUM(I${first}:I${last})`, 0);
    formula(ws.getCell(total, 6), `=D${total}-E${total}`, 0);
    formula(ws.getCell(total, 7), `=SUMPRODUCT(G${first}:G${last},I${first}:I${last})/SUM(I${first}:I${last})`, 0);
    formula(ws.getCell(total, 8), `=SUMPRODUCT(H${first}:H${last},I${first}:I${last})/SUM(I${first}:I${last})`, 0);
    formula(ws.getCell(total, 9), `=SUM(I${first}:I${last})`, 0);
    formula(ws.getCell(total, 10), `=SUM(J${first}:J${last})`, 0);
    formula(ws.getCell(total, 11), `=SUMPRODUCT(K${first}:K${last},I${first}:I${last})/SUM(I${first}:I${last})`, 0);
    ws.getCell(total, 12).value =
      "Total prior-period % = total full-year modeled YoY % minus the resident-weighted new plan %. The historical cause is the rate movement and mix movement shown above; it is not a new plan increase.";
  }
  styleTotal(ws.getRow(total));
  applyNumberFormats(ws, first, total, [2, 3], MONEY);
  applyNumberFormats(ws, first, total, [4, 5, 6, 7, 8, 11], PERCENT);
  applyNumberFormats(ws, first, total, [9, 10], INTEGER);
  ws.getColumn(12).alignment = { wrapText: true, vertical: "top" };
  for (let row = first; row <= total; row++) ws.getRow(row).height = 42;
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: total, column: columns.length } };
}

function buildResidentDetailSheet(
  ws: ExcelJS.Worksheet,
  detailPlans: Array<{ sl: string; plan: DetailPlan }>,
  campusPlans?: CampusPlanContext[],
) {
  const visibleColumns = [
    "Service line", "Campus", "Room", "Room type", "Care level", "Payor", "Move-in date",
    "Companion bed", "Rate basis", "Resident-day weight", "Starting IH / mo",
    "Used Street / mo", "Used Street / display", "Street product", "Street rate source",
    "Plan increase %", "Increase $ / mo", "Planned IH / mo", "Planned IH / display",
    "New gap to Street %", "Constraint", "Included in plan", "Planned Street / mo",
    "Prior-year realized avg / mo", "Plan-year projected avg / mo", "Prior-period %",
    "Plan %", "Total YoY revenue growth",
  ];
  // These are server-calculated bases that cannot be reconstructed from the
  // visible rent-roll fields alone: the solver's resident allocation and the
  // plan-wide annual bridge. Keep them hidden and labelled rather than
  // disguising snapshots as formulas. All visible calculated columns below
  // reference these cells or calculate directly from the source fields.
  const helperColumns = [
    "Solver snapshot · resident plan increase %",
    "Solver snapshot · planned Street / mo",
    "Solver snapshot · prior-year realized avg / mo",
    "Solver snapshot · plan-year projected avg / mo",
    "Solver snapshot · prior-period %",
    "Solver snapshot · plan %",
  ];
  const columns = [...visibleColumns, ...helperColumns];
  ws.columns = columns.map((header, index) => ({
    header,
    key: `c${index + 1}`,
    width: index < visibleColumns.length
      ? [15, 25, 11, 18, 14, 17, 14, 14, 12, 18, 18, 18, 21, 18, 22, 15, 17, 18, 20, 18, 18, 16, 18, 24, 25, 14, 11, 24][index]
      : 18,
  }));
  for (let column = visibleColumns.length + 1; column <= columns.length; column++) {
    ws.getColumn(column).hidden = true;
  }
  styleTitle(ws, "Resident and room detail — starting rates and planned increases", columns.length);
  styleNote(
    ws,
    2,
    "Each row is a private-pay occupied rent-roll room included in the planning population after the documented rate and product gates. Rent-roll/cohort source fields remain inputs; visible calculated fields are Excel formulas. Hidden helper columns retain solver snapshots that cannot be reconstructed from this row alone.",
    columns.length,
  );
  const headerRow = AUDIT_HEADER_ROW;
  columns.forEach((header, index) => { ws.getCell(headerRow, index + 1).value = header; });
  styleHeader(ws.getRow(headerRow));
  const first = AUDIT_FIRST_DATA_ROW;
  let currentRow = first;
  const campusLookup = campusPlanLookup(campusPlans);

  for (const entry of detailPlans) {
    const plan = entry.plan;
    const planIncrease = number(plan.summary?.weightedAvgIncreasePct);
    const bridge = annualRateGrowthBridge(plan.quarters, plan.rateBasis, planIncrease);
    const priorYear = bridge?.priorYearAverageRateMonthly ?? null;
    const projectedYear = bridge?.projectedPlanYearAverageRateMonthly ?? null;
    const priorPeriod = percent(bridge?.priorPeriodIncreasePct);
    const planPercent = percent(bridge?.planIncreasePct);
    const perResidentRevenueGrowth = bridge ? annualRateGrowthRevenue(bridge, 1) ?? 0 : 0;
    for (const resident of plan.residents ?? []) {
      const campusPlan = campusLookup.get(
        `${entry.sl}::${campusNameKey(resident.location)}`,
      );
      const campusPlanIncrease = campusPlan
        ? number(campusPlan.summary?.weightedAvgIncreasePct)
        : null;
      const campusBridge = campusPlan
        ? annualRateGrowthBridge(
            campusPlan.quarters,
            campusPlan.rateBasis,
            campusPlanIncrease ?? 0,
          )
        : null;
      const plannedStreet = campusPlan
        ? number(campusPlan.recommendedStreetRateMonthly)
        : number(plan.recommendedStreetRateMonthly);
      const rowPriorYear = campusBridge?.priorYearAverageRateMonthly ?? priorYear;
      const rowProjectedYear =
        campusBridge?.projectedPlanYearAverageRateMonthly ?? projectedYear;
      const rowPriorPeriod = percent(
        campusBridge?.priorPeriodIncreasePct ?? bridge?.priorPeriodIncreasePct,
      );
      const rowPlanPercent = percent(
        campusBridge?.planIncreasePct ?? bridge?.planIncreasePct,
      );
      const rowRevenueGrowth = campusBridge
        ? annualRateGrowthRevenue(campusBridge, 1) ?? 0
        : perResidentRevenueGrowth;
      const row = ws.getRow(currentRow++);
      const displayStreet = plan.rateBasis === "daily"
        ? number(resident.streetRateMonthly) / DAYS_PER_MONTH
        : number(resident.streetRateMonthly);
      row.values = [
        annualReportServiceLineLabel(entry.sl),
        resident.location,
        resident.roomNumber,
        resident.roomType ?? "",
        resident.careLevel ?? "",
        resident.payorType ?? "",
        dateValue(resident.moveInDate),
        resident.isCompanionBed ? "Yes" : "",
        plan.rateBasis,
        number(resident.weight),
        number(resident.currentRateMonthly),
        number(resident.streetRateMonthly),
        displayStreet,
        resident.rateProduct,
        resident.streetRateSource,
        percent(number(resident.increasePct)),
        number(resident.increaseDollarsMonthly),
        number(resident.newRateMonthly),
        number(resident.newRateDisplay),
        percent(number(resident.newGapToStreetPct)),
        resident.constraint,
        "Yes",
        plannedStreet,
        rowPriorYear,
        rowProjectedYear,
        rowPriorPeriod,
        rowPlanPercent,
        rowRevenueGrowth,
      ];
      const helperStart = visibleColumns.length + 1;
      ws.getCell(currentRow - 1, helperStart).value = percent(number(resident.increasePct));
      ws.getCell(currentRow - 1, helperStart + 1).value = plannedStreet;
      ws.getCell(currentRow - 1, helperStart + 2).value = rowPriorYear;
      ws.getCell(currentRow - 1, helperStart + 3).value = rowProjectedYear;
      ws.getCell(currentRow - 1, helperStart + 4).value = rowPriorPeriod;
      ws.getCell(currentRow - 1, helperStart + 5).value = rowPlanPercent;

      const rowNumber = currentRow - 1;
      const divisor = `IF($I${rowNumber}="daily",365/12,1)`;
      formula(ws.getCell(rowNumber, 13), `=IFERROR($L${rowNumber}/${divisor},0)`, displayStreet);
      formula(ws.getCell(rowNumber, 16), `=$AC${rowNumber}`, percent(number(resident.increasePct)));
      formula(ws.getCell(rowNumber, 17), `=$K${rowNumber}*$P${rowNumber}`, number(resident.increaseDollarsMonthly));
      formula(ws.getCell(rowNumber, 18), `=$K${rowNumber}+$Q${rowNumber}`, number(resident.newRateMonthly));
      formula(ws.getCell(rowNumber, 19), `=IFERROR($R${rowNumber}/${divisor},0)`, number(resident.newRateDisplay));
      formula(ws.getCell(rowNumber, 20), `=IFERROR($W${rowNumber}/$R${rowNumber}-1,0)`, percent(number(resident.newGapToStreetPct)));
      formula(ws.getCell(rowNumber, 23), `=$AD${rowNumber}`, plannedStreet);
      formula(ws.getCell(rowNumber, 24), `=$AE${rowNumber}`, rowPriorYear);
      formula(ws.getCell(rowNumber, 25), `=$AF${rowNumber}`, rowProjectedYear);
      formula(ws.getCell(rowNumber, 26), `=$AG${rowNumber}`, rowPriorPeriod);
      formula(
        ws.getCell(rowNumber, 27),
        `=$AH${rowNumber}`,
        rowPlanPercent,
      );
      formula(ws.getCell(rowNumber, 28), `=($Y${rowNumber}-$X${rowNumber})*12`, rowRevenueGrowth);
    }
  }
  const total = currentRow;
  ws.getCell(total, 1).value = "Total / weighted average";
  if (currentRow > first) {
    formula(ws.getCell(total, 10), `=SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 11), `=SUMPRODUCT(K${first}:K${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 12), `=SUMPRODUCT(L${first}:L${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 16), `=SUMPRODUCT(P${first}:P${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 17), `=SUM(Q${first}:Q${currentRow - 1})`, 0);
    formula(ws.getCell(total, 18), `=SUMPRODUCT(R${first}:R${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 20), `=IFERROR(W${total}/R${total}-1,0)`, 0);
    formula(ws.getCell(total, 23), `=SUMPRODUCT(W${first}:W${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 24), `=SUMPRODUCT(X${first}:X${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 25), `=SUMPRODUCT(Y${first}:Y${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 26), `=SUMPRODUCT(Z${first}:Z${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 27), `=SUMPRODUCT(AA${first}:AA${currentRow - 1},J${first}:J${currentRow - 1})/SUM(J${first}:J${currentRow - 1})`, 0);
    formula(ws.getCell(total, 28), `=SUM(AB${first}:AB${currentRow - 1})`, 0);
  }
  styleTotal(ws.getRow(total));
  applyNumberFormats(ws, first, total, [11, 12, 13, 17, 18, 23, 24, 25, 28], MONEY);
  applyNumberFormats(ws, first, total, [16, 20, 26, 27], PERCENT);
  applyNumberFormats(ws, first, total, [10], "0.0");
  applyNumberFormats(ws, first, total, [7], DATE);
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 2 }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: total, column: columns.length } };
}

function buildQuarterDetailSheet(
  ws: ExcelJS.Worksheet,
  detailPlans: Array<{ sl: string; plan: DetailPlan }>,
) {
  const columns = [
    "Service line", "Quarter", "Campus", "Room", "Room type", "Current IH / mo",
    "Planned existing IH / mo", "Existing share %", "Replacement share %", "Replacement rate / mo",
    "Projected room rate / mo", "Change / mo", "Prior-year average / mo",
    "Projected quarter average / mo", "Quarter YoY %", "Rate basis",
  ];
  ws.columns = columns.map((header, index) => ({
    header,
    key: `c${index + 1}`,
    width: [15, 13, 25, 11, 18, 18, 23, 16, 18, 21, 23, 15, 22, 25, 14, 12][index],
  }));
  styleTitle(ws, "Quarter and room detail — how projected totals are formed", columns.length);
  styleNote(
    ws,
    2,
    "Quarter rows show the room-level bridge used to form each projected quarter average: today's resident rate after the plan, the share expected to remain, the replacement share, and the replacement rate. The prior-year rate and YoY columns are the report's quarter-level baseline and comparison.",
    columns.length,
  );
  const headerRow = 4;
  columns.forEach((header, index) => { ws.getCell(headerRow, index + 1).value = header; });
  styleHeader(ws.getRow(headerRow), TEAL);
  const first = headerRow + 1;
  let currentRow = first;
  for (const entry of detailPlans) {
    for (const quarter of entry.plan.quarters ?? []) {
      const roomDetails = quarter.roomDetails ?? [];
      for (const room of roomDetails) {
        const row = ws.getRow(currentRow++);
        row.values = [
          annualReportServiceLineLabel(entry.sl),
          quarter.label,
          room.location,
          room.roomNumber,
          room.roomType ?? "",
          room.currentRateMonthly,
          room.plannedExistingRateMonthly,
          percent(room.existingSharePct),
          percent(room.replacementSharePct),
          room.replacementRateMonthly,
          room.projectedRateMonthly,
          room.changeMonthly,
          quarter.priorYear.realizedRateMonthly,
          quarter.projectedRateMonthly,
          percent(quarter.yoyGrowthPct),
          entry.plan.rateBasis,
        ];
      }
    }
  }
  const total = currentRow;
  ws.getCell(total, 1).value = "Rows";
  ws.getCell(total, 2).value = Math.max(0, currentRow - first);
  styleTotal(ws.getRow(total));
  applyNumberFormats(ws, first, total, [6, 7, 10, 11, 12, 13, 14], MONEY);
  applyNumberFormats(ws, first, total, [8, 9, 15], PERCENT);
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 2 }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: total, column: columns.length } };
}

function buildHistoricalComparisonsSheet(
  ws: ExcelJS.Worksheet,
  detailPlans: Array<{ sl: string; plan: DetailPlan }>,
) {
  const columns = [
    "Service line", "Comparison", "Raw change %", "Matched-room rate effect %",
    "Mix effect %", "Base-weighted rate effect %", "Composition effect %",
    "Matched rooms", "Ending rooms", "Coverage by count %", "Coverage by revenue %",
    "Usable", "Reason / suppression code",
  ];
  ws.columns = columns.map((header, index) => ({
    header,
    key: `c${index + 1}`,
    width: [15, 26, 14, 24, 14, 27, 22, 14, 13, 21, 23, 10, 28][index],
  }));
  styleTitle(ws, "Historical comparisons — rate and mix drivers", columns.length);
  styleNote(
    ws,
    2,
    "These diagnostics explain the historical portion of the annual bridge. Rate effect is the matched-room price movement; mix effect is the difference caused by the room composition changing. Suppressed comparisons are retained with their reason instead of being silently treated as zero.",
    columns.length,
  );
  const headerRow = 4;
  columns.forEach((header, index) => { ws.getCell(headerRow, index + 1).value = header; });
  styleHeader(ws.getRow(headerRow), TEAL);
  const first = headerRow + 1;
  let currentRow = first;
  for (const entry of detailPlans) {
    for (const comparison of entry.plan.standardization?.comparisons ?? []) {
      const row = ws.getRow(currentRow++);
      row.values = [
          annualReportServiceLineLabel(entry.sl),
        `${comparison.baseQuarterLabel} → ${comparison.endingQuarterLabel}`,
        percent(comparison.rawChangePct),
        percent(comparison.rateEffectPct),
        percent(comparison.mixEffectPct),
        percent(comparison.baseWeightedRateEffectPct),
        percent(comparison.compositionEffectPct),
        comparison.matchedRooms,
        comparison.endingRooms,
        percent(comparison.coverageByCountPct),
        percent(comparison.coverageByRevenuePct),
        comparison.usable ? "Yes" : "No",
        comparison.reasonCode ?? "",
      ];
    }
  }
  const total = currentRow;
  ws.getCell(total, 1).value = "Rows";
  ws.getCell(total, 2).value = Math.max(0, currentRow - first);
  styleTotal(ws.getRow(total));
  applyNumberFormats(ws, first, total, [3, 4, 5, 6, 7, 10, 11], PERCENT);
  applyNumberFormats(ws, first, total, [8, 9], INTEGER);
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 2 }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: total, column: columns.length } };
}

function buildReadMeSheet(ws: ExcelJS.Worksheet, input: AnnualReportAuditWorkbookInput) {
  ws.columns = [
    { header: "Topic", key: "topic", width: 31 },
    { header: "Explanation", key: "explanation", width: 120 },
  ];
  styleTitle(ws, "Annual report audit workbook", 2);
  const rows: Array<[string, string]> = [
    ["Purpose", "This workbook exposes the room/resident rows behind the annual report totals so an operator can audit the starting rates, the planned increases, the quarter projections, and the historical bridge."],
    ["Report source", `Saved annual report ${input.report.id}, scope ${input.report.scopeKey}, generated ${new Date(input.report.generatedAt).toLocaleString("en-US")}.`],
    ["Starting Street Rate", "The Resident detail sheet lists the product-matched Street Rate used for each included room. The source column says whether it came from the unit itself, a campus product median, a service-line product median, or a derived formula."],
    ["Population", "Rows are the private-pay occupied rent-roll rooms with a usable in-house rate that passed the planning population rules. Companion beds remain in the resident plan but are flagged; they are not silently removed from resident increases."],
    ["Plan increase %", "This is the new resident-level in-house increase calculated by the plan. The detail sheet shows the percentage and dollar increase for each room/resident."],
    ["Prior-period %", "Prior-period % = full-year modeled YoY % − new plan increase %. It is the rate movement already embedded in historical realized rates before the plan effective date, not another new increase assigned to residents."],
    ["What caused prior-period %", "The Prior-period bridge sheet gives the plain-English explanation. The Historical comparisons sheet separates matched-room rate movement from room-mix movement and retains coverage and suppression reasons."],
    ["Quarter totals", "The Quarter detail sheet shows each room's existing-rate share, replacement share, replacement rate, and projected room rate. Those rows roll into the quarterly averages used by the report."],
    ["Currency and basis", "Rates are normalized monthly in calculation columns. Daily service lines retain their daily display columns where applicable; do not divide monthly-normalized rates again."],
    ["Formula checks", "Every numeric service-line cell on Report totals links to the Resident detail tab with Excel formulas. Derived percentages and the total row also use formulas, while the Resident detail weighted averages and increase totals remain inspectable."],
  ];
  rows.forEach(([topic, explanation], index) => {
    const row = ws.getRow(index + 3);
    row.values = [topic, explanation];
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.height = 38;
  });
  styleHeader(ws.getRow(2), LIGHT_BLUE);
  ws.getCell(2, 1).font = { bold: true, color: { argb: NAVY } };
  ws.getCell(2, 2).font = { bold: true, color: { argb: NAVY } };
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

export async function buildAnnualReportAuditWorkbook(
  input: AnnualReportAuditWorkbookInput,
): Promise<Buffer> {
  if (!input.report.plans.length) {
    throw new Error("Annual report export: the saved report has no service-line plans.");
  }
  if (!input.detailPlans.length) {
    throw new Error("Annual report export: resident detail is unavailable for this saved report. Recalculate the plan and save the Annual Report again.");
  }

  const detailByLine = new Map(input.detailPlans.map((entry) => [entry.sl, entry.plan]));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Modulo Annual Report";
  workbook.created = new Date();
  workbook.properties = {
    title: "Annual report audit workbook",
    subject: input.report.scopeKey,
    keywords: "annual report, rate plan, resident audit",
  };
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  workbook.calcProperties.calcMode = "auto";

  const readMe = workbook.addWorksheet("Read me");
  buildReadMeSheet(readMe, input);
  const totals = workbook.addWorksheet("Report totals");
  buildReportTotals(totals, input);
  const bridge = workbook.addWorksheet("Prior-period bridge");
  buildPriorPeriodSheet(bridge, input, detailByLine);
  const residents = workbook.addWorksheet("Resident detail");
  buildResidentDetailSheet(residents, input.detailPlans, input.campusPlans);
  const quarters = workbook.addWorksheet("Quarter room detail");
  buildQuarterDetailSheet(quarters, input.detailPlans);
  const history = workbook.addWorksheet("Historical drivers");
  buildHistoricalComparisonsSheet(history, input.detailPlans);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}