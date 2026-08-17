import { describe, it, expect, vi } from "vitest";

// The service imports the DB pool for its query-backed functions; the pure
// functions under test never touch it.
vi.mock("../../db", () => ({ pool: {}, db: {} }));
import {
  isSecondOccupantRow,
  dateInMonth,
  median,
  computeShiftWarningsFromMedians,
  MEDIAN_SHIFT_FACTOR,
  type IncomingRentRollRow,
} from "../streetRateQualityService";

describe("isSecondOccupantRow", () => {
  it("matches both 2ND OCCUPANT payor variants", () => {
    expect(isSecondOccupantRow("2ND OCCUPANT")).toBe(true);
    expect(isSecondOccupantRow("LEGACY - 2ND OCCUPANT")).toBe(true);
  });
  it("does not match normal payors or null", () => {
    expect(isSecondOccupantRow("PRIVATE PAY")).toBe(false);
    expect(isSecondOccupantRow("MEDICAID")).toBe(false);
    expect(isSecondOccupantRow(null)).toBe(false);
    expect(isSecondOccupantRow(undefined)).toBe(false);
  });
});

describe("dateInMonth", () => {
  it("handles M/D/YYYY dates", () => {
    expect(dateInMonth("7/19/2026", "2026-07")).toBe(true);
    expect(dateInMonth("6/30/2026", "2026-07")).toBe(false);
    expect(dateInMonth("12/1/2025", "2025-12")).toBe(true);
  });
  it("handles ISO dates", () => {
    expect(dateInMonth("2026-07-24", "2026-07")).toBe(true);
    expect(dateInMonth("2026-06-07", "2026-07")).toBe(false);
  });
  it("handles null/garbage", () => {
    expect(dateInMonth(null, "2026-07")).toBe(false);
    expect(dateInMonth("", "2026-07")).toBe(false);
    expect(dateInMonth("not a date", "2026-07")).toBe(false);
  });
});

describe("median", () => {
  it("computes odd and even medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

function alRows(location: string, rate: number, n: number, extra: Partial<IncomingRentRollRow> = {}): IncomingRentRollRow[] {
  return Array.from({ length: n }, (_, i) => ({
    location,
    roomNumber: `${100 + i}/A`,
    serviceLine: "AL",
    streetRate: rate,
    payorType: "PRIVATE PAY",
    ...extra,
  }));
}

describe("computeShiftWarningsFromMedians", () => {
  const month = "2026-08";
  const prevMonth = "2026-07";

  it("warns on a ~30x drop (monthly -> daily unit change)", () => {
    const prev = new Map([["Goshen SL - 2184||AL", 4620]]);
    const warnings = computeShiftWarningsFromMedians(alRows("Goshen SL - 2184", 154, 50), prev, month, prevMonth);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Goshen SL - 2184 (AL)");
    expect(warnings[0]).toContain("drop");
    expect(warnings[0]).toContain("NOT blocked");
  });

  it("warns on a large jump (daily -> monthly)", () => {
    const prev = new Map([["Goshen SL - 2184||AL", 154]]);
    const warnings = computeShiftWarningsFromMedians(alRows("Goshen SL - 2184", 4620, 50), prev, month, prevMonth);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("jump");
  });

  it("stays silent for a genuine repricing below the factor", () => {
    const prev = new Map([["Lima SL - 433||AL", 6000]]);
    const warnings = computeShiftWarningsFromMedians(alRows("Lima SL - 433", 6600, 40), prev, month, prevMonth);
    expect(warnings).toHaveLength(0);
  });

  it("compares per service line, not per campus (daily HC does not poison monthly AL)", () => {
    // Same campus: monthly AL rows and daily HC rows. Prev medians per line
    // are stable, so no warning should fire even though a campus-wide median
    // would swing with the bed mix.
    const prev = new Map([
      ["Howell - 2509||AL", 6439],
      ["Howell - 2509||HC", 539],
    ]);
    const rows = [
      ...alRows("Howell - 2509", 6599, 10),
      ...alRows("Howell - 2509", 429, 40, { serviceLine: "HC" }),
    ];
    expect(computeShiftWarningsFromMedians(rows, prev, month, prevMonth)).toHaveLength(0);
  });

  it("excludes 2ND OCCUPANT rows from the median", () => {
    const prev = new Map([["Anderson - 112||AL", 5000]]);
    const rows = [
      ...alRows("Anderson - 112", 5100, 10),
      // A flood of second-occupant surcharges that would otherwise crater the median
      ...alRows("Anderson - 112", 449, 40, { payorType: "2ND OCCUPANT" }),
      ...alRows("Anderson - 112", 449, 40, { payorType: "LEGACY - 2ND OCCUPANT" }),
    ];
    expect(computeShiftWarningsFromMedians(rows, prev, month, prevMonth)).toHaveLength(0);
  });

  it("excludes senior-housing B-bed rows but keeps HC bed rows", () => {
    const prev = new Map([["Lima SL - 433||AL", 5000]]);
    const rows = [
      ...alRows("Lima SL - 433", 5100, 10),
      // Companion B-beds at surcharge-like rates must not drag the median
      ...Array.from({ length: 40 }, (_, i) => ({
        location: "Lima SL - 433",
        roomNumber: `${200 + i}/B`,
        serviceLine: "AL",
        streetRate: 449,
        payorType: "PRIVATE PAY",
      })),
    ];
    expect(computeShiftWarningsFromMedians(rows, prev, month, prevMonth)).toHaveLength(0);
  });

  it("ignores zero rates and campuses with no prior month", () => {
    const prev = new Map<string, number>();
    const rows = [
      ...alRows("Brand New Campus", 5000, 10),
      ...alRows("Brand New Campus", 0, 5),
    ];
    expect(computeShiftWarningsFromMedians(rows, prev, month, prevMonth)).toHaveLength(0);
  });

  it("uses the documented factor boundary", () => {
    const prev = new Map([["X||AL", 1000]]);
    expect(
      computeShiftWarningsFromMedians(alRows("X", 1000 * MEDIAN_SHIFT_FACTOR, 5), prev, month, prevMonth),
    ).toHaveLength(1);
    expect(
      computeShiftWarningsFromMedians(alRows("X", 1000 * MEDIAN_SHIFT_FACTOR - 1, 5), prev, month, prevMonth),
    ).toHaveLength(0);
  });
});
