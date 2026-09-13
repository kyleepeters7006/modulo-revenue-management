/**
 * Regression coverage for the quarterly YoY labels shown in the in-house
 * increases page.
 *
 * A partial prior-year quarter is still useful context and must not be
 * presented as if the data were unavailable. A complete quarter remains
 * numeric, while a genuinely absent or projected baseline remains n/a.
 */
import { describe, expect, it } from "vitest";
import {
  formatQuarterLabels,
  formatQuarterYoyDisplay,
  getQuarterYoyDisplay,
  summarizeQuarterYoy,
} from "../client/src/lib/inhouseQuarterYoyDisplay";

function display(overrides: Partial<Parameters<typeof getQuarterYoyDisplay>[0]> = {}) {
  return getQuarterYoyDisplay({
    priorRate: 100,
    yoyGrowthPct: 7.25,
    basis: "actual",
    monthsAvailable: 3,
    priorYearLabel: "Q1 2026",
    ...overrides,
  });
}

describe("quarterly YoY display", () => {
  it("keeps labels distinct when a plan crosses a year boundary", () => {
    expect(formatQuarterLabels([
      { quarter: 4, year: 2026 },
      { quarter: 1, year: 2027 },
    ])).toEqual(["Q4 '26", "Q1 '27"]);
  });

  it("uses compact labels when all plan quarters share one year", () => {
    expect(formatQuarterLabels([
      { quarter: 1, year: 2026 },
      { quarter: 2, year: 2026 },
    ])).toEqual(["Q1", "Q2"]);
  });

  it("shows a partial 2-of-3-month prior-year quarter as Partial (2/3)", () => {
    const quarter = display({
      yoyGrowthPct: 6.4,
      basis: "partial",
      monthsAvailable: 2,
    });

    expect(quarter.qualifierLabel).toBe("Partial (2/3)");
    expect(quarter.yoyPct).toBe(6.4);
    expect(quarter.includedInSummary).toBe(false);
    expect(formatQuarterYoyDisplay(quarter)).toBe("6.4%");
  });

  it("keeps a projected prior-year quarter as n/a", () => {
    const quarter = display({
      priorRate: null,
      yoyGrowthPct: 0,
      basis: "projected",
      monthsAvailable: 0,
    });

    expect(formatQuarterYoyDisplay(quarter)).toBe("n/a");
    expect(quarter.includedInSummary).toBe(false);
  });

  it("shows partial YoY but excludes it from the measured-quarter average", () => {
    const summary = summarizeQuarterYoy([
      {
        priorRate: 100,
        yoyGrowthPct: 7.25,
        basis: "actual",
        monthsAvailable: 3,
        priorYearLabel: "Q1 2026",
      },
      {
        priorRate: 100,
        yoyGrowthPct: 40,
        basis: "partial",
        monthsAvailable: 2,
        priorYearLabel: "Q2 2026",
      },
    ]);

    expect(summary).toEqual({
      averagePct: 7.25,
      measuredQuarterCount: 1,
    });
  });
});
