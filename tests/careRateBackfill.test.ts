/**
 * Regression tests: automatic care_level_rates backfill must FILL, never REPLACE.
 *
 * Background
 * ----------
 * There is no manual "Backfill Level 2 Care Rates" button any more. Every rent roll
 * import and every competitive survey import calls
 * `storage.backfillCareLevelRatesFromHistory()` on its own, so the function now runs on
 * a schedule the user does not control. That makes its conflict behaviour a data-safety
 * question rather than a detail: an ON CONFLICT DO UPDATE would silently overwrite an
 * admin-entered care rate on every single upload, and nobody would see it happen.
 *
 * So the contract these tests pin down is:
 *   1. A campus with NO entry gets one from the rent roll (that is why the button could go).
 *   2. A campus WITH an entry keeps it, whatever the rent roll says (the automatic path).
 *   3. { overwriteExisting: true } — reachable only by the admin endpoint's explicit
 *      force re-run and seed scripts — does replace it.
 *   4. Once backfilled, competitor matching's own care math uses the campus rate instead
 *      of the $55/day default. This is what the fallback used to cost: it is asserted
 *      through the production adjustment function, not re-derived here.
 *
 * The care map in test 4 is read back through storage.getCareLevel2Rates() — the same
 * production accessor — so no query is hand-copied into this file.
 *
 * Run with: npx tsx tests/careRateBackfill.test.ts
 */
import pg from 'pg';
import { storage } from '../server/storage';
import { computeCompetitorAdjustments } from '../server/services/competitorMatchPolicy';
import { DAYS_PER_MONTH } from '../shared/careRates';

const { Pool } = pg;

const CLIENT = 'ptest-care-backfill';
const LOC = 'Care Backfill Campus - 900';
const MONTH_OLD = '2026-04';
const MONTH_NEW = '2026-05';

// Rent-roll Level 2 care rates. AL is monthly, HC is daily (see shared/careRates).
const RR_AL_CARE_OLD = 700;
const RR_AL_CARE_NEW = 900;
const RR_HC_CARE_DAILY = 33;

const ADMIN_AL_CARE = 1250; // a manually-entered value that must survive every import

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;

function assert(desc: string, actual: unknown, expected: unknown, tol = 0.01) {
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

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM care_level_rates WHERE client_id = $1`, [CLIENT],
  );
  await pool.query(
    `DELETE FROM rent_roll_history WHERE location = $1`, [LOC],
  );
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM locations WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM clients WHERE id = $1`, [CLIENT]);
}

async function seed(): Promise<string> {
  await cleanup();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'Care Rate Backfill Test') ON CONFLICT (id) DO NOTHING`,
    [CLIENT],
  );
  const locRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ($1, $2) RETURNING id`, [LOC, CLIENT],
  );
  const locId = locRes.rows[0].id as string;

  // Two months of Level 2 rows for AL: the backfill must take the NEWER month.
  // A Level 1 row and a zero-rate row are present so the filters stay exercised.
  const rows: Array<[string, string, string, string, number | null, number]> = [
    // uploadMonth, serviceLine, roomNumber, careLevel, careRate, streetRate
    [MONTH_OLD, 'AL', '101', '2',       RR_AL_CARE_OLD,   4000],
    [MONTH_NEW, 'AL', '101', 'Level 2', RR_AL_CARE_NEW,   4100],
    [MONTH_NEW, 'AL', '102', '1',       500,              4100],
    [MONTH_NEW, 'AL', '103', '2',       0,                4100],
    [MONTH_NEW, 'HC', '201', '2',       RR_HC_CARE_DAILY, 300],
  ];
  for (const [uploadMonth, sl, roomNumber, careLevel, careRate, streetRate] of rows) {
    await pool.query(
      `INSERT INTO rent_roll_history
         (upload_month, date, location, location_id, room_number, room_type, service_line,
          occupied_yn, size, street_rate, in_house_rate, care_level, care_rate)
       VALUES ($1, $2, $3, $4, $5, 'Studio', $6, true, 'Studio', $7, $7, $8, $9)`,
      [uploadMonth, `${uploadMonth}-01`, LOC, locId, roomNumber, sl, streetRate, careLevel, careRate],
    );
  }
  return locId;
}

async function storedRate(locId: string, serviceLine: string): Promise<number | null> {
  const res = await pool.query(
    `SELECT level2_rate FROM care_level_rates
      WHERE client_id = $1 AND location_id = $2 AND service_line = $3`,
    [CLIENT, locId, serviceLine],
  );
  return res.rows.length ? Number(res.rows[0].level2_rate) : null;
}

async function main(): Promise<void> {
  const locId = await seed();
  try {
    // ── 1. First automatic run fills the empty campus ────────────────────────
    const first = await storage.backfillCareLevelRatesFromHistory(CLIENT);
    assert('first import inserts one entry per service line', first.inserted, 2);
    assert('first import preserves nothing (there was nothing to preserve)', first.preserved, 0);
    assert('first import overwrites nothing', first.overwritten, 0);
    assert('AL takes the rate from the most recent upload month',
      await storedRate(locId, 'AL'), RR_AL_CARE_NEW);
    assert('HC keeps its daily basis untouched',
      await storedRate(locId, 'HC'), RR_HC_CARE_DAILY);

    // ── 2. An admin correction must survive every later import ───────────────
    await pool.query(
      `UPDATE care_level_rates SET level2_rate = $1
        WHERE client_id = $2 AND location_id = $3 AND service_line = 'AL'`,
      [ADMIN_AL_CARE, CLIENT, locId],
    );

    const second = await storage.backfillCareLevelRatesFromHistory(CLIENT);
    assert('re-import inserts nothing new', second.inserted, 0);
    assert('re-import reports both entries as preserved', second.preserved, 2);
    assert('re-import overwrites nothing', second.overwritten, 0);
    assert('manually-entered AL care rate is NOT replaced by the rent roll',
      await storedRate(locId, 'AL'), ADMIN_AL_CARE);

    // Running it repeatedly — as consecutive uploads do — stays a no-op.
    await storage.backfillCareLevelRatesFromHistory(CLIENT);
    assert('a second consecutive import still leaves the admin value alone',
      await storedRate(locId, 'AL'), ADMIN_AL_CARE);

    // ── 3. The explicit force re-run (admin endpoint / seed jobs) does replace ─
    const forced = await storage.backfillCareLevelRatesFromHistory(CLIENT, { overwriteExisting: true });
    assert('force re-run reports the rows it replaced', forced.overwritten, 2);
    assert('force re-run inserts nothing new', forced.inserted, 0);
    assert('force re-run restores the rent-roll AL figure',
      await storedRate(locId, 'AL'), RR_AL_CARE_NEW);

    // ── 4. Matching uses the backfilled rate, not the $55/day default ────────
    // Read the stored rates back through the production accessor and feed them to
    // the same adjustment function competitor rate matching calls.
    const stored = await storage.getCareLevel2Rates(CLIENT);
    const careMap = new Map<string, number>(
      stored
        .filter(r => r.locationId === locId)
        .map(r => [r.serviceLine, r.level2Rate]),
    );

    const competitorCareMonthly = 1500;
    const withBackfill = computeCompetitorAdjustments('AL', competitorCareMonthly, 0, careMap);
    const withoutAnyRate = computeCompetitorAdjustments('AL', competitorCareMonthly, 0, undefined);

    assert('backfilled campus does not fall back to the $55/day default',
      withBackfill.usedCareFallback, false);
    assert('care adjustment is competitor care minus OUR backfilled rate',
      withBackfill.careLevel2Adjustment, competitorCareMonthly - RR_AL_CARE_NEW);
    assert('a campus with no entry still falls back (the case the panel reports)',
      withoutAnyRate.usedCareFallback, true);
    assert('the fallback is materially different, so the backfill matters',
      withBackfill.careLevel2Adjustment !== withoutAnyRate.careLevel2Adjustment, true);

    // HC is stored daily and must be converted before the comparison.
    const hcAdj = computeCompetitorAdjustments('HC', 1500, 0, careMap);
    assert('HC care rate is converted from daily to monthly before subtraction',
      hcAdj.careLevel2Adjustment, 1500 - RR_HC_CARE_DAILY * DAYS_PER_MONTH);
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
