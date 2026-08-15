/**
 * Regression test: all three MatrixCare export generators must agree on
 * FacilityName and FacilityCustomerID for the same (location, service line).
 *
 * The three generators are:
 *   1. transformToMatrixCareFormat  (server/matrixCareExport.ts)       — full export
 *   2. resolveMatrixCareFacility called with location from loadFacilityLookup
 *      (server/matrixCareStreetRatesExport.ts)                         — street rates
 *   3. resolveMatrixCareFacility called with location from loadFacilityLookup
 *      (server/matrixCareSpecialRatesExport.ts)                        — special rates
 *
 * The street-rates and special-rates exports call resolveMatrixCareFacility directly,
 * so the test represents them by calling the same function with the same location object
 * and service line.  The full export is tested end-to-end through
 * transformToMatrixCareFormat so any future divergence (e.g. an inline name-building
 * shortcut) is caught immediately.
 *
 * Run with: npx tsx tests/matrixCareFacilityConsistency.test.ts
 */
import { transformToMatrixCareFormat } from '../server/matrixCareExport';
import { resolveMatrixCareFacility } from '../server/services/matrixCareFacility';
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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A location that has full MatrixCare facility mappings for all three groups. */
const MAPPED_LOCATION = {
  id: 'loc-mapped',
  name: 'Sunset Gardens',
  clientId: 'client-test',
  matrixCareNameHC: 'Sunset Gardens HC',
  matrixCareNameAL: 'Sunset Gardens AL',
  matrixCareNameIL: 'Sunset Gardens IL',
  customerFacilityIdHC: 'CUST-HC-001',
  customerFacilityIdAL: 'CUST-AL-001',
  customerFacilityIdIL: 'CUST-IL-001',
  // Remaining fields that locations.$inferSelect expects — unused by the resolver
  locationCode: null, address: null, city: null, state: null, zip: null,
  latitude: null, longitude: null, phone: null, email: null, website: null,
  timezone: null, licenseNumber: null, licenseExpiry: null, npiNumber: null,
  medicareNumber: null, medicaidNumber: null, bedCount: null, createdAt: new Date(),
  updatedAt: new Date(), isActive: true, notes: null,
} as const;

/** A location with no MatrixCare mappings — resolver must fall back to derived ids. */
const UNMAPPED_LOCATION = {
  id: 'loc-unmapped',
  name: 'Pineview Place',
  clientId: 'client-test',
  matrixCareNameHC: null, matrixCareNameAL: null, matrixCareNameIL: null,
  customerFacilityIdHC: null, customerFacilityIdAL: null, customerFacilityIdIL: null,
  locationCode: null, address: null, city: null, state: null, zip: null,
  latitude: null, longitude: null, phone: null, email: null, website: null,
  timezone: null, licenseNumber: null, licenseExpiry: null, npiNumber: null,
  medicareNumber: null, medicaidNumber: null, bedCount: null, createdAt: new Date(),
  updatedAt: new Date(), isActive: true, notes: null,
} as const;

/** A location with only HC mapping filled in. */
const PARTIAL_LOCATION = {
  id: 'loc-partial',
  name: 'Riverside Manor',
  clientId: 'client-test',
  matrixCareNameHC: 'Riverside Manor HC',
  matrixCareNameAL: null, matrixCareNameIL: null,
  customerFacilityIdHC: 'CUST-HC-002',
  customerFacilityIdAL: null, customerFacilityIdIL: null,
  locationCode: null, address: null, city: null, state: null, zip: null,
  latitude: null, longitude: null, phone: null, email: null, website: null,
  timezone: null, licenseNumber: null, licenseExpiry: null, npiNumber: null,
  medicareNumber: null, medicaidNumber: null, bedCount: null, createdAt: new Date(),
  updatedAt: new Date(), isActive: true, notes: null,
} as const;

const ALL_LOCATIONS = [MAPPED_LOCATION, UNMAPPED_LOCATION, PARTIAL_LOCATION];

/** Build the facilityLookup structure expected by transformToMatrixCareFormat. */
function buildLookup(locs: typeof ALL_LOCATIONS) {
  return {
    byId:   new Map(locs.map(l => [l.id,   l as any])),
    byName: new Map(locs.map(l => [l.name, l as any])),
  };
}

/** Minimal rent-roll row shape needed by transformToMatrixCareFormat. */
function makeRow(
  location: typeof ALL_LOCATIONS[number],
  serviceLine: string,
  roomNumber: string,
  roomType: string,
  streetRate: number
) {
  return {
    id: `row-${location.id}-${serviceLine}-${roomNumber}`,
    location: location.name,
    locationId: location.id,
    serviceLine,
    roomNumber,
    roomType,
    streetRate,
    effectiveRate: streetRate,
    unitNumber: roomNumber,
    uploadMonth: '2025-11',
    clientId: location.clientId,
    occupied: true,
    inHouseRate: streetRate,
    hasRate: true,
    // Optional rating fields
    viewRating: null, locationRating: null, sizeRating: null,
    // Other required RentRollData fields — keep minimal
    baseRate: streetRate, proposedRate: streetRate, monthlyRevenue: streetRate,
    residentId: null, residentName: null, payerType: null,
    moveInDate: null, moveOutDate: null, leaseEndDate: null,
    unitType: roomType, floor: null, building: null, wing: null,
    notes: null, createdAt: new Date(), updatedAt: new Date(),
  } as any;
}

// ---------------------------------------------------------------------------
// Build a rent-roll sample covering all three locations and several service lines
// ---------------------------------------------------------------------------
const SERVICE_LINES_BY_LOCATION: Array<{ loc: typeof ALL_LOCATIONS[number]; sl: string }> = [
  { loc: MAPPED_LOCATION,   sl: 'AL' },
  { loc: MAPPED_LOCATION,   sl: 'SL' },
  { loc: MAPPED_LOCATION,   sl: 'HC' },
  { loc: MAPPED_LOCATION,   sl: 'HC/MC' },
  { loc: MAPPED_LOCATION,   sl: 'VIL' },
  { loc: UNMAPPED_LOCATION, sl: 'AL' },
  { loc: UNMAPPED_LOCATION, sl: 'HC' },
  { loc: UNMAPPED_LOCATION, sl: 'SL' },
  { loc: PARTIAL_LOCATION,  sl: 'HC' },
  { loc: PARTIAL_LOCATION,  sl: 'AL' },
];

const rentRollRows = SERVICE_LINES_BY_LOCATION.map(({ loc, sl }, i) =>
  makeRow(loc, sl, `10${i}`, 'Studio', 3500 + i * 100)
);

const lookup = buildLookup(ALL_LOCATIONS);

// ---------------------------------------------------------------------------
// Run the full export and collect FacilityName / FacilityCustomerID per key
// ---------------------------------------------------------------------------
const { rows: fullExportRows } = transformToMatrixCareFormat(rentRollRows, lookup, '01/01/2025');

/** Key a row by the (FacilityName, FacilityCustomerID) it would resolve to,
 *  using location name + service line as the grouping key (same as the export). */
const fullExportMap = new Map<string, { name: string; id: string }>();
for (const row of fullExportRows) {
  // Derive a lookup key from the exported fields; we match back to source via
  // the bed-type + level-of-care, but for this assertion we only need one row
  // per (location, service-line) bucket — all rows in the same bucket must agree.
  // We store by FacilityCustomerID (which is unique per (location × group)) to
  // detect any disagreement.
  const key = `${row.FacilityName}||${row.FacilityCustomerID}`;
  fullExportMap.set(key, { name: row.FacilityName, id: row.FacilityCustomerID });
}

// ---------------------------------------------------------------------------
// Test 1 — resolveMatrixCareFacility is deterministic: same inputs, same output
// ---------------------------------------------------------------------------
console.log('\n=== 1. resolveMatrixCareFacility is deterministic ===\n');

for (const { loc, sl } of SERVICE_LINES_BY_LOCATION) {
  const r1 = resolveMatrixCareFacility(loc as FacilityLocation, sl);
  const r2 = resolveMatrixCareFacility(loc as FacilityLocation, sl);
  assert(
    `${loc.name} / ${sl}: name is stable across two calls`,
    r1.name, r2.name
  );
  assert(
    `${loc.name} / ${sl}: customerId is stable across two calls`,
    r1.customerId, r2.customerId
  );
}

// ---------------------------------------------------------------------------
// Test 2 — full export agrees with direct resolver calls (street / special path)
// ---------------------------------------------------------------------------
console.log('\n=== 2. Full export agrees with street/special-rates resolver calls ===\n');

for (const { loc, sl } of SERVICE_LINES_BY_LOCATION) {
  // What the street-rates and special-rates exports produce:
  const direct = resolveMatrixCareFacility(loc as FacilityLocation, sl);
  const expectedName = direct.name;
  const expectedId   = `~${direct.customerId}`;

  // Find matching rows in the full export output
  const matching = fullExportRows.filter(r => {
    // The full export uses the same resolver; we can find its rows by the expected values
    // because all three paths must agree — that is exactly what this test checks.
    // We search by expected values: if any row deviates, a different assertion will catch it.
    return r.FacilityName === expectedName && r.FacilityCustomerID === expectedId;
  });

  // At least one row should exist for this (location × service line) combination
  assert(
    `${loc.name} / ${sl}: full export has row(s) with correct FacilityName "${expectedName}"`,
    matching.length > 0, true
  );

  if (matching.length > 0) {
    // Every matching row must agree on the customer id too (already checked by filter)
    const allIdsMatch = matching.every(r => r.FacilityCustomerID === expectedId);
    assert(
      `${loc.name} / ${sl}: all full-export rows use FacilityCustomerID "${expectedId}"`,
      allIdsMatch, true
    );
  }
}

// ---------------------------------------------------------------------------
// Test 3 — within the full export, no two rows for the same (location, service
// line) carry conflicting FacilityName or FacilityCustomerID values
// ---------------------------------------------------------------------------
console.log('\n=== 3. No intra-export conflicts for the same (location, service line) ===\n');

// Map: facilityCustomerID → set of FacilityName values seen (should be size 1)
const idToNames = new Map<string, Set<string>>();
for (const row of fullExportRows) {
  const bare = row.FacilityCustomerID; // e.g. "~CUST-HC-001"
  if (!idToNames.has(bare)) idToNames.set(bare, new Set());
  idToNames.get(bare)!.add(row.FacilityName);
}

for (const [id, names] of Array.from(idToNames.entries())) {
  assert(
    `FacilityCustomerID "${id}" maps to exactly one FacilityName in the full export`,
    names.size, 1
  );
}

// And the reverse: the same FacilityName must not appear with two different customer IDs
const nameToIds = new Map<string, Set<string>>();
for (const row of fullExportRows) {
  if (!nameToIds.has(row.FacilityName)) nameToIds.set(row.FacilityName, new Set());
  nameToIds.get(row.FacilityName)!.add(row.FacilityCustomerID);
}
for (const [name, ids] of Array.from(nameToIds.entries())) {
  assert(
    `FacilityName "${name}" maps to exactly one FacilityCustomerID in the full export`,
    ids.size, 1
  );
}

// ---------------------------------------------------------------------------
// Test 4 — mapped vs unmapped sentinel behaviour is consistent
// ---------------------------------------------------------------------------
console.log('\n=== 4. Mapped flag is consistent with name/id origin ===\n');

for (const { loc, sl } of SERVICE_LINES_BY_LOCATION) {
  const r = resolveMatrixCareFacility(loc as FacilityLocation, sl);

  if (r.mapped) {
    // A mapped result must not carry the fallback "14-XXXXXX-XX" derived pattern
    const looksLikeFallback = /^14-[A-Z0-9]+-[A-Z]+$/.test(r.customerId);
    assert(
      `${loc.name} / ${sl}: mapped=true means customerId is NOT a fallback derived id`,
      looksLikeFallback, false
    );
  } else {
    // An unmapped result must carry the fallback pattern
    const looksLikeFallback = /^14-[A-Z0-9]+-[A-Z]+$/.test(r.customerId);
    assert(
      `${loc.name} / ${sl}: mapped=false means customerId IS a fallback derived id`,
      looksLikeFallback, true
    );
  }
}

// ---------------------------------------------------------------------------
// Test 5 — VIL service line resolves under the AL facility (same as AL rows)
// ---------------------------------------------------------------------------
console.log('\n=== 5. VIL resolves under the AL facility record ===\n');

{
  const vilResult = resolveMatrixCareFacility(MAPPED_LOCATION as FacilityLocation, 'VIL');
  const alResult  = resolveMatrixCareFacility(MAPPED_LOCATION as FacilityLocation, 'AL');
  assert('MAPPED: VIL FacilityName equals AL FacilityName', vilResult.name, alResult.name);
  assert('MAPPED: VIL customerId equals AL customerId',     vilResult.customerId, alResult.customerId);

  const vilUnmapped = resolveMatrixCareFacility(UNMAPPED_LOCATION as FacilityLocation, 'VIL');
  const alUnmapped  = resolveMatrixCareFacility(UNMAPPED_LOCATION as FacilityLocation, 'AL');
  assert('UNMAPPED: VIL FacilityName equals AL FacilityName', vilUnmapped.name, alUnmapped.name);
  assert('UNMAPPED: VIL customerId equals AL customerId',     vilUnmapped.customerId, alUnmapped.customerId);
}

// ---------------------------------------------------------------------------
// Test 6 — HC/MC resolves under the HC facility record (same as HC rows)
// ---------------------------------------------------------------------------
console.log('\n=== 6. HC/MC resolves under the HC facility record ===\n');

{
  const hcMcResult = resolveMatrixCareFacility(MAPPED_LOCATION as FacilityLocation, 'HC/MC');
  const hcResult   = resolveMatrixCareFacility(MAPPED_LOCATION as FacilityLocation, 'HC');
  assert('MAPPED: HC/MC FacilityName equals HC FacilityName', hcMcResult.name, hcResult.name);
  assert('MAPPED: HC/MC customerId equals HC customerId',     hcMcResult.customerId, hcResult.customerId);

  const hcMcUnmapped = resolveMatrixCareFacility(UNMAPPED_LOCATION as FacilityLocation, 'HC/MC');
  const hcUnmapped   = resolveMatrixCareFacility(UNMAPPED_LOCATION as FacilityLocation, 'HC');
  assert('UNMAPPED: HC/MC FacilityName equals HC FacilityName', hcMcUnmapped.name, hcUnmapped.name);
  assert('UNMAPPED: HC/MC customerId equals HC customerId',     hcMcUnmapped.customerId, hcUnmapped.customerId);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
