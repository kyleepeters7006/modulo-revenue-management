/**
 * Reference Data — same-month Street Rate YoY regression coverage.
 *
 * Run with: npx tsx tests/referenceDataYoY.test.ts
 */
import {
  aggregateSameMonthStreetYoY,
  numericExportValue,
  sameCalendarMonthLastYear,
  sameMonthRateYoYGrowth,
} from "../shared/referenceDataAgg";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function assert(description: string, actual: unknown, expected: unknown) {
  const equal = typeof actual === "number" && typeof expected === "number"
    ? Math.abs(actual - expected) < 1e-9
    : actual === expected;
  if (equal) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log("\n=== Reference Data Street Rate YoY ===\n");

assert(
  "uses the exact same calendar month one year earlier",
  sameCalendarMonthLastYear("2026-03"),
  "2025-03",
);
assert(
  "does not turn an invalid month into a trailing-period comparison",
  sameCalendarMonthLastYear("2026-00"),
  null,
);
assert(
  "calculates YoY from the exact comparison rate",
  sameMonthRateYoYGrowth(140, 100),
  0.4,
);
assert(
  "leaves YoY blank when the prior-year month is missing",
  sameMonthRateYoYGrowth(140, null),
  null,
);

const groupedRows = [
  // Larger group: +100% YoY.
  {
    yoyStreetSpot: 1000,
    yoyStreetBase: 500,
    yoyStreetUnitsSpot: 10,
    yoyStreetUnitsBase: 10,
  },
  // Smaller group: +20% YoY. A child-percentage average would be 60%,
  // while the weighted current/prior averages produce 73.333...%.
  {
    yoyStreetSpot: 300,
    yoyStreetBase: 250,
    yoyStreetUnitsSpot: 1,
    yoyStreetUnitsBase: 1,
  },
];
assert(
  "re-derives grouped YoY from weighted current and prior averages",
  aggregateSameMonthStreetYoY(groupedRows),
  11 / 15,
);
assert(
  "does not treat a missing child comparison month as zero",
  aggregateSameMonthStreetYoY([
    ...groupedRows,
    {
      yoyStreetSpot: 900,
      yoyStreetBase: null,
      yoyStreetUnitsSpot: 20,
      yoyStreetUnitsBase: null,
    },
  ]),
  11 / 15,
);
assert(
  "returns blank when every prior-year comparison is missing",
  aggregateSameMonthStreetYoY([{
    yoyStreetSpot: 1400,
    yoyStreetBase: null,
    yoyStreetUnitsSpot: 10,
    yoyStreetUnitsBase: null,
  }]),
  null,
);
assert(
  "keeps the displayed YoY numeric value in the Excel export",
  numericExportValue(aggregateSameMonthStreetYoY(groupedRows)),
  11 / 15,
);
assert(
  "keeps a blank displayed YoY cell blank in the Excel export",
  numericExportValue(aggregateSameMonthStreetYoY([{
    yoyStreetSpot: 1400,
    yoyStreetBase: null,
    yoyStreetUnitsSpot: 10,
    yoyStreetUnitsBase: null,
  }])),
  null,
);

console.log(`\n${passed + failed} tests total: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);