/**
 * RT occupancy grouping parity test
 *
 * Regression guard for: "Room Type occupancy silently showing SL numbers when
 * room type groupings are configured".
 *
 * Root cause (now fixed):
 *   The Reference Data endpoint builds rtoRTMap keyed by
 *     campus||service_line||normalized_room_type  (e.g. "…||AL||Studio")
 *   but c.roomType is the BRANDED group name from COALESCE(rtg.group_name, rr.room_type)
 *     (e.g. "Legacy Lane - Studio").
 *   Before the fix, the lookup only tried the branded key → miss → fell back to
 *   the SL-level rtoSLMap → every room type in the service line showed identical
 *   Spot/T3/T12 occupancy (the SL roll-up).
 *   After the fix, the code calls lookupRtPhysMap / lookupRtOccWindow from
 *   server/services/rtOccupancyHistory.ts, which tries the branded key first
 *   then falls back to c.modeRoomType (the canonical rr.room_type from
 *   mode() WITHIN GROUP), matching the rtoRTMap key.
 *
 * Coupling guarantee:
 *   This test imports lookupRtPhysMap, lookupRtOccWindow, rtoOccWindow, and
 *   physVacWindow directly from server/services/rtOccupancyHistory.ts —
 *   the same module that server/routes.ts imports and calls for every RT
 *   occupancy field (rtOccSpot, rtOccT3…, rtOccHistory, vacantSpot).
 *   Removing the canonical-key fallback from that module will cause RTG-OCC-5,
 *   RTG-OCC-6, and RTG-OCC-10 to fail immediately.
 *
 * What this test seeds:
 *   - One campus ("RTO RTG Campus - 777") with AL service line
 *   - 4 Studio rent-roll rows (room_type='Studio', source_room_type='Studio')
 *     with 3 occupied
 *   - room_type_groupings row: source_room_type='Studio' →
 *     group_name='Legacy Lane - Studio'
 *   - room_type_occupancy_history:
 *       • normalized_room_type='Studio'      occ=3, avail=5  → RT occ = 60%
 *       • normalized_room_type='One Bedroom'  occ=4, avail=4 → extra SL weight
 *     SL total: occ=7, avail=9 → SL occ ≈ 77.8%
 *
 * Assertions:
 *   RTG-OCC-1: aggRes SQL returns room_type='Legacy Lane - Studio' (branded)
 *   RTG-OCC-2: aggRes SQL returns mode_room_type='Studio' (canonical)
 *   RTG-OCC-3: rtoRTMap is populated for key campus||AL||Studio (not branded)
 *   RTG-OCC-4: Branded key lookup misses rtoRTMap (demonstrating the pre-fix bug)
 *   RTG-OCC-5: lookupRtPhysMap (production) resolves the RT entry via canonical fallback
 *   RTG-OCC-6: lookupRtOccWindow (production) returns ~60% for Studio RT
 *   RTG-OCC-7: rtoOccWindow on the SL map returns ~77.8% for the full SL
 *   RTG-OCC-8: RT occ differs from SL occ by >5pp (not silently showing SL number)
 *   RTG-OCC-9: lookupRtOccWindow for a single-month window (rtOccHistory) returns ~60%
 *   RTG-OCC-10: physVacWindow via lookupRtPhysMap returns 2 (avail 5 - occ 3),
 *               not the rent-roll fallback of 1 (4 total - 3 occupied)
 *
 * Run with:
 *   npx tsx tests/rtOccGroupingParity.test.ts
 */

import pg from 'pg';
const { Pool } = pg;

// ── Import production lookup functions — the same ones routes.ts calls ──────
// If the branded-to-canonical fallback is ever removed from this module,
// RTG-OCC-5, RTG-OCC-6, and RTG-OCC-10 will fail.
import {
  lookupRtPhysMap,
  lookupRtOccWindow,
  rtoOccWindow,
  physVacWindow,
  type RtoEntry,
} from '../server/services/rtOccupancyHistory.js';

const CLIENT = 'ptest-rto-rtg-occ';
const CAMPUS  = 'RTO RTG Campus - 777';
const MONTH   = '2026-06'; // upload_month string
const YEAR    = 2026;
const MONTH_N = 6;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;

function assert(desc: string, actual: unknown, expected: unknown, tol = 0.5): void {
  const eq =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : actual === expected;
  if (eq) { console.log(`${PASS} ${desc}`); passed++; }
  else {
    console.log(`${FAIL} ${desc}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Cleanup + seed
// ---------------------------------------------------------------------------
async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM room_type_occupancy_history WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM room_type_groupings          WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM rent_roll_data               WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM locations                    WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM clients                      WHERE id = $1`,        [CLIENT]);
}

async function seed(): Promise<string> {
  await cleanup();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'RTO RTG Occ Test') ON CONFLICT (id) DO NOTHING`,
    [CLIENT],
  );
  const locRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`,
    [CAMPUS, CLIENT],
  );
  const locId: string = locRes.rows[0].id;

  // 4 Studio rent-roll rows: 3 occupied, 1 vacant
  // room_type = 'Studio' (canonical), source_room_type = 'Studio'
  for (let i = 1; i <= 4; i++) {
    const occupied = i <= 3;
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line,
          room_type, source_room_type, room_number, street_rate, occupied_yn,
          in_house_rate, date, size, days_vacant, payor_type)
       VALUES ($1,$2,$3,$4,'AL','Studio','Studio',$5,4500,$6,$7,$8,'Studio',0,'Private')`,
      [
        CLIENT, locId, CAMPUS, MONTH,
        `RTOG-${i}`,
        occupied,
        occupied ? 4200 : 0,
        `${MONTH}-01`,
      ],
    );
  }

  // room_type_groupings: 'Studio' → 'Legacy Lane - Studio'
  await pool.query(
    `INSERT INTO room_type_groupings
       (client_id, location, service_line, source_room_type, group_name)
     VALUES ($1, $2, 'AL', 'Studio', 'Legacy Lane - Studio')`,
    [CLIENT, CAMPUS],
  );

  // room_type_occupancy_history:
  //   Studio:      occ=3, avail=5  → RT occ = 60%
  //   One Bedroom: occ=4, avail=4  → adds weight to SL total → SL total = 7/9 ≈ 77.8%
  await pool.query(
    `INSERT INTO room_type_occupancy_history
       (client_id, location_name, service_line, raw_room_type, normalized_room_type,
        month, year, occ_units, available_units)
     VALUES
       ($1, $2, 'AL', 'Studio',      'Studio',      $3, $4, 3, 5),
       ($1, $2, 'AL', 'One Bedroom', 'One Bedroom', $3, $4, 4, 4)`,
    [CLIENT, CAMPUS, MONTH_N, YEAR],
  );

  return locId;
}

// ---------------------------------------------------------------------------
// Run the aggRes SQL (mirrors routes.ts lines 22276–22313 for this client)
// Returns room_type (branded via COALESCE) and mode_room_type (canonical).
// ---------------------------------------------------------------------------
async function runAggRes(): Promise<{ roomType: string; modeRoomType: string } | null> {
  const res = await pool.query<{ room_type: string; mode_room_type: string }>(`
    SELECT
      COALESCE(rtg.group_name, rr.room_type) AS room_type,
      mode() WITHIN GROUP (ORDER BY rr.room_type)
        FILTER (WHERE rr.room_type IS NOT NULL)  AS mode_room_type
    FROM rent_roll_data rr
    LEFT JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
    LEFT JOIN room_type_groupings rtg
      ON rtg.client_id = rr.client_id
     AND rtg.location = rr.location
     AND rtg.service_line = rr.service_line
     AND rtg.source_room_type = rr.source_room_type
    WHERE rr.client_id = $1 AND rr.upload_month = $2
    GROUP BY COALESCE(rtg.group_name, rr.room_type)
  `, [CLIENT, MONTH]);

  if (!res.rows.length) return null;
  return { roomType: res.rows[0].room_type, modeRoomType: res.rows[0].mode_room_type };
}

// ---------------------------------------------------------------------------
// Build rtoRTMap and rtoSLMap (mirrors routes.ts lines 22392–22425).
// Returns plain Maps for the test to inspect and pass to production lookups.
// ---------------------------------------------------------------------------
async function buildRtoMaps(months?: string[]): Promise<{
  rtoRTMap: Map<string, Map<string, RtoEntry>>;
  rtoSLMap: Map<string, Map<string, RtoEntry>>;
}> {
  // Parse each YYYY-MM string into (year, month) pairs for the query
  const pairs = (months ?? [MONTH]).map(m => ({
    year: parseInt(m.slice(0, 4)), month: parseInt(m.slice(5, 7)),
  }));
  // Build an IN-list predicate: (year=Y AND month=M) OR …
  const monthClauses = pairs.map((_, i) =>
    `(year = $${2 + i * 2} AND month = $${3 + i * 2})`).join(' OR ');
  const params: (string | number)[] = [CLIENT];
  pairs.forEach(p => params.push(p.year, p.month));

  const res = await pool.query(`
    SELECT location_name, service_line, normalized_room_type,
           month, year,
           SUM(occ_units)       AS occ_units,
           SUM(available_units) AS avail_units
    FROM room_type_occupancy_history
    WHERE client_id = $1
      AND (${monthClauses})
    GROUP BY location_name, service_line, normalized_room_type, month, year
  `, params);

  const rtoRTMap = new Map<string, Map<string, RtoEntry>>();
  const rtoSLMap = new Map<string, Map<string, RtoEntry>>();

  for (const r of res.rows as any[]) {
    const campus = r.location_name || '';
    const sl     = r.service_line  || '';
    const rt     = r.normalized_room_type || '';
    const occ    = Number(r.occ_units)   || 0;
    const avail  = Number(r.avail_units) || 0;
    const ym     = `${r.year}-${String(r.month).padStart(2, '0')}`;

    const rtKey = `${campus}||${sl}||${rt}`;
    if (!rtoRTMap.has(rtKey)) rtoRTMap.set(rtKey, new Map());
    const rtEntry = rtoRTMap.get(rtKey)!.get(ym) || { occ: 0, avail: 0 };
    rtEntry.occ += occ; rtEntry.avail += avail;
    rtoRTMap.get(rtKey)!.set(ym, rtEntry);

    const slKey = `${campus}||${sl}`;
    if (!rtoSLMap.has(slKey)) rtoSLMap.set(slKey, new Map());
    const slEntry = rtoSLMap.get(slKey)!.get(ym) || { occ: 0, avail: 0 };
    slEntry.occ += occ; slEntry.avail += avail;
    rtoSLMap.get(slKey)!.set(ym, slEntry);
  }

  return { rtoRTMap, rtoSLMap };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  await seed();
  try {
    const [aggRow, { rtoRTMap, rtoSLMap }] = await Promise.all([
      runAggRes(),
      buildRtoMaps(),
    ]);

    // ── RTG-OCC-1: aggRes returns branded room_type ──────────────────────
    assert(
      'RTG-OCC-1: aggRes room_type = "Legacy Lane - Studio" (branded via COALESCE)',
      aggRow?.roomType ?? null,
      'Legacy Lane - Studio',
    );

    // ── RTG-OCC-2: aggRes returns canonical mode_room_type ───────────────
    assert(
      'RTG-OCC-2: aggRes mode_room_type = "Studio" (canonical rr.room_type via mode())',
      aggRow?.modeRoomType ?? null,
      'Studio',
    );

    // Derive the lookup keys that routes.ts uses for this room type group
    const roomType     = aggRow?.roomType     ?? '';  // c.roomType     = branded
    const modeRoomType = aggRow?.modeRoomType ?? '';  // c.modeRoomType = canonical

    const brandedKey   = `${CAMPUS}||AL||${roomType}`;     // …||Legacy Lane - Studio
    const canonicalKey = `${CAMPUS}||AL||${modeRoomType}`; // …||Studio
    const slKey        = `${CAMPUS}||AL`;

    // ── RTG-OCC-3: rtoRTMap has the canonical key ────────────────────────
    assert(
      `RTG-OCC-3: rtoRTMap has entry for canonical key "${canonicalKey}"`,
      rtoRTMap.has(canonicalKey),
      true,
    );

    // ── RTG-OCC-4: rtoRTMap does NOT have the branded key ────────────────
    // This confirms rtoRTMap is keyed by normalized_room_type, not group_name.
    // Before the fix, the endpoint tried ONLY the branded key → miss → SL fallback.
    assert(
      `RTG-OCC-4: rtoRTMap does NOT have branded key "${brandedKey}" (brand ≠ normalized)`,
      rtoRTMap.has(brandedKey),
      false,
    );

    // ── RTG-OCC-5: lookupRtPhysMap (production function) finds the entry ─
    // This calls the SAME function that server/routes.ts calls for vacantSpot.
    // If the canonical-key fallback is removed from that function, this fails.
    const physMap = lookupRtPhysMap(rtoRTMap, CAMPUS, 'AL', roomType, modeRoomType);
    assert(
      'RTG-OCC-5: lookupRtPhysMap (production) resolves RT entry via canonical fallback',
      physMap !== undefined,
      true,
    );

    // ── RTG-OCC-6: lookupRtOccWindow (production) returns RT-level occ% ──
    // Studio RT: occ=3, avail=5 → 60%.
    // This calls the SAME function that server/routes.ts calls for rtOccSpot.
    // If the canonical-key fallback is removed, this returns null instead of 60.
    const rtOccSpot = lookupRtOccWindow(rtoRTMap, CAMPUS, 'AL', roomType, modeRoomType, [MONTH]);
    assert(
      'RTG-OCC-6: lookupRtOccWindow (production) rtOccSpot ≈ 60% (3/5 RT-level RTO)',
      rtOccSpot ?? -1,
      60,
      1,
    );

    // ── RTG-OCC-7: rtoOccWindow on the SL map returns SL-level occ% ──────
    // SL total: occ=7 (3+4), avail=9 (5+4) → ≈77.8%.
    const slOccSpot = rtoOccWindow(rtoSLMap.get(slKey), [MONTH]);
    assert(
      'RTG-OCC-7: rtoOccWindow (production) slOccSpot ≈ 77.8% (7/9 SL-level RTO)',
      slOccSpot ?? -1,
      (7 / 9) * 100,
      1,
    );

    // ── RTG-OCC-8: key regression check — RT occ ≠ SL occ ───────────────
    // Before the fix, rtOccSpot === slOccSpot because the branded lookup missed
    // and the code fell through to rtoSLMap. After the fix they differ by ~17.8pp.
    const rtDiffersFromSl = rtOccSpot !== null && slOccSpot !== null &&
                            Math.abs(rtOccSpot - slOccSpot) > 5;
    assert(
      'RTG-OCC-8: rtOccSpot differs from slOccSpot by >5pp (using RT-level, not SL roll-up)',
      rtDiffersFromSl,
      true,
    );

    // ── RTG-OCC-9: lookupRtOccWindow for single-month (rtOccHistory) ─────
    // rtOccHistory is the per-month drill-down column on routes.ts line 23130.
    // It uses the same lookupRtOccWindow call with a single-month window [mm].
    const rtOccHistorySpot = lookupRtOccWindow(rtoRTMap, CAMPUS, 'AL', roomType, modeRoomType, [MONTH]);
    assert(
      `RTG-OCC-9: rtOccHistory[${MONTH}] ≈ 60% (drill-down uses RT-level via production lookup)`,
      rtOccHistorySpot ?? -1,
      60,
      1,
    );

    // ── RTG-OCC-10: physVacWindow via lookupRtPhysMap (production) ───────
    // RT: avail=5, occ=3 → physVacWindow = 2.
    // Rent-roll fallback: total=4, occupied=3 → vacantSpot = 1.
    // If the fallback is removed from lookupRtPhysMap, physMap is undefined,
    // physVacWindow returns null, and the route falls back to rent-roll (1).
    const vacantSpotRT = physVacWindow(physMap, [MONTH]);
    assert(
      'RTG-OCC-10: physVacWindow (production) vacantSpot = 2 (avail 5 - occ 3 from RT-level RTO)',
      vacantSpotRT ?? -1,
      2,
      0,
    );

    // ── RTG-OCC-11: branded map exists but has no data for queried month ──
    // Scenario: a real branded normalized_room_type entry exists in the RTO
    // history for an older month (2026-05), but the queried window is the
    // current month (2026-06).  The branded key therefore IS in rtoRTMap,
    // but rtoOccWindow(brandedMap, ['2026-06']) returns null (no data).
    //
    // The CORRECT behaviour (post-fix): lookupRtOccWindow evaluates both
    // maps at the window level:
    //   rtoOccWindow(brandedMap, ['2026-06'])  → null  (no June data)
    //   ?? rtoOccWindow(canonicalMap, ['2026-06']) → 60%  ← must return this
    //
    // The BUGGY behaviour (pre-fix via lookupRtPhysMap): selects branded map
    // by presence, runs rtoOccWindow(brandedMap, ['2026-06']) → null, and
    // never tries the canonical map → returns null → routes falls back to SL.
    //
    // To create this scenario we insert a branded RTO row for 2026-05 and
    // rebuild the maps including both months.
    await pool.query(
      `INSERT INTO room_type_occupancy_history
         (client_id, location_name, service_line, raw_room_type, normalized_room_type,
          month, year, occ_units, available_units)
       VALUES ($1, $2, 'AL', 'Legacy Lane - Studio', 'Legacy Lane - Studio', 5, $3, 2, 4)`,
      [CLIENT, CAMPUS, YEAR],
    );

    // Rebuild maps for window covering both months
    const PREV_MONTH = `${YEAR}-05`;
    const { rtoRTMap: rtoRTMapEC } = await buildRtoMaps(['2026-05', '2026-06']);

    // Branded key now EXISTS (May data), canonical key still only has June data
    const edgeBrandedKey   = `${CAMPUS}||AL||${roomType}`;     // …||Legacy Lane - Studio
    const edgeCanonicalKey = `${CAMPUS}||AL||${modeRoomType}`; // …||Studio

    assert(
      'RTG-OCC-11 setup: branded key exists in edge-case rtoRTMap (has 2026-05 data)',
      rtoRTMapEC.has(edgeBrandedKey),
      true,
    );
    assert(
      'RTG-OCC-11 setup: branded map has no 2026-06 entry (only 2026-05)',
      rtoRTMapEC.get(edgeBrandedKey)?.has(MONTH),
      false,
    );

    // The key assertion: lookupRtOccWindow must fall through to the canonical
    // map when the branded map exists but has no data for the queried month.
    // If lookupRtOccWindow is regressed to select by map-presence (lookupRtPhysMap),
    // this returns null instead of 60.
    const edgeOcc = lookupRtOccWindow(rtoRTMapEC, CAMPUS, 'AL', roomType, modeRoomType, [MONTH]);
    assert(
      'RTG-OCC-11: lookupRtOccWindow falls through to canonical map when branded map has no June data → ~60%',
      edgeOcc ?? -1,
      60,
      1,
    );

  } finally {
    await cleanup();
    await pool.end();
  }
}

run().then(() => {
  console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
