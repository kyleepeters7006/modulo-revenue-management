/**
 * Regression tests for B-bed (companion bed) exclusion from street rate averages.
 * Task: Fix B-bed rows being included in street rate averages for senior housing SLs.
 *
 * The shared predicate lives in shared/bBed.ts and is imported by the pricing
 * services, so these tests exercise the exact production logic:
 *  - Senior housing SLs (AL, AL/MC, SL, VIL): rows with a letter-suffixed
 *    room_number (e.g. "101/B") are companion beds and must be excluded.
 *  - HC and HC/MC: every bed row is a separate billable resident and must be kept.
 *
 * Run with: npx tsx tests/bBedExclusion.test.ts
 */
import { isBBedRow, SENIOR_HOUSING_SLS, B_BED_ROOM_RE } from '../shared/bBed';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0;
let failed = 0;

function assert(description: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('\n=== B-bed exclusion predicate ===\n');

// --- Senior housing SLs: letter-suffixed rooms are excluded ---
for (const sl of ['AL', 'AL/MC', 'SL', 'VIL']) {
  assert(`${sl} 101/B excluded (companion B-bed)`, isBBedRow(sl, '101/B'), true);
  assert(`${sl} 101/b excluded (lowercase companion)`, isBBedRow(sl, '101/b'), true);
  assert(`${sl} 101/A kept (primary bed — Princeton regression)`, isBBedRow(sl, '101/A'), false);
  assert(`${sl} 205/BB kept (multi-letter suffix, no match)`, isBBedRow(sl, '205/BB'), false);
  assert(`${sl} plain room 101 kept`, isBBedRow(sl, '101'), false);
}

// --- HC / HC/MC: every bed row kept, even with letter suffixes ---
for (const sl of ['HC', 'HC/MC']) {
  assert(`${sl} 101/B kept (separate billable resident)`, isBBedRow(sl, '101/B'), false);
  assert(`${sl} 101 kept`, isBBedRow(sl, '101'), false);
}

// --- Edge cases ---
assert('AL room ending in digit after slash kept (101/2)', isBBedRow('AL', '101/2'), false);
assert('AL letter not after slash kept (101B)', isBBedRow('AL', '101B'), false);
assert('AL null room kept', isBBedRow('AL', null), false);
assert('AL empty room kept', isBBedRow('AL', ''), false);
assert('null service line kept', isBBedRow(null, '101/B'), false);
assert('Unknown SL kept (IL not in senior housing set)', isBBedRow('IL', '101/B'), false);

// --- Constants sanity (SQL clauses across routes mirror these) ---
assert('SH set has exactly 4 SLs', SENIOR_HOUSING_SLS.size, 4);
assert('Regex matches /B suffix', B_BED_ROOM_RE.test('101/B'), true);
assert('Regex does not match mid-string letter (10B/2)', B_BED_ROOM_RE.test('10B/2'), false);

// --- Average behavior: one rate per physical room for SH; all beds for HC ---
type Row = { service_line: string; room_number: string; street_rate: number };
const avgStreet = (rows: Row[]) => {
  const kept = rows.filter(r => !isBBedRow(r.service_line, r.room_number));
  return kept.reduce((s, r) => s + r.street_rate, 0) / kept.length;
};

const alRows: Row[] = [
  { service_line: 'AL', room_number: '101', street_rate: 5000 },
  { service_line: 'AL', room_number: '101/B', street_rate: 3000 }, // companion, excluded
  { service_line: 'AL', room_number: '102', street_rate: 6000 },
];
assert('AL average uses primary units only ((5000+6000)/2)', avgStreet(alRows), 5500);

const hcRows: Row[] = [
  { service_line: 'HC', room_number: '201/A', street_rate: 300 },
  { service_line: 'HC', room_number: '201/B', street_rate: 280 },
];
assert('HC average keeps both beds ((300+280)/2)', avgStreet(hcRows), 290);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
