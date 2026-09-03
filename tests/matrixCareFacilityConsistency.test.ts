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
import { campusMapping } from '../server/campusMapping';
import path from 'node:path';
import XLSX from 'xlsx';

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
// Test 7 — SL prefers its own identity, then uses the authoritative AL identity
// when MatrixCare has no separate SL/IL facility record.
// ---------------------------------------------------------------------------
console.log('\n=== 7. SL uses an explicit identity or the combined AL facility ===\n');

{
  const explicitSl = resolveMatrixCareFacility(MAPPED_LOCATION as FacilityLocation, 'SL');
  assert('SL prefers the explicit IL/SL FacilityName', explicitSl.name, MAPPED_LOCATION.matrixCareNameIL);
  assert('SL prefers the explicit IL/SL customerId', explicitSl.customerId, MAPPED_LOCATION.customerFacilityIdIL);

  const combinedSeniorLiving: FacilityLocation = {
    name: 'Combined Senior Living',
    matrixCareNameHC: null,
    matrixCareNameAL: 'Combined Senior Living AL',
    matrixCareNameIL: null,
    customerFacilityIdHC: null,
    customerFacilityIdAL: '14-0999-AL',
    customerFacilityIdIL: null,
  };
  const combinedSl = resolveMatrixCareFacility(combinedSeniorLiving, 'SL');
  assert('SL uses the complete AL FacilityName when no SL/IL identity exists', combinedSl.name, 'Combined Senior Living AL');
  assert('SL uses the complete AL customerId when no SL/IL identity exists', combinedSl.customerId, '14-0999-AL');
  assert('SL using a confirmed AL identity is reported as mapped', combinedSl.mapped, true);

  const dualIdentitySl = resolveMatrixCareFacility({
    name: 'Harrodsburg-2187',
    matrixCareNameHC: 'The Willows at Harrodsburg HC',
    matrixCareNameAL: 'The Willows at Harrodsburg AL',
    matrixCareNameIL: 'The Willows at Harrodsburg Villas IL',
    customerFacilityIdHC: '14-0187-HC',
    customerFacilityIdAL: '14-0187-AL',
    customerFacilityIdIL: '14-7187-IL',
  }, 'SL');
  assert(
    'Authoritative SL FacilityName wins over a populated IL/Villas location field',
    dualIdentitySl.name,
    'The Willows at Harrodsburg SL',
  );
  assert(
    'Authoritative SL customer id wins over a populated IL/Villas location field',
    dualIdentitySl.customerId,
    '14-0187-SL',
  );
}

// ---------------------------------------------------------------------------
// Test 8 — harmless punctuation/spacing differences still reach the static,
// authoritative campus mapping.
// ---------------------------------------------------------------------------
console.log('\n=== 8. KeyStats aliases resolve through normalized names ===\n');

{
  const spacedAlias: FacilityLocation = {
    name: 'Batesville - 120',
    matrixCareNameHC: null,
    matrixCareNameAL: null,
    matrixCareNameIL: null,
    customerFacilityIdHC: null,
    customerFacilityIdAL: null,
    customerFacilityIdIL: null,
  };
  const result = resolveMatrixCareFacility(spacedAlias, 'HC');
  assert('Spaced Batesville alias uses the authoritative MatrixCare name', result.name, 'St. Andrews Health Campus HC');
  assert('Spaced Batesville alias uses the authoritative customer facility id', result.customerId, '18-0120-HC');
  assert('Spaced Batesville alias is reported as mapped', result.mapped, true);

  for (const alias of ['Mt Washington - 176', 'Mt Washington-176']) {
    const location: FacilityLocation = {
      name: alias,
      matrixCareNameHC: null,
      matrixCareNameAL: null,
      matrixCareNameIL: null,
      customerFacilityIdHC: null,
      customerFacilityIdAL: null,
      customerFacilityIdIL: null,
    };
    const hc = resolveMatrixCareFacility(location, 'HC');
    const al = resolveMatrixCareFacility(location, 'AL');
    assert(`${alias}: split alias resolves authoritative HC name`, hc.name, 'Sanders Ridge Health Campus HC');
    assert(`${alias}: split alias resolves authoritative HC id`, hc.customerId, '14-0176-HC');
    assert(`${alias}: split alias resolves authoritative AL name`, al.name, 'Sanders Ridge Health Campus AL');
    assert(`${alias}: split alias resolves authoritative AL id`, al.customerId, '14-0176-AL');
    assert(`${alias}: split HC/AL identities are both mapped`, hc.mapped && al.mapped, true);
  }

  const legacyMuncie: FacilityLocation = {
    name: 'Muncie 18128',
    matrixCareNameHC: null,
    matrixCareNameAL: null,
    matrixCareNameIL: null,
    customerFacilityIdHC: null,
    customerFacilityIdAL: null,
    customerFacilityIdIL: null,
  };
  assert(
    'Muncie Legacy alias inherits the campus HC identity',
    resolveMatrixCareFacility(legacyMuncie, 'HC').customerId,
    '18-0128-HC',
  );
  assert(
    'Muncie Legacy alias keeps its own authoritative AL identity',
    resolveMatrixCareFacility(legacyMuncie, 'AL').customerId,
    '18-7128-AL',
  );
}

// ---------------------------------------------------------------------------
// Test 9 — every complete row in the authoritative workbook resolves exactly.
// ---------------------------------------------------------------------------
console.log('\n=== 9. Authoritative workbook has complete exact resolver coverage ===\n');

{
  const workbookPath = path.resolve(
    process.cwd(),
    'attached_assets/0_Matrix_Location_vs_KeyStats_Location_1788464152590.xlsx',
  );
  const workbook = XLSX.readFile(workbookPath);
  const sourceSheet = workbook.Sheets['Sheet1'];
  const sourceRows = XLSX.utils.sheet_to_json<unknown[]>(sourceSheet, { header: 1, raw: true });
  const mismatches: string[] = [];
  let authoritativeRows = 0;

  for (const row of sourceRows.slice(1)) {
    const customerId = row[1] == null ? '' : String(row[1]).trim();
    const keyStatsName = row[3] == null ? '' : String(row[3]).trim();
    const facilityName = row[4] == null ? '' : String(row[4]).trim();
    if (!customerId || !keyStatsName || !facilityName) continue;

    const idServiceLine = customerId.match(/-(HC|AL|IL|SL)$/i)?.[1];
    const nameServiceLine = facilityName.match(/ (HC|AL|IL|SL)$/i)?.[1];
    const serviceLine = (idServiceLine || nameServiceLine || '').toUpperCase();
    if (!serviceLine) {
      mismatches.push(`${keyStatsName}: cannot classify ${facilityName} / ${customerId}`);
      continue;
    }

    authoritativeRows++;
    const resolved = resolveMatrixCareFacility({
      name: keyStatsName,
      matrixCareNameHC: null,
      matrixCareNameAL: null,
      matrixCareNameIL: null,
      customerFacilityIdHC: null,
      customerFacilityIdAL: null,
      customerFacilityIdIL: null,
    }, serviceLine);

    if (!resolved.mapped || resolved.name !== facilityName || resolved.customerId !== customerId) {
      mismatches.push(
        `${keyStatsName}/${serviceLine}: expected ${facilityName} / ${customerId}, ` +
        `got ${resolved.name} / ${resolved.customerId} (mapped=${resolved.mapped})`,
      );
    }
  }

  if (mismatches.length) {
    console.log(mismatches.slice(0, 20).map(m => `    ${m}`).join('\n'));
  }
  assert('All complete workbook rows are exercised', authoritativeRows, 347);
  assert('Every authoritative workbook row resolves to its exact facility identity', mismatches.length, 0);
  assert('Workbook rows are consolidated by stable campus code', campusMapping.length, 160);

  const incompleteCanonicalMappings: string[] = [];
  const aliasOwnerCodes = new Map<string, Set<string>>();
  for (const mapping of campusMapping) {
    for (const campusName of [mapping.keyStatsName, ...(mapping.aliases ?? [])]) {
      const normalized = campusName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const ownerCodes = aliasOwnerCodes.get(normalized) ?? new Set<string>();
      ownerCodes.add(mapping.locationCode);
      aliasOwnerCodes.set(normalized, ownerCodes);
    }
  }
  for (const mapping of campusMapping) {
    for (const serviceLine of ['HC', 'AL', 'IL', 'SL'] as const) {
      const expectedName = mapping[`matrixCareName${serviceLine}`];
      const expectedId = mapping[`customerFacilityId${serviceLine}`];
      if (!expectedName || !expectedId) continue;

      for (const campusName of [mapping.keyStatsName, ...(mapping.aliases ?? [])]) {
        const normalizedCampusName = campusName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if ((aliasOwnerCodes.get(normalizedCampusName)?.size ?? 0) > 1) {
          // A corrected display name can be attached to more than one stable
          // campus code in the source (Goshen MW - 124 is the known case).
          // Exact source-row checks above remain authoritative for those rows.
          continue;
        }
        const resolved = resolveMatrixCareFacility({
          name: campusName,
          matrixCareNameHC: null,
          matrixCareNameAL: null,
          matrixCareNameIL: null,
          customerFacilityIdHC: null,
          customerFacilityIdAL: null,
          customerFacilityIdIL: null,
        }, serviceLine);
        if (!resolved.mapped) {
          incompleteCanonicalMappings.push(`${campusName}/${serviceLine}`);
        }
      }
    }
  }
  assert(
    'Every linked campus alias resolves all inherited service-line identities without fallback',
    incompleteCanonicalMappings.length,
    0,
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
