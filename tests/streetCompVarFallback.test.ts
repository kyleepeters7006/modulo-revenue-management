/**
 * Regression: live rule evaluation must not lose street_to_comp_var_pct when
 * a campus has NEITHER survey benchmark coverage NOR paired rent-roll
 * competitor_final_rate values.
 *
 * The impact preview (ruleImpactService.lookupMetric) falls back to the
 * SL-level street_to_comp_var_pct row persisted in campus_metrics by the
 * reference-data calculation. recalculateAndPreloadCampusMetrics deletes and
 * rebuilds campus_metrics before every rules run, so it must carry that row
 * over — otherwise a street_to_comp_var gate reads null in live pricing while
 * the preview qualifies units from the persisted value.
 *
 * Run with: npx tsx tests/streetCompVarFallback.test.ts
 */
import { pool } from '../server/db';
import { recalculateAndPreloadCampusMetrics } from '../server/services/adjustmentRulesService';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;
function assert(desc: string, ok: boolean, detail?: any) {
  if (ok) { console.log(`${PASS} ${desc}`); passed++; }
  else { console.log(`${FAIL} ${desc}`, detail ?? ''); failed++; }
}

const CLIENT = 'test-scv-fallback';

async function cleanup(locId: string | null) {
  await pool.query(`DELETE FROM campus_metrics WHERE client_id=$1`, [CLIENT]);
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id=$1`, [CLIENT]);
  if (locId) await pool.query(`DELETE FROM locations WHERE id=$1`, [locId]);
  else await pool.query(`DELETE FROM locations WHERE client_id=$1`, [CLIENT]);
}

async function main() {
  await cleanup(null);
  await pool.query(`DELETE FROM clients WHERE id=$1`, [CLIENT]);
  await pool.query(`INSERT INTO clients (id, name) VALUES ($1, 'SCV Fallback Test') ON CONFLICT (id) DO NOTHING`, [CLIENT]);
  // Synthetic campus with no survey coverage (name matches nothing in
  // competitor survey data) and rent roll rows without competitor rates.
  const locRes = await pool.query(
    `INSERT INTO locations (name, client_id) VALUES ('ZZ Test No-Survey Campus', $1) RETURNING id`,
    [CLIENT]
  );
  const locId = locRes.rows[0].id as string;
  try {
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, location, upload_month, service_line, room_type, room_number,
          occupied_yn, days_vacant, street_rate, in_house_rate, competitor_final_rate, payor_type, date, size)
       VALUES
         ($1,$2,'ZZ Test No-Survey Campus','2026-07','AL','Studio','101', true, 0, 4000, 3900, 0, 'Private', '2026-07-01', 'Studio'),
         ($1,$2,'ZZ Test No-Survey Campus','2026-07','AL','Studio','102', false, 12, 4100, 0, 0, 'Private', '2026-07-01', 'Studio')`,
      [CLIENT, locId]
    );
    // Pre-existing SL-level street_to_comp_var_pct (as written by the
    // reference-data calculation) — the value the preview falls back to.
    await pool.query(
      `INSERT INTO campus_metrics (client_id, location_id, service_line, room_type, metric_name, value, calculated_at)
       VALUES ($1,$2,'AL',NULL,'street_to_comp_var_pct',-7.5,NOW())`,
      [CLIENT, locId]
    );

    await recalculateAndPreloadCampusMetrics(CLIENT, locId);

    const after = await pool.query(
      `SELECT value FROM campus_metrics
       WHERE client_id=$1 AND location_id=$2 AND metric_name='street_to_comp_var_pct'
         AND service_line='AL' AND room_type IS NULL`,
      [CLIENT, locId]
    );
    assert('street_to_comp_var_pct row survives rebuild when no survey/paired-comp data exists',
      after.rows.length === 1, after.rows);
    assert('carried-over value is unchanged',
      after.rows.length === 1 && Math.abs(Number(after.rows[0].value) - (-7.5)) < 1e-6, after.rows[0]?.value);

    const occ = await pool.query(
      `SELECT value FROM campus_metrics
       WHERE client_id=$1 AND location_id=$2 AND metric_name='occupancy_pct'
         AND service_line='AL' AND room_type IS NULL`,
      [CLIENT, locId]
    );
    assert('fresh occupancy_pct is still recomputed alongside the carried-over row',
      occ.rows.length === 1 && Math.abs(Number(occ.rows[0].value) - 50) < 1e-6, occ.rows[0]?.value);

    // targetMonth honored when the campus has rows for it
    await recalculateAndPreloadCampusMetrics(CLIENT, locId, '2026-07');
    const after2 = await pool.query(
      `SELECT COUNT(*) AS n FROM campus_metrics
       WHERE client_id=$1 AND location_id=$2 AND metric_name='street_to_comp_var_pct'`,
      [CLIENT, locId]
    );
    assert('carry-over is idempotent across repeated runs with explicit targetMonth',
      Number(after2.rows[0].n) === 1, after2.rows[0]);
  } finally {
    await cleanup(locId);
    await pool.query(`DELETE FROM clients WHERE id=$1`, [CLIENT]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
