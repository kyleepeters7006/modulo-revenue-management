/**
 * Standalone regression coverage for the annual report PDF contract.
 *
 * This intentionally uses a saved-shaped payload rather than the calculation
 * service: PDF generation must render the snapshot and must not recalculate.
 * The attached executive workbook template establishes a fixed two-page
 * landscape contract.
 * Run with: npx tsx tests/inhouseAnnualReportPdf.test.ts
 */
import assert from "node:assert/strict";
import { generateAnnualInhouseReportPdf } from "../server/services/inhouseAnnualReportPdf";
import {
  annualRateGrowthBridge,
  annualRateGrowthRevenue,
} from "../shared/inhouseAnnualReportSnapshot";

(async () => {
const bridge = annualRateGrowthBridge(
  [1, 2, 3, 4].map((quarter) => ({
    year: 2027,
    quarter,
    label: `Q${quarter} 2027`,
    passes: true,
    projectedRateMonthly: 107,
    yoyGrowthPct: 7,
    priorYear: {
      year: 2026,
      quarter,
      realizedRateMonthly: 100,
    },
  })) as any,
  "monthly",
  4,
);
assert.ok(bridge, "annual growth bridge is available");
assert.ok(Math.abs(bridge.priorPeriodIncreasePct - 3) < 1e-9);
assert.ok(Math.abs(bridge.planIncreasePct - 4) < 1e-9);
assert.ok(Math.abs(bridge.fullYearYoyPct - 7) < 1e-9);
assert.equal(annualRateGrowthRevenue(bridge, 10), 840);

const serviceLines = ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"];
const buffer = await generateAnnualInhouseReportPdf({
  scopeKey: "portfolio",
  locationId: null,
  serviceLines,
  plans: serviceLines.map((sl, index) => ({
    sl,
    plan: {
      scope: { serviceLine: sl },
      feasible: true,
      rateBasis: sl.startsWith("HC") ? "daily" : "monthly",
      currentStreetRateMonthly: 2_000 + index * 100,
      recommendedStreetRateMonthly: 2_100 + index * 100,
      currentStreetRateDisplay: 2_000 + index * 100,
      recommendedStreetRateDisplay: 2_100 + index * 100,
      streetIncreasePct: 5,
      summary: {
        totalMonthlyIncreaseDollars: 1_000 + index * 100,
        totalAnnualIncreaseDollars: 12_000 + index * 1_200,
        residentsReceivingIncrease: 10 + index,
        residentCount: 12 + index,
        minIncreasePct: 2,
        maxIncreasePct: 5,
        currentAvgInhouseRateMonthly: 1_800 + index * 100,
        newAvgInhouseRateMonthly: 1_900 + index * 100,
        weightedAvgIncreasePct: 4,
      },
      quarters: [1, 2, 3, 4].map((quarter) => ({
        year: 2027,
        quarter,
        label: `Q${quarter} 2027`,
        passes: true,
        projectedRateMonthly: (1_700 + index * 100) * 1.07,
        yoyGrowthPct: 7,
        priorYear: {
          year: 2026,
          quarter,
          realizedRateMonthly: 1_700 + index * 100,
        },
      })),
      monthlyRateProjection: [{
        month: "Q1 2026",
        projectedRateMonthly: 1_900 + index * 100,
        streetRateMonthly: 2_100 + index * 100,
      }],
      explanation: { headline: "Keep increases within target." },
    },
  })),
  tierGrid: {
    lines: serviceLines.map((serviceLine, index) => ({
      serviceLine,
      currentTier: "target",
      occupancyPct: 88 + index,
      cells: ["high", "target", "low"].map((tier, tierIndex) => ({
        tier,
        isCurrent: tier === "target",
        inhouseIncreasePct: 3 + tierIndex,
        streetIncreasePct: 2 + tierIndex,
        feasible: true,
      })),
    })),
  },
  generatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

assert.ok(buffer.length > 0, "PDF buffer is non-empty");
assert.equal(
  [...buffer.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
  2,
  "annual report PDF is exactly two pages",
);
console.log("Annual in-house report PDF tests: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});