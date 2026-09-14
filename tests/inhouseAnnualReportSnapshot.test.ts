import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compactPlanForAnnualReport } from "../client/src/lib/inhouseAnnualReportSnapshot";
import {
  CalculationDetailToggle,
  QuarterlySummaryRow,
} from "../client/src/pages/inhouse-increases";
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
} as unknown as PlanResult;

const compact = compactPlanForAnnualReport(plan);
const bytes = Buffer.byteLength(JSON.stringify(compact));
const count = compact.increaseDistribution.reduce((sum, band) => sum + band.count, 0);

if (compact.residents.length !== 0) throw new Error("resident rows were retained");
if (compact.quarters.length !== 4) throw new Error("quarter conclusions were lost");
if ("roomDetails" in compact.quarters[0]) throw new Error("quarter room details were retained");
if ("explanation" in compact.quarters[0]) throw new Error("quarter narratives were retained");
if ("requiredRateMonthly" in compact.quarters[0]) throw new Error("solver-only quarter rates were retained");
if ("streetRateRecommendations" in compact.summary) {
  throw new Error("legacy recommendation rows were retained");
}
if (count !== residents.length) throw new Error(`distribution lost residents: ${count}`);
if (bytes >= 100_000) throw new Error(`snapshot is still too large: ${bytes} bytes`);

const restored = JSON.parse(JSON.stringify(compact));
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
assert.match(renderQuarter(), /—/, "omitted quarter rates should display as an em dash");

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