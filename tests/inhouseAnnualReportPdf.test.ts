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

(async () => {
const buffer = await generateAnnualInhouseReportPdf({
  scopeKey: "portfolio",
  locationId: null,
  serviceLines: ["AL"],
  plans: [{
    sl: "AL",
    plan: {
      scope: { serviceLine: "AL" },
      feasible: true,
      rateBasis: "monthly",
      currentStreetRateDisplay: 2_000,
      recommendedStreetRateDisplay: 2_100,
      summary: {
        totalMonthlyIncreaseDollars: 1_000,
        totalAnnualIncreaseDollars: 12_000,
        residentsReceivingIncrease: 10,
        residentCount: 12,
        minIncreasePct: 2,
        maxIncreasePct: 5,
        newAvgInhouseRateMonthly: 1_900,
      },
      monthlyRateProjection: [{
        month: "Q1 2026",
        projectedRateMonthly: 1_900,
        streetRateMonthly: 2_100,
      }],
      explanation: { headline: "Keep increases within target." },
    },
  }],
  tierGrid: {
    lines: [{
      serviceLine: "AL",
      currentTier: "target",
      cells: [{
        tier: "target",
        isCurrent: true,
        inhouseIncreasePct: 4,
        streetIncreasePct: 3,
        feasible: true,
      }],
    }],
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