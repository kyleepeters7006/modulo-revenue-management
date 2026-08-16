/**
 * Endpoint-level parity test: the units growth drill-down
 * (GET /api/tile-details/units/drill-down) must tie back to the Total Units
 * dialog (GET /api/tile-details/units) it opens from.
 *
 * Seeds a throwaway client with 13 months of room_type_occupancy_history
 * whose capacity CHANGES every month (so any baseline off-by-one is caught),
 * including one campus that is missing in the year-ago month (so the derived
 * comparable-store cohort is exercised), logs in as a seeded user, and checks
 * for each period (t1/t3/t6/t12/ytd), portfolio and same-store:
 *   - drill-down current total == dialog current value
 *   - growth computed from drill-down current/previous sums == dialog growth
 *
 * Requires the dev server running on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/unitsDrilldownParity.test.ts
 */
import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const CLIENT = 'ptest-units-parity';
const USERNAME = 'ptest_units_parity';
const PASSWORD = 'ptest-password-1';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;
function assert(desc: string, actual: unknown, expected: unknown) {
  const eq =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) < 0.051 // growth is rounded to 1–2 decimals on each side
      : actual === expected;
  if (eq) { console.log(`${PASS} ${desc}`); passed++; }
  else { console.log(`${FAIL} ${desc}\n    expected: ${expected}\n    actual:   ${actual}`); failed++; }
}

// 13 months ending 2026-07 (oldest month exists ONLY so a 13-month window
// would produce a different t12 baseline than the dialog's 12-month window).
function monthsBack(n: number): { year: number; month: number; ym: string } {
  const y = 2026, m = 7;
  const idx = (y * 12 + (m - 1)) - n;
  const yy = Math.floor(idx / 12), mm = (idx % 12) + 1;
  return { year: yy, month: mm, ym: `${yy}-${String(mm).padStart(2, '0')}` };
}

async function seed() {
  await cleanup();
  await pool.query(`INSERT INTO clients (id, name) VALUES ($1, 'Parity Test') ON CONFLICT (id) DO NOTHING`, [CLIENT]);
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, client_id) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, client_id = $3`,
    [USERNAME, hash, CLIENT],
  );
  // Two campuses, capacity changes every month. Campus B is absent in the
  // year-ago month (12 back) => same-store cohort = Campus A only.
  const rows: any[] = [];
  for (let back = 12; back >= 0; back--) {
    const { year, month } = monthsBack(back);
    // Campus A always reports; capacity varies with the month index.
    rows.push([CLIENT, 'Campus A', 'AL', 'Studio', 'Studio', month, year, 40 + back, 100 + back * 3]);
    rows.push([CLIENT, 'Campus A', 'HC', 'HC Semi', 'Semi', month, year, 20, 50 + back]);
    // Campus B is missing exactly 12 months back (the year-ago month).
    if (back !== 12) {
      rows.push([CLIENT, 'Campus B', 'AL', 'Studio', 'Studio', month, year, 30, 80 + back * 2]);
    }
  }
  for (const r of rows) {
    await pool.query(
      `INSERT INTO room_type_occupancy_history
       (client_id, location_name, service_line, raw_room_type, normalized_room_type, month, year, occ_units, available_units)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      r,
    );
  }
}

async function cleanup() {
  await pool.query(`DELETE FROM room_type_occupancy_history WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM clients WHERE id = $1`, [CLIENT]);
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('no session cookie returned');
  return cookie.split(';')[0];
}

async function getJson(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const growth = (cur: number, prev: number) =>
  prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100 * 100) / 100;

async function main() {
  await seed();
  try {
    const cookie = await login();
    const dialog = await getJson('/api/tile-details/units', cookie);

    // Sanity: the dialog itself must be on the history source.
    // Latest month (back=0) totals: A: 100 + 50, B: 80 => 230
    assert('dialog current value reads history capacity', dialog.currentValue, 230);

    for (const period of ['t1', 't3', 't6', 't12', 'ytd'] as const) {
      // Portfolio
      const dd = await getJson(`/api/tile-details/units/drill-down?period=${period}`, cookie);
      const cur = dd.campuses.reduce((a: number, c: any) => a + c.current, 0);
      const prev = dd.campuses.reduce((a: number, c: any) => a + c.previous, 0);
      assert(`${period}: drill-down current total == dialog current value`, cur, dialog.currentValue);
      assert(`${period}: drill-down growth == dialog growth`, growth(cur, prev), dialog.growthStats[period]);

      // Same store
      const dds = await getJson(`/api/tile-details/units/drill-down?period=${period}&sameStore=true`, cookie);
      const sCur = dds.campuses.reduce((a: number, c: any) => a + c.current, 0);
      const sPrev = dds.campuses.reduce((a: number, c: any) => a + c.previous, 0);
      assert(`${period} same-store: drill-down current == dialog same-store value`, sCur, dialog.sameStore.currentValue);
      assert(`${period} same-store: growth == dialog same-store growth`, growth(sCur, sPrev), dialog.sameStore.growthStats[period]);
      assert(`${period} same-store: cohort excludes Campus B`, dds.campuses.some((c: any) => c.name === 'Campus B'), false);
    }
  } finally {
    await cleanup();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); try { await cleanup(); await pool.end(); } catch {} process.exit(1); });
