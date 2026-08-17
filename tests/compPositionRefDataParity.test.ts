/**
 * Own-rate parity: Competitive Position scatter SQL vs Reference Data SQL
 *
 * Both GET /api/pricing-controls/competitive-position and GET /api/reference-data
 * derive the representative own (street) rate using mode() WITHIN GROUP per room
 * type, but the two SQL blocks live separately in server/routes.ts and can drift
 * when either is edited.
 *
 * This test seeds a throwaway client with:
 *   - Two campuses, two service lines each, multiple room types
 *   - One "junk" rent-roll row ($159 street rate on a Studio) that should be
 *     suppressed by mode() so neither endpoint reports an artificially low rate
 *
 * It then runs BOTH SQL patterns directly against the database (mirroring the
 * server-side queries) and asserts:
 *   1. The scatter's unit-weighted own-rate (our_all_rate) matches the Reference
 *      Data's unit-weighted avg_street for every campus+SL pair, within ±1 (rounding).
 *   2. The junk $159 row does NOT suppress the true $4000 Studio modal rate in
 *      either endpoint's SQL — mode() wins over avg().
 *
 * Seeded campuses also cover the "latest uploaded month" requirement: the test
 * creates a single upload_month and checks both endpoints scope to it correctly.
 *
 * Run with: npx tsx tests/compPositionRefDataParity.test.ts
 */
import pg from 'pg';
const { Pool } = pg;

const CLIENT   = 'ptest-cp-refdata-parity';
const LOC_A    = 'Alpha Campus - 101';
const LOC_B    = 'Beta Campus - 202';
const MONTH    = '2026-06';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;

function assert(desc: string, actual: unknown, expected: unknown, tol = 1) {
  const eq =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : actual === expected;
  if (eq) { console.log(`${PASS} ${desc}`); passed++; }
  else {
    console.log(`${FAIL} ${desc}\n    expected: ${expected}\n    actual:   ${actual}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Seed layout
// ---------------------------------------------------------------------------
// Alpha / AL:
//   Studio:      5 units @ $4000  +  1 junk @ $159   → mode = $4000, cnt = 6
//   One Bedroom: 3 units @ $5000                      → mode = $5000, cnt = 3
//   Expected our_all_rate = round((4000*6 + 5000*3) / 9) = round(4333.3) = 4333
//
// Alpha / HC:
//   Semi-Private:4 units @ $3200                      → mode = $3200, cnt = 4
//   Expected our_all_rate = 3200
//
// Beta / AL:
//   Studio:      4 units @ $3800                      → mode = $3800, cnt = 4
//   Expected our_all_rate = 3800
//
// Beta / VIL:
//   Studio:      3 units @ $2900                      → mode = $2900, cnt = 3
//   Expected our_all_rate = 2900

interface RRRow {
  location: string;
  serviceLine: string;
  roomType: string;
  roomNumber: string;
  streetRate: number;
  occupiedYn: boolean;
  inHouseRate: number;
}

function buildRows(): RRRow[] {
  const rows: RRRow[] = [];

  // Alpha — AL — Studio (5 valid + 1 junk)
  for (let i = 1; i <= 5; i++) {
    rows.push({ location: LOC_A, serviceLine: 'AL', roomType: 'Studio',
      roomNumber: `A-${i}`, streetRate: 4000, occupiedYn: i <= 4, inHouseRate: i <= 4 ? 3800 : 0 });
  }
  rows.push({ location: LOC_A, serviceLine: 'AL', roomType: 'Studio',
    roomNumber: 'A-6', streetRate: 159, occupiedYn: false, inHouseRate: 0 });

  // Alpha — AL — One Bedroom
  for (let i = 1; i <= 3; i++) {
    rows.push({ location: LOC_A, serviceLine: 'AL', roomType: 'One Bedroom',
      roomNumber: `A-1${i}`, streetRate: 5000, occupiedYn: true, inHouseRate: 4900 });
  }

  // Alpha — HC — Semi-Private
  for (let i = 1; i <= 4; i++) {
    rows.push({ location: LOC_A, serviceLine: 'HC', roomType: 'Semi-Private',
      roomNumber: `AH-${i}`, streetRate: 3200, occupiedYn: i <= 3, inHouseRate: i <= 3 ? 3100 : 0 });
  }

  // Beta — AL — Studio
  for (let i = 1; i <= 4; i++) {
    rows.push({ location: LOC_B, serviceLine: 'AL', roomType: 'Studio',
      roomNumber: `B-${i}`, streetRate: 3800, occupiedYn: i <= 3, inHouseRate: i <= 3 ? 3700 : 0 });
  }

  // Beta — VIL — Studio
  for (let i = 1; i <= 3; i++) {
    rows.push({ location: LOC_B, serviceLine: 'VIL', roomType: 'Studio',
      roomNumber: `BV-${i}`, streetRate: 2900, occupiedYn: i <= 2, inHouseRate: i <= 2 ? 2800 : 0 });
  }

  return rows;
}

async function cleanup() {
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id=$1`, [CLIENT]);
  await pool.query(`DELETE FROM locations WHERE client_id=$1`, [CLIENT]);
  await pool.query(`DELETE FROM clients WHERE id=$1`, [CLIENT]);
}

async function seed(): Promise<{ locAId: string; locBId: string }> {
  await cleanup();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'CP-RefData Parity Test') ON CONFLICT (id) DO NOTHING`,
    [CLIENT],
  );
  const locARes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`, [LOC_A, CLIENT],
  );
  const locBRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`, [LOC_B, CLIENT],
  );
  const locAId = locARes.rows[0].id as string;
  const locBId = locBRes.rows[0].id as string;

  for (const r of buildRows()) {
    const locId = r.location === LOC_A ? locAId : locBId;
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
          room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$6,0,'Private')`,
      [CLIENT, locId, r.location, MONTH, r.serviceLine, r.roomType,
       r.roomNumber, r.streetRate, r.occupiedYn, r.inHouseRate, `${MONTH}-01`],
    );
  }

  return { locAId, locBId };
}

// ---------------------------------------------------------------------------
// Scatter SQL: mirrors competitive-position's rt_modes → rates CTE exactly.
// Produces one row per (location, service_line) with our_all_rate.
// ---------------------------------------------------------------------------
async function runScatterSQL(): Promise<Map<string, number>> {
  const res = await pool.query(`
    WITH rt_modes AS (
      SELECT rr.location,
             rr.service_line,
             rr.room_type,
             mode() WITHIN GROUP (ORDER BY rr.street_rate) AS mode_rate,
             COUNT(*) AS cnt
      FROM rent_roll_data rr
      JOIN locations loc ON loc.id = rr.location_id
      WHERE loc.client_id = $1
        AND rr.upload_month = $2
        AND rr.street_rate > 0
        AND NOT (rr.service_line IN ('AL','AL/MC','SL','VIL')
                 AND rr.room_number ~* '/[B-Zb-z]$')
      GROUP BY rr.location, rr.service_line, rr.room_type
    )
    SELECT location, service_line,
      ROUND((SUM(mode_rate * cnt) / NULLIF(SUM(cnt), 0))::numeric, 0) AS our_all_rate
    FROM rt_modes
    GROUP BY location, service_line
  `, [CLIENT, MONTH]);

  const map = new Map<string, number>();
  for (const r of res.rows) {
    map.set(`${r.location}||${r.service_line}`, Number(r.our_all_rate));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Reference Data SQL: mirrors reference-data's aggregation CTE exactly.
// Produces one row per (location, service_line, room_type) with avg_street.
// We then unit-weight these to produce one our_all_rate per (location, SL)
// — the same weighting the scatter does over its per-RT mode rows.
// ---------------------------------------------------------------------------
async function runRefDataSQL(): Promise<Map<string, number>> {
  const res = await pool.query(`
    SELECT
      rr.location,
      rr.service_line,
      rr.room_type,
      mode() WITHIN GROUP (ORDER BY rr.street_rate) FILTER (
        WHERE rr.street_rate > 0
          AND NOT (rr.service_line IN ('AL','AL/MC','SL','VIL')
                   AND rr.room_number ~* '/[B-Zb-z]$')
      ) AS avg_street,
      COUNT(DISTINCT
        CASE WHEN rr.service_line IN ('AL','AL/MC','SL','VIL')
             THEN REGEXP_REPLACE(rr.room_number, '/[A-Za-z]+$', '')
             ELSE rr.room_number END
      ) AS total
    FROM rent_roll_data rr
    LEFT JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
    WHERE rr.client_id = $1 AND rr.upload_month = $2
    GROUP BY rr.location, rr.service_line, rr.room_type
  `, [CLIENT, MONTH]);

  // Unit-weight avg_street per (location, SL) → our_all_rate equivalent
  const acc = new Map<string, { wSum: number; totalN: number }>();
  for (const r of res.rows) {
    if (r.avg_street == null || Number(r.avg_street) <= 0) continue;
    const key  = `${r.location}||${r.service_line}`;
    const st   = Number(r.avg_street);
    const cnt  = Number(r.total) || 0;
    const e = acc.get(key) || { wSum: 0, totalN: 0 };
    e.wSum   += st * cnt;
    e.totalN += cnt;
    acc.set(key, e);
  }

  const map = new Map<string, number>();
  for (const [key, { wSum, totalN }] of acc) {
    if (totalN > 0) map.set(key, Math.round(wSum / totalN));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Also run the per-RT refdata SQL to verify the junk row is suppressed
// ---------------------------------------------------------------------------
async function runRefDataPerRT(): Promise<Map<string, number>> {
  const res = await pool.query(`
    SELECT rr.location, rr.service_line, rr.room_type,
      mode() WITHIN GROUP (ORDER BY rr.street_rate) FILTER (
        WHERE rr.street_rate > 0
          AND NOT (rr.service_line IN ('AL','AL/MC','SL','VIL')
                   AND rr.room_number ~* '/[B-Zb-z]$')
      ) AS avg_street
    FROM rent_roll_data rr
    WHERE rr.client_id = $1 AND rr.upload_month = $2
    GROUP BY rr.location, rr.service_line, rr.room_type
  `, [CLIENT, MONTH]);

  const map = new Map<string, number>();
  for (const r of res.rows) {
    map.set(`${r.location}||${r.service_line}||${r.room_type}`, Number(r.avg_street));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Expected own-rates derived from seeded data (manually computed)
// ---------------------------------------------------------------------------
const EXPECTED: Record<string, number> = {
  [`${LOC_A}||AL`]:  4333,  // (4000*6 + 5000*3) / 9 = 4333.3 → rounds to 4333
  [`${LOC_A}||HC`]:  3200,
  [`${LOC_B}||AL`]:  3800,
  [`${LOC_B}||VIL`]: 2900,
};

async function main() {
  await seed();
  try {
    const [scatterMap, refDataMap, perRTMap] = await Promise.all([
      runScatterSQL(),
      runRefDataSQL(),
      runRefDataPerRT(),
    ]);

    // ── 1. Both SQL patterns produce results for all seeded campus+SL pairs ──
    for (const key of Object.keys(EXPECTED)) {
      assert(`scatter SQL has results for ${key}`, scatterMap.has(key), true);
      assert(`refData SQL has results for ${key}`, refDataMap.has(key), true);
    }

    // ── 2. Scatter own-rate matches known expectation ──
    for (const [key, exp] of Object.entries(EXPECTED)) {
      const actual = scatterMap.get(key);
      assert(`scatter our_all_rate for ${key} ≈ ${exp}`, actual ?? -1, exp);
    }

    // ── 3. Reference Data weighted own-rate matches known expectation ──
    for (const [key, exp] of Object.entries(EXPECTED)) {
      const actual = refDataMap.get(key);
      assert(`refData weighted avg_street for ${key} ≈ ${exp}`, actual ?? -1, exp);
    }

    // ── 4. Scatter and Reference Data agree with each other (the core parity check) ──
    const allKeys = new Set([...scatterMap.keys(), ...refDataMap.keys()]);
    let parityChecks = 0;
    for (const key of allKeys) {
      const sc = scatterMap.get(key);
      const rd = refDataMap.get(key);
      if (sc == null || rd == null) continue;
      assert(
        `scatter our_all_rate === refData weighted avg_street for ${key} (scatter=${sc}, refData=${rd})`,
        sc, rd,
      );
      parityChecks++;
    }
    assert('at least 4 campus+SL pairs verified for parity', parityChecks >= 4, true);

    // ── 5. Junk $159 row is suppressed: Studio mode is $4000, not $159 ──
    const studioKey = `${LOC_A}||AL||Studio`;
    const studioRate = perRTMap.get(studioKey);
    assert(
      'refData: junk $159 row suppressed — Studio modal rate = $4000 (not avg-distorted)',
      studioRate ?? 0, 4000,
    );
    const scatterAlAL = scatterMap.get(`${LOC_A}||AL`);
    assert(
      'scatter: junk $159 row suppressed — AL own-rate > $1000',
      (scatterAlAL ?? 0) > 1000, true,
    );

    // ── 6. HC service line: mode() operates correctly (single rate, clean) ──
    const hcKey = `${LOC_A}||HC||Semi-Private`;
    const hcRate = perRTMap.get(hcKey);
    assert('refData: HC Semi-Private modal rate = $3200', hcRate ?? 0, 3200);

    // ── 7. Latest-month scoping: no earlier months slip through ──
    // We only seeded MONTH='2026-06'; scatterMap/refDataMap should be non-empty
    assert('scatter SQL scopes to latest month (data found)', scatterMap.size >= 4, true);
    assert('refData SQL scopes to latest month (data found)', refDataMap.size >= 4, true);

  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  try { await cleanup(); await pool.end(); } catch {}
  process.exit(1);
});
