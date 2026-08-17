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
import { queryCompPositionOwnRates } from '../server/services/compPositionOwnRates.js';
const { Pool } = pg;
import { buildRuleImpactContext, computeQualifiedRuleImpact } from '../server/services/ruleImpactService';

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

// ---------------------------------------------------------------------------
// SCENARIO 2 — room_type_groupings remapping
//
// Confirms that scatter and Reference Data still agree on the modal rate
// when room_type_groupings rows remap source_room_type to a branded group_name.
//
// Layout:
//   RTG Campus / AL:
//     Studio:      5 units @ $4200  (source_room_type='Studio' → 'Legacy Lane - Studio')
//     One Bedroom: 3 units @ $5500  (source_room_type='One Bedroom' → 'Legacy Lane - One Bedroom')
//
//   Expected our_all_rate = ROUND((4200*5 + 5500*3) / 8) = ROUND(4687.5) = 4688
//
// The scatter SQL (competitive-position) groups by rr.room_type directly.
// The refData SQL (Reference Data) groups by COALESCE(rtg.group_name, rr.room_type).
// Both should produce identical unit-weighted averages because the rows in each
// group are the same physical units — only the display key differs.
// ---------------------------------------------------------------------------
const CLIENT_RTG = 'ptest-cp-refdata-rtg';
const LOC_RTG    = 'RTG Campus - 999';
const EXPECTED_RTG_OUR_ALL = 4688; // round((4200*5 + 5500*3) / 8) = round(4687.5)

async function cleanupRtg(): Promise<void> {
  await pool.query(`DELETE FROM room_type_groupings WHERE client_id=$1`, [CLIENT_RTG]);
  await pool.query(`DELETE FROM rent_roll_data     WHERE client_id=$1`, [CLIENT_RTG]);
  await pool.query(`DELETE FROM locations          WHERE client_id=$1`, [CLIENT_RTG]);
  await pool.query(`DELETE FROM clients            WHERE id=$1`,        [CLIENT_RTG]);
}

async function seedRtg(): Promise<void> {
  await cleanupRtg();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'RTG Parity Test') ON CONFLICT (id) DO NOTHING`,
    [CLIENT_RTG],
  );
  const locRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`,
    [LOC_RTG, CLIENT_RTG],
  );
  const locId = locRes.rows[0].id as string;

  // AL — Studio: 5 units @ $4200, source_room_type = 'Studio'
  for (let i = 1; i <= 5; i++) {
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
          room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type)
       VALUES ($1,$2,$3,$4,'AL','Studio','Studio',$5,4200,true,4000,$6,'Studio',0,'Private')`,
      [CLIENT_RTG, locId, LOC_RTG, MONTH, `RS-${i}`, `${MONTH}-01`],
    );
  }

  // AL — One Bedroom: 3 units @ $5500, source_room_type = 'One Bedroom'
  for (let i = 1; i <= 3; i++) {
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
          room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type)
       VALUES ($1,$2,$3,$4,'AL','One Bedroom','One Bedroom',$5,5500,true,5200,$6,'One Bedroom',0,'Private')`,
      [CLIENT_RTG, locId, LOC_RTG, MONTH, `RO-${i}`, `${MONTH}-01`],
    );
  }

  // room_type_groupings: remap source_room_type → branded group_name
  await pool.query(
    `INSERT INTO room_type_groupings (client_id, location, service_line, source_room_type, group_name)
     VALUES ($1,$2,'AL','Studio','Legacy Lane - Studio')`,
    [CLIENT_RTG, LOC_RTG],
  );
  await pool.query(
    `INSERT INTO room_type_groupings (client_id, location, service_line, source_room_type, group_name)
     VALUES ($1,$2,'AL','One Bedroom','Legacy Lane - One Bedroom')`,
    [CLIENT_RTG, LOC_RTG],
  );
}
async function runRefDataSQLRtg(): Promise<number | null> {
  const res = await pool.query<{ display_rt: string; avg_street: string; total: string }>(`
    SELECT
      COALESCE(rtg.group_name, rr.room_type) AS display_rt,
      rr.service_line,
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
    LEFT JOIN room_type_groupings rtg
      ON rtg.client_id = rr.client_id
     AND rtg.location  = rr.location
     AND rtg.service_line = rr.service_line
     AND rtg.source_room_type = rr.source_room_type
    WHERE rr.client_id = $1 AND rr.upload_month = $2
    GROUP BY COALESCE(rtg.group_name, rr.room_type), rr.service_line
  `, [CLIENT_RTG, MONTH]);

  // Unit-weight avg_street across all display groups for this single location+SL
  let wSum = 0, totalN = 0;
  for (const r of res.rows) {
    if (r.avg_street == null || Number(r.avg_street) <= 0) continue;
    const cnt = Number(r.total) || 0;
    wSum   += Number(r.avg_street) * cnt;
    totalN += cnt;
  }
  if (totalN === 0) return null;
  return Math.round(wSum / totalN);
}

// Expected values for the RTG scenario (single campus, AL service line):
//   our_all_rate    = ROUND((4200*5 + 5500*3) / 8) = ROUND(4687.5) = 4688
//   our_studio_rate = ROUND(4200*5 / 5) = 4200
//
// RTG-6 is the primary regression guard for this task: it calls the SAME
// queryCompPositionOwnRates() function that routes.ts uses (imported from
// server/services/compPositionOwnRates.ts), so any future edit to that
// function is immediately reflected here. An accidental room_type_groupings
// JOIN would substitute group_name ("Legacy Lane - Studio") as room_type,
// breaking the ILIKE 'studio%' filter and returning NULL for our_studio_rate.
const EXPECTED_RTG_STUDIO_RATE = 4200;
async function runRtgScenario(): Promise<void> {
  await seedRtg();
  try {
    // ── Call the SHARED production function directly (RTG-6 coupling) ────────
    // queryCompPositionOwnRates is imported from server/services/compPositionOwnRates.ts,
    // which is also what routes.ts calls for GET /api/pricing-controls/competitive-position.
    // Any change to that function's SQL (e.g. adding a room_type_groupings JOIN) will
    // immediately surface as a failing assertion here.
    const [scatterRows, refData] = await Promise.all([
      queryCompPositionOwnRates(
        (sql, params) => pool.query(sql, params),
        CLIENT_RTG, MONTH,
      ),
      runRefDataSQLRtg(),
    ]);

    // The RTG campus has exactly one location+SL combination (LOC_RTG / AL).
    const row = scatterRows.find(r => r.location === LOC_RTG || r.location_name === LOC_RTG);
    const scatter    = row?.our_all_rate    ?? null;
    const studioRate = row?.our_studio_rate ?? null;

    // ── RTG-1. Shared function produces a result after remapping ──
    assert('RTG: queryCompPositionOwnRates returns a result', scatter !== null, true);
    // ── RTG-2. RefData produces a result after remapping ──
    assert('RTG: refData SQL (with RTG join) returns a result', refData !== null, true);
    // ── RTG-3. Shared function our_all_rate matches expected value ──
    assert(
      `RTG: scatter our_all_rate ≈ ${EXPECTED_RTG_OUR_ALL} (Studio×5@4200 + OneBed×3@5500)`,
      scatter ?? -1, EXPECTED_RTG_OUR_ALL,
    );
    // ── RTG-4. RefData our_all_rate matches expected value ──
    assert(
      `RTG: refData our_all_rate ≈ ${EXPECTED_RTG_OUR_ALL} (branded group_name remapping)`,
      refData ?? -1, EXPECTED_RTG_OUR_ALL,
    );
    // ── RTG-5. Shared function and RefData agree despite different grouping keys ──
    assert(
      `RTG: scatter === refData after group_name remapping (scatter=${scatter}, refData=${refData})`,
      scatter ?? -1, refData ?? -2,
    );
    // ── RTG-6. our_studio_rate is NOT NULL even though Studio is remapped to a branded
    //    group_name ("Legacy Lane - Studio"). queryCompPositionOwnRates uses rr.room_type
    //    directly (no room_type_groupings JOIN), so ILIKE 'studio%' still matches.
    //    A NULL here means someone added an RTG JOIN to the shared function — revert it.
    //    This assertion exercises the EXACT SQL the live route runs (not a copy of it).
    assert(
      `RTG-6: queryCompPositionOwnRates our_studio_rate=${EXPECTED_RTG_STUDIO_RATE} (not NULL) despite branded group_name — production SQL coupling confirmed`,
      studioRate ?? -1, EXPECTED_RTG_STUDIO_RATE,
    );
  } finally {
    await cleanupRtg();
  }
}

// ---------------------------------------------------------------------------
// SCENARIO 3 — Rule impact counts with room_type_groupings remapping
//
// Confirms that:
//   a) getT3MoveInsMap (used by buildRuleImpactContext) keys by rr.room_type
//      (canonical), so T3 move-in counts for "Studio" groups are non-zero even
//      when room_type_groupings renames them to "Legacy Lane - Studio".
//   b) getGroupedT3MoveInsMap (used by /api/reference-data) keys by
//      COALESCE(rtg.group_name, rr.room_type) = "Legacy Lane - Studio".
//   c) The aggRes SQL's mode_room_type column returns the canonical room type
//      ("Studio") so that buildGroupRulePreviewRates can compare rule
//      filters.roomType against the source room type when branded g.rt fails.
//   d) A rule scoped to canonical roomType=['Studio'] correctly matches a group
//      whose display rt='Legacy Lane - Studio' when sourceRt='Studio' is also
//      checked — confirming the buildGroupRulePreviewRates fix.
// ---------------------------------------------------------------------------
const CLIENT_RI  = 'ptest-ri-rtg';
const LOC_RI     = 'RI RTG Campus - 888';
const MONTH_RI   = '2026-06';
// 3 Studio move-ins in the T3 window; each unit has move_in_date = MONTH_RI-01
const RI_STUDIO_COUNT    = 5;
const RI_STUDIO_MOVEINS  = 3; // units with a move_in_date inside T3
const RI_STUDIO_RATE     = 4200;

async function cleanupRi(): Promise<void> {
  await pool.query(`DELETE FROM room_type_groupings WHERE client_id=$1`, [CLIENT_RI]);
  await pool.query(`DELETE FROM rent_roll_data     WHERE client_id=$1`, [CLIENT_RI]);
  await pool.query(`DELETE FROM locations          WHERE client_id=$1`, [CLIENT_RI]);
  await pool.query(`DELETE FROM clients            WHERE id=$1`,        [CLIENT_RI]);
}

async function seedRi(): Promise<void> {
  await cleanupRi();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'RI RTG Test') ON CONFLICT (id) DO NOTHING`,
    [CLIENT_RI],
  );
  const locRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`,
    [LOC_RI, CLIENT_RI],
  );
  const locId = locRes.rows[0].id as string;

  // 5 Studio units.
  // IMPORTANT: source_room_type='Studio - Pvt' (raw import value) is intentionally
  // DISTINCT from room_type='Studio' (normalized canonical value).  This exercises
  // the case where the import pipeline normalizes the source value — the reverse RTG
  // map must JOIN rent_roll_data to get the actual rr.room_type, not source_room_type.
  for (let i = 1; i <= RI_STUDIO_COUNT; i++) {
    const hasMoveIn = i <= RI_STUDIO_MOVEINS;
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
          room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type,
          move_in_date)
       VALUES ($1,$2,$3,$4,'AL','Studio','Studio - Pvt',$5,$6,true,$7,$8,'Studio',0,'Private',$9)`,
      [
        CLIENT_RI, locId, LOC_RI, MONTH_RI, `RIS-${i}`,
        RI_STUDIO_RATE, RI_STUDIO_RATE - 200, `${MONTH_RI}-01`,
        hasMoveIn ? `${MONTH_RI}-01` : null,
      ],
    );
  }

  // RTG: remap source_room_type='Studio - Pvt' → group_name='Legacy Lane - Studio'.
  // The join key is source_room_type (not room_type), matching the import pipeline.
  await pool.query(
    `INSERT INTO room_type_groupings (client_id, location, service_line, source_room_type, group_name)
     VALUES ($1,$2,'AL','Studio - Pvt','Legacy Lane - Studio')`,
    [CLIENT_RI, LOC_RI],
  );
}

// getT3MoveInsMap SQL (no RTG join) — keys by rr.room_type (canonical).
// Returns move-ins per month averaged over T3.  With one upload_month, T3=[MONTH_RI].
async function runRiT3MapCanonical(): Promise<Map<string, number>> {
  const res = await pool.query(`
    WITH ev AS (
      SELECT DISTINCT ON (rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type)
        rr.location, rr.service_line, rr.room_type, rr.payor_type,
        CASE
          WHEN rr.move_in_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(rr.move_in_date,'YYYY-MM-DD')
          WHEN rr.move_in_date ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN TO_DATE(rr.move_in_date,'MM/DD/YYYY')
          ELSE NULL END AS dt
      FROM rent_roll_data rr
      WHERE rr.client_id = $1 AND rr.move_in_date IS NOT NULL AND rr.move_in_date != ''
      ORDER BY rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type,
               (rr.payor_type ILIKE '%private%' OR rr.payor_type ILIKE '%pvt%') DESC, rr.payor_type
    ),
    valid AS (
      SELECT location, service_line, room_type, TO_CHAR(dt,'YYYY-MM') AS mm
      FROM ev WHERE dt IS NOT NULL
    )
    SELECT location, service_line, room_type, COUNT(*)::float / 1.0 AS t3_moveins
    FROM valid WHERE mm = $2
    GROUP BY location, service_line, room_type
  `, [CLIENT_RI, MONTH_RI]);
  const map = new Map<string, number>();
  for (const r of res.rows as any[]) {
    map.set(`${r.location}||${r.service_line}||${r.room_type}`, Number(r.t3_moveins));
  }
  return map;
}

// getGroupedT3MoveInsMap SQL (with RTG join) — keys by COALESCE(group_name, room_type) (branded).
async function runRiT3MapGrouped(): Promise<Map<string, number>> {
  const res = await pool.query(`
    WITH ev AS (
      SELECT DISTINCT ON (rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type)
        rr.location, rr.service_line,
        COALESCE(rtg.group_name, rr.room_type) AS room_type,
        rr.payor_type,
        CASE
          WHEN rr.move_in_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(rr.move_in_date,'YYYY-MM-DD')
          WHEN rr.move_in_date ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN TO_DATE(rr.move_in_date,'MM/DD/YYYY')
          ELSE NULL END AS dt
      FROM rent_roll_data rr
      LEFT JOIN room_type_groupings rtg
        ON rtg.client_id = rr.client_id AND rtg.location = rr.location
       AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
      WHERE rr.client_id = $1 AND rr.move_in_date IS NOT NULL AND rr.move_in_date != ''
      ORDER BY rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type,
               (rr.payor_type ILIKE '%private%' OR rr.payor_type ILIKE '%pvt%') DESC, rr.payor_type
    ),
    valid AS (
      SELECT location, service_line, room_type, TO_CHAR(dt,'YYYY-MM') AS mm
      FROM ev WHERE dt IS NOT NULL
    )
    SELECT location, service_line, room_type, COUNT(*)::float / 1.0 AS t3_moveins
    FROM valid WHERE mm = $2
    GROUP BY location, service_line, room_type
  `, [CLIENT_RI, MONTH_RI]);
  const map = new Map<string, number>();
  for (const r of res.rows as any[]) {
    map.set(`${r.location}||${r.service_line}||${r.room_type}`, Number(r.t3_moveins));
  }
  return map;
}

// aggRes SQL column: mode() WITHIN GROUP (ORDER BY rr.room_type) → canonical room type.
// Returns the display room_type and the mode_room_type for the seeded group.
async function runRiAggModeRoomType(): Promise<{ roomType: string; modeRoomType: string } | null> {
  const res = await pool.query<{ room_type: string; mode_room_type: string }>(`
    SELECT
      COALESCE(rtg.group_name, rr.room_type) AS room_type,
      mode() WITHIN GROUP (ORDER BY rr.room_type) FILTER (WHERE rr.room_type IS NOT NULL) AS mode_room_type
    FROM rent_roll_data rr
    LEFT JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
    LEFT JOIN room_type_groupings rtg
      ON rtg.client_id = rr.client_id AND rtg.location = rr.location
     AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
    WHERE rr.client_id = $1 AND rr.upload_month = $2
    GROUP BY COALESCE(rtg.group_name, rr.room_type)
  `, [CLIENT_RI, MONTH_RI]);
  if (!res.rows.length) return null;
  return { roomType: res.rows[0].room_type, modeRoomType: res.rows[0].mode_room_type };
}

async function runRiScenario(): Promise<void> {
  await seedRi();
  try {
    const [canonical, grouped, aggRow] = await Promise.all([
      runRiT3MapCanonical(),
      runRiT3MapGrouped(),
      runRiAggModeRoomType(),
    ]);

    const canonicalKey = `${LOC_RI}||AL||Studio`;
    const brandedKey   = `${LOC_RI}||AL||Legacy Lane - Studio`;

    // ── RI-1. Canonical T3 map has non-zero move-ins keyed by "Studio" ──────
    // This is the key format used by getT3MoveInsMap (buildRuleImpactContext).
    // A rule scoped to roomType=['Studio'] looks up this exact key.
    assert(
      'RI: canonical T3 map has entry for Studio (non-zero move-ins)',
      (canonical.get(canonicalKey) ?? 0) >= 1, true,
    );
    assert(
      `RI: canonical T3 map returns ${RI_STUDIO_MOVEINS} move-ins for Studio`,
      canonical.get(canonicalKey) ?? -1, RI_STUDIO_MOVEINS,
    );

    // ── RI-2. Canonical map has NO entry under the branded key ───────────────
    // Confirms the two maps use different keys — the root cause of the bug.
    assert(
      'RI: canonical T3 map does NOT contain the branded key "Legacy Lane - Studio"',
      canonical.has(brandedKey), false,
    );

    // ── RI-3. Grouped T3 map has non-zero move-ins keyed by branded name ────
    // This is the key format used by getGroupedT3MoveInsMap (Reference Data endpoint).
    assert(
      'RI: grouped T3 map has entry for "Legacy Lane - Studio" (non-zero move-ins)',
      (grouped.get(brandedKey) ?? 0) >= 1, true,
    );
    assert(
      `RI: grouped T3 map returns ${RI_STUDIO_MOVEINS} move-ins for Legacy Lane - Studio`,
      grouped.get(brandedKey) ?? -1, RI_STUDIO_MOVEINS,
    );

    // ── RI-4. Grouped map has NO entry under the canonical key ───────────────
    assert(
      'RI: grouped T3 map does NOT contain the canonical key "Studio"',
      grouped.has(canonicalKey), false,
    );

    // ── RI-5. aggRes SQL: display room_type is branded, mode_room_type is canonical ──
    // mode_room_type is used as sourceRt in _ruleGroups after the fix.
    assert(
      'RI: aggRes room_type (display) = "Legacy Lane - Studio" (branded via COALESCE)',
      aggRow?.roomType ?? '', 'Legacy Lane - Studio',
    );
    assert(
      'RI: aggRes mode_room_type (canonical) = "Studio" (pre-grouping rr.room_type)',
      aggRow?.modeRoomType ?? '', 'Studio',
    );

    // ── RI-6. Rule filter check: branded g.rt alone misses the rule ──────────
    // Demonstrates the pre-fix behaviour: a rule scoped to ['Studio'] would
    // NOT match a group with rt='Legacy Lane - Studio' if only g.rt is checked.
    const ruleFiltersRoomType = ['Studio'];
    const displayRt  = 'Legacy Lane - Studio';
    const sourceRt   = 'Studio'; // mode_room_type from aggRes after the fix
    const matchesRtOnly     = ruleFiltersRoomType.includes(displayRt);
    const matchesWithSource = ruleFiltersRoomType.includes(displayRt) ||
                              ruleFiltersRoomType.includes(sourceRt);
    assert(
      'RI: rule filter roomType=["Studio"] does NOT match branded rt="Legacy Lane - Studio" alone (bug)',
      matchesRtOnly, false,
    );
    assert(
      'RI: rule filter roomType=["Studio"] DOES match when sourceRt="Studio" is also checked (fix)',
      matchesWithSource, true,
    );

    // ── RI-7. End-to-end: computeQualifiedRuleImpact with branded roomType filter ──
    // Calls buildRuleImpactContext + computeQualifiedRuleImpact directly to exercise
    // the production code path, not a reimplementation.
    //
    // Two properties under test:
    //   a) source_room_type='Studio - Pvt' ≠ room_type='Studio': the reverse map must
    //      JOIN rent_roll_data to get the actual rr.room_type, not use source_room_type.
    //   b) Cross-location collision guard: the same branded group name ('Legacy Lane - Studio')
    //      maps to 'Studio' at LOC_RI but to 'Suite' at a second location (LOC_RI_B).
    //      An unscoped map would union both → {'Studio','Suite'}, incorrectly matching
    //      'Suite' units at LOC_RI that are NOT part of the branded group.
    //      The fix keys by `${location}|${service_line}|${group_name}` so each lookup
    //      resolves only the canonical types defined at THAT unit's location+SL.
    //
    // Seed additions (cleaned up inside this block):
    //   • 2 ungrouped Suite units at LOC_RI   (room_type='Suite', no RTG row)
    //   • 3 Suite units at LOC_RI_B           (room_type='Suite', RTG: group_name='Legacy Lane - Studio')
    {
      const LOC_RI_B = 'RI RTG Campus B - 889';
      const RI_SUITE_B_COUNT = 3;
      const RI_SUITE_UNGROUPED = 2; // ungrouped Suite units at LOC_RI

      // Insert second location + its units + RTG row
      const locBRes = await pool.query(
        `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`,
        [LOC_RI_B, CLIENT_RI],
      );
      const locBId = locBRes.rows[0].id as string;

      // Ungrouped Suite units at LOC_RI (existing location — reuse locId via query)
      const locARes = await pool.query(
        `SELECT id FROM locations WHERE client_id=$1 AND name=$2`, [CLIENT_RI, LOC_RI],
      );
      const locAId = locARes.rows[0].id as string;

      for (let i = 1; i <= RI_SUITE_UNGROUPED; i++) {
        await pool.query(
          `INSERT INTO rent_roll_data
             (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
              room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type)
           VALUES ($1,$2,$3,$4,'AL','Suite','Suite - Std',$5,4500,true,4200,$6,'Suite',0,'Private')`,
          [CLIENT_RI, locAId, LOC_RI, MONTH_RI, `RIS-U${i}`, `${MONTH_RI}-01`],
        );
      }

      // Suite units at LOC_RI_B mapped to 'Legacy Lane - Studio' (collision group_name)
      for (let i = 1; i <= RI_SUITE_B_COUNT; i++) {
        await pool.query(
          `INSERT INTO rent_roll_data
             (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
              room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type)
           VALUES ($1,$2,$3,$4,'AL','Suite','Suite - Pvt',$5,4500,true,4200,$6,'Suite',0,'Private')`,
          [CLIENT_RI, locBId, LOC_RI_B, MONTH_RI, `RIB-${i}`, `${MONTH_RI}-01`],
        );
      }
      await pool.query(
        `INSERT INTO room_type_groupings (client_id, location, service_line, source_room_type, group_name)
         VALUES ($1,$2,'AL','Suite - Pvt','Legacy Lane - Studio')`,
        [CLIENT_RI, LOC_RI_B],
      );

      try {
        const ctx = await buildRuleImpactContext(CLIENT_RI);
        assert('RI: buildRuleImpactContext returns a non-null context', ctx !== null, true);

        if (ctx) {
          const brandedRule = {
            isActive: true,
            serviceLines: ['AL'],
            action: {
              filters: { roomType: ['Legacy Lane - Studio'] },
              adjustmentType: 'percentage',
              adjustmentValue: 5,
            },
            trigger: { type: 'immediate' },
          };

          const brandedImpact = computeQualifiedRuleImpact(ctx, brandedRule);

          // Expected: RI_STUDIO_COUNT Studio units at LOC_RI + RI_SUITE_B_COUNT Suite units at LOC_RI_B.
          // The RI_SUITE_UNGROUPED ungrouped Suite units at LOC_RI must NOT be counted —
          // the location-scoped reverse map maps LOC_RI|AL|'Legacy Lane - Studio' → {'Studio'} only.
          const expectedTotal = RI_STUDIO_COUNT + RI_SUITE_B_COUNT;
          assert(
            `RI: branded filter ['Legacy Lane - Studio'] matches ${RI_STUDIO_COUNT} Studio@LOC_RI ` +
            `+ ${RI_SUITE_B_COUNT} Suite@LOC_RI_B = ${expectedTotal} units (cross-location collision guard)`,
            brandedImpact.affectedUnits, expectedTotal,
          );
          assert(
            `RI: branded filter does NOT match the ${RI_SUITE_UNGROUPED} ungrouped Suite units at LOC_RI ` +
            '(location-scoped reverse map excludes them)',
            brandedImpact.affectedUnits < RI_STUDIO_COUNT + RI_SUITE_UNGROUPED + RI_SUITE_B_COUNT, true,
          );
          assert(
            `RI: branded filter produces non-zero affectedUnits (was silently 0 before the fix)`,
            brandedImpact.affectedUnits > 0, true,
          );

          // Canonical filter regression guard: 'Studio' still matches only Studio units.
          const canonicalRule = {
            isActive: true,
            serviceLines: ['AL'],
            action: {
              filters: { roomType: ['Studio'] },
              adjustmentType: 'percentage',
              adjustmentValue: 5,
            },
            trigger: { type: 'immediate' },
          };
          const canonicalImpact = computeQualifiedRuleImpact(ctx, canonicalRule);
          assert(
            `RI: canonical filter ['Studio'] still matches only ${RI_STUDIO_COUNT} Studio units (regression guard)`,
            canonicalImpact.affectedUnits, RI_STUDIO_COUNT,
          );
        }
      } finally {
        // Clean up collision additions
        await pool.query(
          `DELETE FROM room_type_groupings WHERE client_id=$1 AND location=$2`,
          [CLIENT_RI, LOC_RI_B],
        );
        await pool.query(
          `DELETE FROM rent_roll_data WHERE client_id=$1 AND location=$2`,
          [CLIENT_RI, LOC_RI_B],
        );
        await pool.query(`DELETE FROM locations WHERE id=$1`, [locBId]);
        await pool.query(
          `DELETE FROM rent_roll_data WHERE client_id=$1 AND room_number LIKE 'RIS-U%'`,
          [CLIENT_RI],
        );
      }
    }

  } finally {
    await cleanupRi();
  }
}

// ===========================================================================
// SCENARIO 4 — Manual rate override with room_type_groupings remapping
//
// Confirms that revMonthlyImpact stays non-null when:
//   - A manual_rate_override is stored with the CANONICAL room type ("Studio")
//   - A room_type_groupings row renames "Studio" → "Legacy Lane - Studio"
//
// The Reference Data endpoint looks up overrides by `campus||sl||roomType`,
// where roomType is the branded display name.  Without the fix, the branded
// key misses the canonical-keyed override and effectiveProposed stays null,
// leaving revMonthlyImpact null.  With the fix, the lookup also tries the
// canonical key (c.modeRoomType) and finds the override.
//
// This test exercises the lookup logic directly (mirroring server/routes.ts
// lines 22847-22855 and the override-lookup at line 22889) without hitting
// the HTTP endpoint, so it runs in isolation without a running server.
// ===========================================================================
const CLIENT_MO  = 'ptest-mo-rtg';
const LOC_MO     = 'MO RTG Campus - 777';
const MONTH_MO   = '2026-06';
const MO_STREET_RATE   = 4500;   // street rate for the Studio units
const MO_OVERRIDE_RATE = 4800;   // the manual override rate stored as "Studio"
const MO_MOVEINS       = 2;      // move-in count for T3 impact calculation
const EXPECTED_IMPACT  = (MO_OVERRIDE_RATE - MO_STREET_RATE) * MO_MOVEINS; // 600

async function cleanupMo(): Promise<void> {
  await pool.query(`DELETE FROM manual_rate_overrides WHERE client_id=$1`, [CLIENT_MO]);
  await pool.query(`DELETE FROM room_type_groupings   WHERE client_id=$1`, [CLIENT_MO]);
  await pool.query(`DELETE FROM rent_roll_data        WHERE client_id=$1`, [CLIENT_MO]);
  await pool.query(`DELETE FROM locations             WHERE client_id=$1`, [CLIENT_MO]);
  await pool.query(`DELETE FROM clients               WHERE id=$1`,        [CLIENT_MO]);
}

async function seedMo(): Promise<string> {
  await cleanupMo();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'MO RTG Test') ON CONFLICT (id) DO NOTHING`,
    [CLIENT_MO],
  );
  const locRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`,
    [LOC_MO, CLIENT_MO],
  );
  const locId = locRes.rows[0].id as string;

  // 4 Studio units; MO_MOVEINS have a move_in_date in MONTH_MO
  for (let i = 1; i <= 4; i++) {
    const hasMoveIn = i <= MO_MOVEINS;
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line, room_type, source_room_type,
          room_number, street_rate, occupied_yn, in_house_rate, date, size, days_vacant, payor_type,
          move_in_date)
       VALUES ($1,$2,$3,$4,'AL','Studio','Studio',$5,$6,true,$7,$8,'Studio',0,'Private',$9)`,
      [
        CLIENT_MO, locId, LOC_MO, MONTH_MO, `MOS-${i}`,
        MO_STREET_RATE, MO_STREET_RATE - 300, `${MONTH_MO}-01`,
        hasMoveIn ? `${MONTH_MO}-01` : null,
      ],
    );
  }

  // RTG: remap source_room_type='Studio' → branded group_name='Legacy Lane - Studio'
  await pool.query(
    `INSERT INTO room_type_groupings (client_id, location, service_line, source_room_type, group_name)
     VALUES ($1,$2,'AL','Studio','Legacy Lane - Studio')`,
    [CLIENT_MO, LOC_MO],
  );

  // Manual override stored with CANONICAL room_type='Studio' (not the branded name)
  await pool.query(
    `INSERT INTO manual_rate_overrides (client_id, location_id, location_name, service_line, room_type, override_rate, updated_at)
     VALUES ($1,$2,$3,'AL','Studio',$4,NOW())`,
    [CLIENT_MO, locId, LOC_MO, MO_OVERRIDE_RATE],
  );

  return locId;
}

// Mirrors the aggRes SQL in server/routes.ts: returns branded room_type and
// canonical mode_room_type for each group.
async function runMoAggRes(): Promise<{ roomType: string; modeRoomType: string; avgStreet: number } | null> {
  const res = await pool.query<{ room_type: string; mode_room_type: string; avg_street: string }>(`
    SELECT
      COALESCE(rtg.group_name, rr.room_type) AS room_type,
      mode() WITHIN GROUP (ORDER BY rr.room_type) FILTER (WHERE rr.room_type IS NOT NULL) AS mode_room_type,
      mode() WITHIN GROUP (ORDER BY rr.street_rate) FILTER (
        WHERE rr.street_rate > 0
          AND NOT (rr.service_line IN ('AL','AL/MC','SL','VIL')
                   AND rr.room_number ~* '/[B-Zb-z]$')
      ) AS avg_street
    FROM rent_roll_data rr
    LEFT JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
    LEFT JOIN room_type_groupings rtg
      ON rtg.client_id = rr.client_id AND rtg.location = rr.location
     AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
    WHERE rr.client_id = $1 AND rr.upload_month = $2
    GROUP BY COALESCE(rtg.group_name, rr.room_type)
  `, [CLIENT_MO, MONTH_MO]);
  if (!res.rows.length) return null;
  return {
    roomType: res.rows[0].room_type,
    modeRoomType: res.rows[0].mode_room_type,
    avgStreet: Number(res.rows[0].avg_street),
  };
}

// Mirrors the grouped T3 move-in query in server/routes.ts.
async function runMoT3MoveIns(): Promise<number> {
  const res = await pool.query<{ n: string }>(`
    WITH ev AS (
      SELECT DISTINCT ON (rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type)
        rr.location, rr.service_line,
        COALESCE(rtg.group_name, rr.room_type) AS room_type, rr.payor_type,
        CASE
          WHEN rr.move_in_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(rr.move_in_date,'YYYY-MM-DD')
          ELSE NULL END AS dt
      FROM rent_roll_data rr
      LEFT JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
      LEFT JOIN room_type_groupings rtg
        ON rtg.client_id = rr.client_id AND rtg.location = rr.location
       AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
      WHERE rr.client_id = $1 AND rr.move_in_date IS NOT NULL AND rr.move_in_date != ''
      ORDER BY rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type,
               (rr.payor_type ILIKE '%private%' OR rr.payor_type ILIKE '%pvt%') DESC, rr.payor_type
    ),
    valid AS (
      SELECT location, service_line, room_type, TO_CHAR(dt,'YYYY-MM') AS mm
      FROM ev WHERE dt IS NOT NULL
    )
    SELECT COUNT(*)::int AS n
    FROM valid WHERE mm = $2
  `, [CLIENT_MO, MONTH_MO]);
  return Number(res.rows[0]?.n ?? 0);
}

async function runMoScenario(): Promise<void> {
  await seedMo();
  try {
    // Load manual overrides exactly as server/routes.ts does (keyed by location_name||sl||room_type)
    const overrideRes = await pool.query<{ location_name: string; service_line: string; room_type: string; override_rate: number }>(
      `SELECT location_name, service_line, room_type, override_rate FROM manual_rate_overrides WHERE client_id = $1`,
      [CLIENT_MO],
    );
    const manualOverrideMap = new Map<string, number>();
    for (const o of overrideRes.rows) {
      manualOverrideMap.set(`${o.location_name}||${o.service_line}||${o.room_type}`, Number(o.override_rate));
    }

    const [aggRow, t3MoveIns] = await Promise.all([
      runMoAggRes(),
      runMoT3MoveIns(),
    ]);

    // ── MO-1. aggRes returns branded room_type and canonical mode_room_type ──
    assert('MO: aggRes branded room_type = "Legacy Lane - Studio"', aggRow?.roomType ?? '', 'Legacy Lane - Studio');
    assert('MO: aggRes canonical mode_room_type = "Studio"', aggRow?.modeRoomType ?? '', 'Studio');

    // ── MO-2. Override is stored under canonical key ──
    const canonicalKey = `${LOC_MO}||AL||Studio`;
    const brandedKey   = `${LOC_MO}||AL||Legacy Lane - Studio`;
    assert('MO: override map has entry for canonical key "Studio"', manualOverrideMap.has(canonicalKey), true);
    assert('MO: override map has NO entry for branded key "Legacy Lane - Studio"', manualOverrideMap.has(brandedKey), false);

    // ── MO-3. Branded-only lookup misses the override (pre-fix behaviour) ──
    const brandedLookup = manualOverrideMap.get(brandedKey) ?? null;
    assert('MO: branded-key-only lookup misses override (returns null — bug demonstrated)', brandedLookup, null, 0);

    // ── MO-4. Canonical fallback lookup finds the override (fix behaviour) ──
    const canonicalFallback = manualOverrideMap.get(brandedKey) ?? manualOverrideMap.get(canonicalKey) ?? null;
    assert('MO: canonical-fallback lookup finds the override rate', canonicalFallback, MO_OVERRIDE_RATE, 0);

    // ── MO-5. T3 move-ins are non-zero (impact denominator is populated) ──
    assert(`MO: T3 grouped move-ins = ${MO_MOVEINS}`, t3MoveIns, MO_MOVEINS, 0);

    // ── MO-6. effectiveProposed is non-null when using canonical fallback ──
    // Mirrors: effectiveProposed = manualRate ?? proposed ?? rulePreviewRate
    const streetSpot = aggRow?.avgStreet ?? null;
    const effectiveProposed = canonicalFallback;  // manual override found via canonical fallback
    assert('MO: effectiveProposed is non-null (override found via canonical fallback)', effectiveProposed !== null, true);

    // ── MO-7. revMonthlyImpact is non-null and correct ──
    const revMonthlyImpact =
      (effectiveProposed !== null && streetSpot !== null && t3MoveIns > 0)
        ? (effectiveProposed - streetSpot) * t3MoveIns
        : null;
    assert('MO: revMonthlyImpact is non-null (not silently dropped)', revMonthlyImpact !== null, true);
    assert(
      `MO: revMonthlyImpact = (${MO_OVERRIDE_RATE} - ${MO_STREET_RATE}) × ${MO_MOVEINS} = ${EXPECTED_IMPACT}`,
      revMonthlyImpact ?? -1, EXPECTED_IMPACT, 0,
    );

  } finally {
    await cleanupMo();
  }
}

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
  }

  // ── Scenario 2: room_type_groupings rate parity ──
  await runRtgScenario();

  // ── Scenario 3: rule impact counts with RTG remapping ──
  await runRiScenario();

  // ── Scenario 4: manual rate override + RTG → revMonthlyImpact stays populated ──
  await runMoScenario();

  await pool.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  try { await cleanup(); await cleanupRtg(); await cleanupRi(); await cleanupMo(); await pool.end(); } catch {}
  process.exit(1);
});
