import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  annualReportHistoricalIncrease,
  annualReportResidentScatterPoints,
  annualReportServiceLineLabel,
  annualRateGrowthBridge,
  compactPlanForAnnualReport,
  hydrateAnnualReportPlanSnapshot,
} from "../shared/inhouseAnnualReportSnapshot";
import {
  CalculationDetailToggle,
  QuarterlySummaryRow,
} from "../client/src/pages/inhouse-increases";
import { WorkbookScatterplots } from "../client/src/pages/annual-report";
import type { PlanResult } from "../shared/inhousePlanning";

const residents = Array.from({ length: 10_000 }, (_, i) => ({
  increasePct: i % 2 ? 4.5 : 6.5,
}));
const roomDetails = Array.from({ length: 10_000 }, (_, i) => ({
  key: `room-${i}`,
  location: "Campus",
  roomNumber: String(i),
}));
const plan = {
  feasible: true,
  rateBasis: "monthly",
  assumptions: {
    rateGrowthTargetPct: 6,
  },
  bindingQuarterLabel: "Q1 2026",
  residents,
  quarters: Array.from({ length: 4 }, (_, i) => {
    const quarter = i + 1;
    return {
      year: 2026,
      quarter,
      label: `Q${quarter} 2026`,
      passes: true,
      requiredRateMonthly: 5100,
      projectedRateMonthly: 5000,
      yoyGrowthPct: 5,
      shortfallPct: 0,
      isBinding: quarter === 1,
      priorYear: {
        year: 2025,
        quarter,
        label: `Q${quarter} 2025`,
        realizedRateMonthly: 4750,
        basis: "actual",
        monthsAvailable: 3,
        monthsExpected: 3,
        residentDays: 100,
      },
      explanation: { headline: "Fixture quarter" },
      roomDetails,
    };
  }),
  summary: {
    residentCount: residents.length,
    residentsReceivingIncrease: residents.length,
  },
  standardization: {
    yearOverYear: {
      baseQuarterLabel: "Q1 2025",
      endingQuarterLabel: "Q1 2026",
      rateEffectPct: 2.25,
      rawChangePct: 3.1,
      mixEffectPct: 0.85,
      matchedRooms: 8,
      endingRooms: 10,
      coverageByCountPct: 80,
      coverageByRevenuePct: 82,
    },
    yearOverYearStrata: [{
      key: "Studio|AL|1",
      rateEffectPct: 2.25,
      endingWeightSharePct: 100,
      baseWeightSharePct: 100,
      matchedRooms: 8,
      endingRooms: 10,
      suppressed: false,
      reasonCode: null,
    }],
    comparisons: [],
  },
} as unknown as PlanResult;

const compact = compactPlanForAnnualReport(plan);
const bytes = Buffer.byteLength(JSON.stringify(compact));
const count = compact.increaseDistribution.reduce((sum, band) => sum + band.count, 0);

const bridge = annualRateGrowthBridge(compact.quarters, compact.rateBasis, 4, 2.25);
if (compact.residents.length !== 0) throw new Error("resident rows were retained");
if (compact.quarters.length !== 4) throw new Error("quarter conclusions were lost");
if ("roomDetails" in compact.quarters[0]) throw new Error("quarter room details were retained");
if ("explanation" in compact.quarters[0]) throw new Error("quarter narratives were retained");
assert.equal(compact.quarters[0].requiredRateMonthly, 5100, "needed rate was not retained");
assert.equal(compact.quarters[0].shortfallPct, 0, "quarter shortfall was not retained");
assert.equal(compact.quarters[0].isBinding, true, "binding quarter was not retained");
if ("streetRateRecommendations" in compact.summary) {
  throw new Error("legacy recommendation rows were retained");
}
if (count !== residents.length) throw new Error(`distribution lost residents: ${count}`);
if (bytes >= 100_000) throw new Error(`snapshot is still too large: ${bytes} bytes`);
assert.equal(compact.historicalIncrease?.definition, "matched_room_rate_effect");
assert.equal(compact.historicalIncrease?.increasePct, 2.25);
assert.equal(compact.historicalIncrease?.basePeriodLabel, "Q1 2025");
assert.equal(compact.historicalIncrease?.strata[0]?.endingWeightSharePct, 100);
assert.equal(annualReportHistoricalIncrease(compact)?.increasePct, 2.25);
assert.equal(bridge?.priorPeriodIncreasePct, 2.25, "historical increase must not be a full-year residual");

const scatterMarkup = renderToStaticMarkup(
  createElement(WorkbookScatterplots, {
    report: {
      plans: [{
        sl: "AL",
        plan: {
          summary: { weightedAvgIncreasePct: 4 },
          streetIncreasePct: 3,
        },
      }],
      tierGrid: { lines: [{ serviceLine: "AL", occupancyPct: 85 }] },
    } as any,
  }),
);
assert.match(scatterMarkup, /AL/, "pricing scatter must render a service-line label");

const scatterPoints = annualReportResidentScatterPoints(
  [{
    sl: "AL",
    plan: {
      scope: { serviceLine: "AL" },
      residents: [
        {
          key: "resident-1",
          location: "Campus A",
          roomNumber: "101",
          roomType: "Studio",
          increasePct: 4.5,
          increaseDollarsMonthly: 225,
        },
        {
          key: "resident-2",
          location: "Campus A",
          roomNumber: "102",
          roomType: "One Bedroom",
          increasePct: 0,
          increaseDollarsMonthly: 0,
        },
      ],
    },
  }],
  { lines: [{ serviceLine: "AL", occupancyPct: 87.5 }] },
);
assert.equal(scatterPoints.length, 2, "scatter projection should keep one point per resident");
assert.deepEqual(
  scatterPoints[0],
  {
    id: "AL|resident-1",
    campus: "Campus A",
    serviceLine: "AL",
    roomNumber: "101",
    roomType: "Studio",
    occupancyPct: 87.5,
    increasePct: 4.5,
    increaseDollarsMonthly: 225,
  },
);
assert.equal(
  annualReportResidentScatterPoints(
    [{ sl: "AL", plan: { scope: { serviceLine: "AL" }, residents: [] } }],
    { lines: [{ serviceLine: "AL", occupancyPct: null }] },
  ).length,
  0,
  "scatter must not turn missing occupancy into a 0% point",
);
assert.equal(annualReportServiceLineLabel("VIL"), "Patio Homes");
assert.equal(annualReportServiceLineLabel("AL/MC"), "AL/MC");

const rolledUpPlan = {
  ...plan,
  residents: [],
  increaseDistribution: [{ label: "6.0%", count: 5 }],
  residentIncreaseDistribution: [{ label: "6.0%", count: 5 }],
} as unknown as PlanResult;
const compactRolledUp = compactPlanForAnnualReport(rolledUpPlan);
assert.deepEqual(
  compactRolledUp.increaseDistribution,
  [{ label: "6.0%", count: 5 }],
  "rollup increase distribution should survive annual-report compaction",
);
assert.deepEqual(
  compactRolledUp.residentIncreaseDistribution,
  [{ label: "6.0%", count: 5 }],
  "rollup resident distribution should survive annual-report compaction",
);

const legacyCompact = JSON.parse(JSON.stringify(compact));
for (const quarter of legacyCompact.quarters) {
  delete quarter.requiredRateMonthly;
  delete quarter.shortfallPct;
  delete quarter.isBinding;
}
const restored = hydrateAnnualReportPlanSnapshot(legacyCompact);
const renderQuarter = () =>
  renderToStaticMarkup(
    createElement(
      "table",
      null,
      createElement(
        "tbody",
        null,
        createElement(QuarterlySummaryRow, {
          plan: restored,
          quarter: restored.quarters[0],
          open: false,
          onToggle: () => {},
        }),
      ),
    ),
  );
assert.doesNotThrow(renderQuarter, "compact quarterly summary should render");
assert.match(renderQuarter(), /\$5,035/, "legacy compact report should recover the needed rate");

const renderDetailToggle = () =>
  renderToStaticMarkup(
    createElement(CalculationDetailToggle, {
      serviceLine: "AL",
      multiplePlans: false,
      feasible: restored.feasible,
      expanded: false,
      detailsAvailable: false,
      onToggle: () => {},
    }),
  );
const detailMarkup = renderDetailToggle();
assert.match(detailMarkup, /disabled/, "compact report detail expansion should be disabled");
assert.match(detailMarkup, /Detail unavailable/, "compact report should explain why detail cannot open");

console.log(`Annual report snapshot payload: ${bytes.toLocaleString()} bytes`);
console.log("Annual report snapshot compaction and render tests: passed");
