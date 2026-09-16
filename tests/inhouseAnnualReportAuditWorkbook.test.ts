import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildAnnualReportAuditWorkbook } from "../server/services/inhouseAnnualReportAuditWorkbook";

function makePlan(serviceLine: string, currentRate: number, residentCount: number) {
  const residents = Array.from({ length: residentCount }, (_, index) => ({
    key: `${serviceLine}-${index}`,
    location: `${serviceLine} campus`,
    roomNumber: `${index + 1}`,
    roomType: "Studio",
    careLevel: serviceLine,
    payorType: "Private Pay",
    moveInDate: "2025-01-01",
    isCompanionBed: false,
    rateProduct: "base",
    streetRateSource: "unit",
    currentRateMonthly: currentRate,
    streetRateMonthly: currentRate + 500,
    gapToStreetPct: 10,
    gapToStreetDollarsMonthly: 500,
    increasePct: 6,
    increaseDollarsMonthly: currentRate * 0.06,
    newRateMonthly: currentRate * 1.06,
    newGapToStreetPct: 3.77,
    constraint: "none",
    rateBasis: "monthly",
    currentRateDisplay: currentRate,
    newRateDisplay: currentRate * 1.06,
    increaseDollarsDisplay: currentRate * 0.06,
    weight: 1,
    explanation: {},
  }));
  const quarters = Array.from({ length: 4 }, (_, index) => ({
    year: 2026,
    quarter: index + 1,
    label: `Q${index + 1} 2026`,
    passes: true,
    requiredRateMonthly: currentRate * 1.06,
    projectedRateMonthly: currentRate * 1.06,
    yoyGrowthPct: 6,
    shortfallPct: 0,
    isBinding: index === 0,
    priorYear: {
      year: 2025,
      quarter: index + 1,
      label: `Q${index + 1} 2025`,
      realizedRateMonthly: currentRate * 0.98,
      basis: "actual",
      monthsAvailable: 3,
      monthsExpected: 3,
      residentDays: 90,
    },
    explanation: {},
  }));
  const plan = {
    scope: { location: `${serviceLine} campus`, locationId: null },
    assumptions: { rateGrowthTargetPct: 6 },
    feasible: true,
    rateBasis: "monthly",
    currentStreetRateMonthly: currentRate + 500,
    recommendedStreetRateMonthly: currentRate + 550,
    streetIncreasePct: 10,
    streetIncreaseDollarsMonthly: 50,
    currentStreetRateDisplay: currentRate + 500,
    recommendedStreetRateDisplay: currentRate + 550,
    requiredWeightedAvgIncreasePct: 6,
    quarters,
    monthlyRateProjection: [],
    bindingQuarterLabel: "Q1 2026",
    adjustedTopCompetitorRateMonthly: null,
    summary: {
      residentCount,
      residentsReceivingIncrease: residentCount,
      currentAvgInhouseRateMonthly: currentRate,
      newAvgInhouseRateMonthly: currentRate * 1.06,
      weightedAvgIncreasePct: 6,
      totalMonthlyIncreaseDollars: currentRate * 0.06 * residentCount,
    },
    residents,
    planningSignals: {},
    infeasibility: null,
    explanation: {},
    warnings: [],
    standardization: { yearOverYear: null, comparisons: [] },
  };
  return plan as any;
}

const detailPlans = [
  { sl: "AL", plan: makePlan("AL", 5000, 2) },
  { sl: "HC", plan: makePlan("HC", 7000, 1) },
];

const reportPlans = detailPlans.map(({ sl, plan }) => ({
  sl,
  plan: { ...plan, residents: [] },
}));

const workbookBuffer = await buildAnnualReportAuditWorkbook({
  report: {
    id: "audit-fixture",
    generatedAt: "2026-09-16T12:00:00.000Z",
    scopeKey: "portfolio|AL,HC",
    locationId: null,
    serviceLines: ["AL", "HC"],
    plans: reportPlans as any,
  },
  detailPlans,
  detailGeneratedAt: "2026-09-16T12:01:00.000Z",
});

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(workbookBuffer);

const totals = workbook.getWorksheet("Report totals")!;
const detail = workbook.getWorksheet("Resident detail")!;
const reportRow = totals.getRow(5);
const formulaColumns = Array.from({ length: 15 }, (_, index) => index + 2);

for (const column of formulaColumns) {
  const value = reportRow.getCell(column).value as ExcelJS.CellFormulaValue;
  assert.equal(typeof value, "object", `Report totals column ${column} should be a formula`);
  assert.equal("formula" in value, true, `Report totals column ${column} should expose its formula`);
}

assert.match(String((reportRow.getCell(2).value as ExcelJS.CellFormulaValue).formula), /Resident detail/);
assert.match(String((reportRow.getCell(14).value as ExcelJS.CellFormulaValue).formula), /SUMIF/);
assert.match(String((reportRow.getCell(15).value as ExcelJS.CellFormulaValue).formula), /COUNTIF/);
assert.match(String((reportRow.getCell(16).value as ExcelJS.CellFormulaValue).formula), /O5\/O7/);

assert.equal(detail.getCell("W4").value, "Planned Street / mo");
assert.equal(detail.getCell("X4").value, "Prior-year realized avg / mo");
assert.equal(detail.getCell("Y4").value, "Plan-year projected avg / mo");
assert.equal(detail.getCell("AB4").value, "Total YoY revenue growth");

const residentFormulaColumns = ["M", "P", "Q", "R", "S", "T", "W", "X", "Y", "Z", "AA", "AB"];
for (const column of residentFormulaColumns) {
  const value = detail.getCell(`${column}5`).value as ExcelJS.CellFormulaValue;
  assert.equal(typeof value, "object", `Resident detail ${column}5 should be a formula`);
  assert.equal("formula" in value, true, `Resident detail ${column}5 should expose its formula`);
}
assert.match(
  String((detail.getCell("Q5").value as ExcelJS.CellFormulaValue).formula),
  /K5.*P5/,
  "resident increase dollars should derive from starting rate and plan increase",
);
assert.match(
  String((detail.getCell("AB5").value as ExcelJS.CellFormulaValue).formula),
  /Y5.*X5/,
  "resident annualized growth should derive from plan-year and prior-year rates",
);
assert.equal(detail.getColumn(29).hidden, true, "solver helper columns should stay hidden");

const totalRow = totals.getRow(7);
for (const column of formulaColumns) {
  const value = totalRow.getCell(column).value as ExcelJS.CellFormulaValue;
  assert.equal("formula" in value, true, `Report total column ${column} should remain a formula`);
}

console.log("Annual report audit workbook detail-link formulas: passed");