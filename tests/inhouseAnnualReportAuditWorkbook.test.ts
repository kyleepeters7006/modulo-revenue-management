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
    standardization: {
      yearOverYear: {
        baseQuarterLabel: "Q1 2025",
        endingQuarterLabel: "Q1 2026",
        rateEffectPct: 2.5,
        rawChangePct: 3,
        mixEffectPct: 0.5,
        matchedRooms: residentCount,
        endingRooms: residentCount,
        coverageByCountPct: 100,
        coverageByRevenuePct: 100,
      },
      yearOverYearStrata: [],
      comparisons: [],
    },
  };
  return plan as any;
}

const alPlan = makePlan("AL", 5000, 2);
alPlan.residents[0].location = "Campus A";
alPlan.residents[1].location = "Campus B";

const campusAPlan = makePlan("AL", 4000, 1);
campusAPlan.scope.location = "Campus A";
const campusBPlan = makePlan("AL", 6000, 1);
campusBPlan.scope.location = "Campus B";

const detailPlans = [
  { sl: "AL", plan: alPlan },
  { sl: "HC", plan: (() => {
    const plan = makePlan("HC", 7000, 1);
    plan.summary.weightedAvgIncreasePct = 9;
    plan.standardization.yearOverYear.rateEffectPct = 4;
    plan.residents[0].increasePct = 9;
    plan.residents[0].increaseDollarsMonthly = 630;
    plan.residents[0].newRateMonthly = 7630;
    return plan;
  })() },
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
  campusPlans: [
    {
      locationId: "campus-a",
      locationName: "Campus A",
      plans: [{ sl: "AL", plan: campusAPlan }],
    },
    {
      locationId: "campus-b",
      locationName: "Campus B",
      plans: [{ sl: "AL", plan: campusBPlan }],
    },
  ],
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
assert.equal((detail.getCell("W5").value as ExcelJS.CellFormulaValue).result, 4550);
assert.equal((detail.getCell("W6").value as ExcelJS.CellFormulaValue).result, 6550);
assert.equal((detail.getCell("X5").value as ExcelJS.CellFormulaValue).result, 3920);
assert.equal((detail.getCell("X6").value as ExcelJS.CellFormulaValue).result, 5880);
assert.equal((detail.getCell("Y5").value as ExcelJS.CellFormulaValue).result, 4240);
assert.equal((detail.getCell("Y6").value as ExcelJS.CellFormulaValue).result, 6360);
assert.equal(detail.getCell("AD5").value, 4550);
assert.equal(detail.getCell("AD6").value, 6550);
assert.equal(detail.getCell("AE5").value, 3920);
assert.equal(detail.getCell("AE6").value, 5880);
assert.equal(detail.getCell("AF5").value, 4240);
assert.equal(detail.getCell("AF6").value, 6360);
assert.equal(detail.getCell("AH5").value, 0.06);
assert.equal(detail.getCell("AH7").value, 0.09);
assert.equal((detail.getCell("Z5").value as ExcelJS.CellFormulaValue).result, 0.025);
assert.equal((detail.getCell("Z7").value as ExcelJS.CellFormulaValue).result, 0.04);
const expectedHistoricalTotal = (0.025 * 4900 * 2 + 0.04 * 6860) / (4900 * 2 + 6860);
assert.ok(
  Math.abs(Number((detail.getCell("Z8").value as ExcelJS.CellFormulaValue).result) - expectedHistoricalTotal) < 1e-12,
  "Resident detail total must use the same prior-year-rate and resident weighting basis",
);
const priorPeriod = workbook.getWorksheet("Prior-period bridge")!;
const priorPeriodTotal = priorPeriod.getCell("F7").value as ExcelJS.CellFormulaValue;
assert.ok(
  Math.abs(Number(priorPeriodTotal.result) - expectedHistoricalTotal) < 1e-12,
  "prior-period total must use the prior-year-rate and resident weighting basis",
);
assert.match(String(priorPeriodTotal.formula), /SUMPRODUCT\(F5:F6,B5:B6,L5:L6\)/);
assert.doesNotMatch(String(priorPeriodTotal.formula), /D7-E7/, "prior-period total must not be a YoY residual");
const reportHistoricalTotal = totals.getCell("K7").value as ExcelJS.CellFormulaValue;
assert.ok(
  Math.abs(Number(reportHistoricalTotal.result) - expectedHistoricalTotal) < 1e-12,
  "Report totals must use the same historical weighting basis",
);
assert.equal(
  (detail.getCell("AA5").value as ExcelJS.CellFormulaValue).formula,
  "=$AH5",
  "resident Plan % must link to the resident's saved service-line plan percentage",
);
assert.equal(
  (detail.getCell("AA7").value as ExcelJS.CellFormulaValue).formula,
  "=$AH7",
  "resident Plan % must not use a running cross-line average",
);

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

const legacyPlan = makePlan("AL", 5000, 1);
legacyPlan.standardization = { yearOverYear: null, comparisons: [] };
const legacyBuffer = await buildAnnualReportAuditWorkbook({
  report: {
    id: "legacy-audit-fixture",
    generatedAt: "2026-09-16T12:00:00.000Z",
    scopeKey: "portfolio|AL",
    locationId: null,
    serviceLines: ["AL"],
    plans: [{ sl: "AL", plan: { ...legacyPlan, residents: [] } }] as any,
  },
  detailPlans: [{ sl: "AL", plan: legacyPlan }],
});
const legacyWorkbook = new ExcelJS.Workbook();
await legacyWorkbook.xlsx.load(legacyBuffer);
const legacyTotals = legacyWorkbook.getWorksheet("Report totals")!;
const legacyDetail = legacyWorkbook.getWorksheet("Resident detail")!;
const legacyPriorPeriod = legacyWorkbook.getWorksheet("Prior-period bridge")!;
assert.equal(
  (legacyTotals.getCell("K5").value as ExcelJS.CellFormulaValue).result,
  "Unavailable",
  "legacy report totals must preserve missing historical evidence",
);
assert.equal(
  (legacyDetail.getCell("Z5").value as ExcelJS.CellFormulaValue).result,
  "Unavailable",
  "legacy resident detail must preserve missing historical evidence",
);
assert.equal(
  (legacyPriorPeriod.getCell("F6").value as ExcelJS.CellFormulaValue).result,
  "Unavailable",
  "legacy prior-period total must remain unavailable",
);

const totalRow = totals.getRow(7);
for (const column of formulaColumns) {
  const value = totalRow.getCell(column).value as ExcelJS.CellFormulaValue;
  assert.equal("formula" in value, true, `Report total column ${column} should remain a formula`);
}

console.log("Annual report audit workbook detail-link formulas: passed");