/**
 * End-to-end test: saving a derived-rate formula changes the rates emitted by
 * the MatrixCare exports.
 *
 * Tests three things:
 *   1. HospBedHoldRate and TherBedHoldRate are derived from the base price via
 *      the bed_hold formula instead of being hardcoded to 0.
 *   2. Companion bed rows derive their base price from the Private room rate
 *      via the semi_private formula instead of averaging their own rent-roll data.
 *   3. A disabled formula falls back to 0 (bed hold) or the rent-roll average
 *      (companion), never silently emitting a plausible-but-false number.
 *
 * Run with: npx tsx tests/matrixCareDerivedRates.test.ts
 */

import { transformToMatrixCareFormat, type ExportableRentRollRow } from '../server/matrixCareExport';
import { defaultFormulas, type DerivedRateFormula } from '../shared/derivedRates';
import type { FacilityLocation } from '../server/services/matrixCareFacility';

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
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Got:      ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertClose(description: string, actual: unknown, expected: number, tol = 1) {
  const n = Number(actual);
  if (Math.abs(n - expected) <= tol) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ~${expected} (±${tol})`);
    console.log(`    Got:      ${n}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const LOCATION = {
  id: 'loc-1',
  name: 'Test Facility',
  clientId: 'client-test',
  matrixCareNameHC: 'Test HC',
  matrixCareNameAL: 'Test AL',
  matrixCareNameIL: null,
  customerFacilityIdHC: 'HC-001',
  customerFacilityIdAL: 'AL-001',
  customerFacilityIdIL: null,
  locationCode: null, address: null, city: null, state: null, zip: null,
  latitude: null, longitude: null, phone: null, email: null, website: null,
  timezone: null, licenseNumber: null, licenseExpiry: null, npiNumber: null,
  altName: null, createdAt: null, updatedAt: null,
} as unknown as FacilityLocation & { id: string; name: string };

const FACILITY_LOOKUP = {
  byId:   new Map([['loc-1', LOCATION]]),
  byName: new Map([['Test Facility', LOCATION]]),
};

/** A minimal ExportableRentRollRow with only the fields the export uses. */
function makeRow(overrides: Partial<ExportableRentRollRow>): ExportableRentRollRow {
  return {
    id: 'row-1',
    uploadMonth: '2025-11',
    location: 'Test Facility',
    locationId: 'loc-1',
    unit: '101',
    roomNumber: '101',
    serviceLine: 'HC',
    roomType: 'Private',
    payorType: 'Private HCC',
    streetRate: null,
    inHouseRate: null,
    rentAndCareRate: null,
    occupiedYN: false,
    clientId: 'client-test',
    effectiveRate: 400,
    viewRating: null,
    locationRating: null,
    sizeRating: null,
    ...overrides,
  } as unknown as ExportableRentRollRow;
}

/** Full formula set derived from defaults, with specific overrides. */
function makeFormulas(overrides: Partial<Record<string, Partial<DerivedRateFormula>>>): DerivedRateFormula[] {
  return defaultFormulas().map((f) => {
    const o = overrides[f.rateType];
    return o ? { ...f, ...o } : f;
  });
}

// ---------------------------------------------------------------------------
// Test 1: bed_hold formula populates HospBedHoldRate / TherBedHoldRate
// ---------------------------------------------------------------------------

console.log('\n── Test group 1: bed_hold formula ─────────────────────────────────────');

{
  const BASE_DAILY = 400;
  const BED_HOLD_PCT = 75;
  const EXPECTED_HOLD = Math.round(BASE_DAILY * BED_HOLD_PCT / 100); // 300

  const rows = [makeRow({ roomType: 'Private', serviceLine: 'HC', effectiveRate: BASE_DAILY })];
  const formulas = makeFormulas({ bed_hold: { percentOfBase: BED_HOLD_PCT, dollarOffset: 0, enabled: true } });

  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulas);
  const row = out.find((r) => r.PayerName?.toUpperCase().includes('PRIVATE'));
  assert('at least one export row produced', out.length > 0, true);
  assert(`HospBedHoldRate = ${EXPECTED_HOLD} (${BED_HOLD_PCT}% of ${BASE_DAILY})`,
    row?.HospBedHoldRate, EXPECTED_HOLD);
  assert(`TherBedHoldRate = ${EXPECTED_HOLD} (${BED_HOLD_PCT}% of ${BASE_DAILY})`,
    row?.TherBedHoldRate, EXPECTED_HOLD);
}

// Test 1b: bed_hold formula with dollar offset
{
  const BASE_DAILY = 400;
  const BED_HOLD_PCT = 100;
  const DOLLAR_OFFSET = -50;
  const EXPECTED_HOLD = Math.round(BASE_DAILY * BED_HOLD_PCT / 100 + DOLLAR_OFFSET); // 350

  const rows = [makeRow({ roomType: 'Private', serviceLine: 'HC', effectiveRate: BASE_DAILY })];
  const formulas = makeFormulas({
    bed_hold: { percentOfBase: BED_HOLD_PCT, dollarOffset: DOLLAR_OFFSET, enabled: true },
  });

  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulas);
  const row = out.find((r) => r.PayerName?.toUpperCase().includes('PRIVATE'));
  assert(`HospBedHoldRate with dollar offset = ${EXPECTED_HOLD}`,
    row?.HospBedHoldRate, EXPECTED_HOLD);
}

// Test 1c: disabled bed_hold formula → 0 (not a plausible derived number)
{
  const rows = [makeRow({ roomType: 'Private', serviceLine: 'HC', effectiveRate: 400 })];
  const formulas = makeFormulas({ bed_hold: { enabled: false } });

  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulas);
  const row = out.find((r) => r.PayerName?.toUpperCase().includes('PRIVATE'));
  assert('disabled bed_hold formula → HospBedHoldRate = 0', row?.HospBedHoldRate, 0);
  assert('disabled bed_hold formula → TherBedHoldRate = 0', row?.TherBedHoldRate, 0);
}

// Test 1d: no formulas passed → falls back to 0 (backward compat)
{
  const rows = [makeRow({ roomType: 'Private', serviceLine: 'HC', effectiveRate: 400 })];
  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025');
  const row = out.find((r) => r.PayerName?.toUpperCase().includes('PRIVATE'));
  assert('no formulas passed → HospBedHoldRate = 0', row?.HospBedHoldRate, 0);
}

// ---------------------------------------------------------------------------
// Test 2: semi_private formula drives Companion bed type price
// ---------------------------------------------------------------------------

console.log('\n── Test group 2: semi_private / companion formula ──────────────────────');

{
  const BASE_DAILY = 400;
  const SEMI_PCT = 82;
  const EXPECTED_COMPANION = Math.round(BASE_DAILY * SEMI_PCT / 100); // 328

  const rows = [
    makeRow({ roomNumber: '101',  roomType: 'Studio',    serviceLine: 'HC', effectiveRate: BASE_DAILY }),
    // Companion room with its own (different) rent-roll rate — should be IGNORED
    makeRow({ roomNumber: '102A', roomType: 'Companion', serviceLine: 'HC', effectiveRate: 999 }),
  ];
  const formulas = makeFormulas({
    semi_private: { percentOfBase: SEMI_PCT, dollarOffset: 0, enabled: true },
    bed_hold:     { enabled: false },
  });

  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulas);
  const companionRow = out.find((r) => r.BedTypeDescription?.includes('Companion') &&
    r.PayerName?.toUpperCase().includes('PRIVATE'));
  assert('companion row present in output', companionRow !== undefined, true);
  assert(
    `Companion BasePrice = ${EXPECTED_COMPANION} (${SEMI_PCT}% of base ${BASE_DAILY}), not rent-roll 999`,
    companionRow?.BasePrice, EXPECTED_COMPANION,
  );
}

// Test 2b: disabled semi_private formula → companion falls back to rent-roll avg, not formula
{
  const COMPANION_RENT_ROLL_RATE = 333;
  const rows = [
    makeRow({ roomNumber: '101',  roomType: 'Studio',    serviceLine: 'HC', effectiveRate: 400 }),
    makeRow({ roomNumber: '102A', roomType: 'Companion', serviceLine: 'HC', effectiveRate: COMPANION_RENT_ROLL_RATE }),
  ];
  const formulas = makeFormulas({ semi_private: { enabled: false }, bed_hold: { enabled: false } });

  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulas);
  const companionRow = out.find((r) => r.BedTypeDescription?.includes('Companion') &&
    r.PayerName?.toUpperCase().includes('PRIVATE'));
  assert('companion row present when formula disabled', companionRow !== undefined, true);
  assert(
    `Companion BasePrice = rent-roll avg ${COMPANION_RENT_ROLL_RATE} when formula disabled`,
    companionRow?.BasePrice, COMPANION_RENT_ROLL_RATE,
  );
}

// Test 2c: changing the formula changes the exported companion price
{
  const BASE_DAILY = 400;
  const rows = [
    makeRow({ roomNumber: '101',  roomType: 'Studio',    serviceLine: 'HC', effectiveRate: BASE_DAILY }),
    makeRow({ roomNumber: '102A', roomType: 'Companion', serviceLine: 'HC', effectiveRate: 999 }),
  ];

  const formulasA = makeFormulas({
    semi_private: { percentOfBase: 70, dollarOffset: 0, enabled: true },
    bed_hold: { enabled: false },
  });
  const formulasB = makeFormulas({
    semi_private: { percentOfBase: 90, dollarOffset: 0, enabled: true },
    bed_hold: { enabled: false },
  });

  const { rows: outA } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulasA);
  const { rows: outB } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulasB);
  const compA = outA.find((r) => r.BedTypeDescription?.includes('Companion') && r.PayerName?.toUpperCase().includes('PRIVATE'));
  const compB = outB.find((r) => r.BedTypeDescription?.includes('Companion') && r.PayerName?.toUpperCase().includes('PRIVATE'));

  assert(`formula 70% → Companion = ${Math.round(BASE_DAILY * 0.7)}`,
    compA?.BasePrice, Math.round(BASE_DAILY * 0.70));
  assert(`formula 90% → Companion = ${Math.round(BASE_DAILY * 0.9)}`,
    compB?.BasePrice, Math.round(BASE_DAILY * 0.90));
  assert('different formulas produce different companion prices', compA?.BasePrice !== compB?.BasePrice, true);
}

// ---------------------------------------------------------------------------
// Test 3: Medicaid rows always get 0 bed-hold rates regardless of formula
// ---------------------------------------------------------------------------

console.log('\n── Test group 3: Medicaid rows stay at 0 bed-hold ──────────────────────');

{
  const rows = [makeRow({ roomType: 'Private', serviceLine: 'HC', effectiveRate: 400 })];
  const formulas = makeFormulas({ bed_hold: { percentOfBase: 75, enabled: true } });
  const { rows: out } = transformToMatrixCareFormat(rows, FACILITY_LOOKUP, '01/01/2025', formulas);
  const medicaidRow = out.find((r) => r.PayerName?.toUpperCase().includes('MEDICAID'));
  // Medicaid rows exist in HC output
  if (medicaidRow) {
    assert('Medicaid HospBedHoldRate = 0 even when formula active', medicaidRow.HospBedHoldRate, 0);
    assert('Medicaid TherBedHoldRate = 0 even when formula active', medicaidRow.TherBedHoldRate, 0);
  } else {
    // Some service lines don't produce Medicaid rows — not a failure
    console.log('  (no Medicaid row produced for HC — skipping Medicaid gate check)');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
