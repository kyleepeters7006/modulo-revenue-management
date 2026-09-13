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
  formatQuarterYoyDisplay,
  getQuarterYoyDisplay,
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
  it("shows a partial 2-of-3-month prior-year quarter as Partial (2/3)", () => {
    const quarter = display({
      basis: "partial",
      monthsAvailable: 2,
    });

    expect(formatQuarterYoyDisplay(quarter)).toBe("Partial (2/3)");
  });

  it("shows a complete prior-year quarter with its numeric YoY", () => {
    const quarter = display();

    expect(formatQuarterYoyDisplay(quarter)).toBe("7.3%");
  });

  it("keeps a genuinely absent prior-year quarter as n/a", () => {
    const quarter = display({
      priorRate: null,
      yoyGrowthPct: 0,
      basis: "actual",
      monthsAvailable: 0,
    });

    expect(formatQuarterYoyDisplay(quarter)).toBe("n/a");
  });

  it("keeps a projected prior-year quarter as n/a", () => {
    const quarter = display({
      priorRate: null,
      yoyGrowthPct: 0,
      basis: "projected",
      monthsAvailable: 0,
    });

    expect(formatQuarterYoyDisplay(quarter)).toBe("n/a");
  });
});