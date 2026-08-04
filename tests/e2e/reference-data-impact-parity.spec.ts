/**
 * Regression test: Room Detail revenue impact parity with grouped view.
 *
 * For every campus × service-line × room-type group that appears in
 * GET /api/reference-data, the sum of unit.revMonthlyImpact values from
 * GET /api/reference-data/units must equal the grouped row's revMonthlyImpact
 * within $0.01.
 *
 * Three distinct, controlled scenarios:
 *
 *   A. Groups where a manual rate override is in effect.
 *      State is controlled via POST/DELETE /api/manual-rate-override.
 *      Any pre-existing override for the chosen group is detected up-front
 *      and the original state is fully restored in a finally block.
 *
 *   B. Groups using the rule-preview fallback (no stored rule_adjusted_rate).
 *      The demo data always has active adjustment rules that produce preview
 *      rates for the Kalamazoo locations; these groups are identified by
 *      proposedRule non-null + no manual override + not the Case-C seeded group.
 *
 *   C. Groups with a stored rule_adjusted_rate written by the pricing engine.
 *      State is seeded in beforeAll by directly writing rule_adjusted_rate
 *      (= ROUND(street_rate × 1.05)) and a T3-window move_in_date to a known
 *      group (SEED_LOCATION / SEED_SERVICE_LINE / SEED_ROOM_TYPE).  This
 *      produces a non-null revMonthlyImpact so the sum-parity assertion is
 *      exercised with real numbers, not the trivial null == null case.
 *      All seeded values are reset in afterAll.
 *
 * Run with: npx playwright test tests/e2e/reference-data-impact-parity.spec.ts
 */

import { test, expect } from '@playwright/test';
import pg from 'pg';
const { Client } = pg;

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

/** Dollar tolerance for parity assertion (task spec: within $0.01). */
const TOLERANCE = 0.01;

/**
 * Connection string for DB-backed scenarios.  Prefer DATABASE_URL (set by
 * Replit's postgres add-on as a system env var) and fall back to
 * NEON_DATABASE_URL (the project-level secret for the Neon cloud database).
 * Scenarios B (DB proof) and C (DB seeding) are skipped when neither is set.
 */
const DB_URL = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
const HAS_DB = Boolean(DB_URL);

// ── Seeded group for Case C ───────────────────────────────────────────────────
// Wichita - 325, AL, Companion: 20 units at avg street ~$5 417.
// beforeAll discovers the latest upload month dynamically, then sets
// rule_adjusted_rate = ROUND(street_rate × 1.05) on all units and
// move_in_date = '2026-06-15' on three of them (T3-window date).
// All original field values are saved and restored exactly in afterAll.
const SEED_LOCATION     = 'Wichita - 325';
const SEED_SERVICE_LINE = 'AL';
const SEED_ROOM_TYPE    = 'Companion';

// Populated by beforeAll — not hard-coded.
let SEED_UPLOAD_MONTH = '';

const seedState: {
  allUnits:    Array<{ id: string; originalRate: number | null }>;
  moveInUnits: Array<{ id: string; originalMoveIn: string | null }>;
} = { allUnits: [], moveInUnits: [] };

// ── DB helpers ────────────────────────────────────────────────────────────────

async function openDb(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build a map of group-key → sum of revMonthlyImpact for unit rows that carry
 * a non-null value.  Groups where ALL units are null produce no entry.
 */
function buildUnitSumMap(unitRows: any[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const u of unitRows) {
    if (u.revMonthlyImpact === null || u.revMonthlyImpact === undefined) continue;
    const key = `${u.campus}||${u.serviceLine || 'Other'}||${u.roomType || 'Other'}`;
    map.set(key, (map.get(key) ?? 0) + Number(u.revMonthlyImpact));
  }
  return map;
}

/**
 * Set of group-keys where at least one unit carries a non-null revMonthlyImpact.
 * Used to enforce the null-invariant: grouped null → all units null.
 */
function buildUnitValueSet(unitRows: any[]): Set<string> {
  const set = new Set<string>();
  for (const u of unitRows) {
    if (u.revMonthlyImpact !== null && u.revMonthlyImpact !== undefined) {
      set.add(`${u.campus}||${u.serviceLine || 'Other'}||${u.roomType || 'Other'}`);
    }
  }
  return set;
}

/**
 * For every row in groupedRows assert one of:
 *   • Null invariant: grouped is null → no unit carries a non-null value.
 *   • Sum invariant:  grouped is non-null → |sum(unit) − grouped| ≤ $0.01.
 */
function assertParity(
  groupedRows: any[],
  unitRows: any[],
  label: string,
): void {
  const unitSumMap   = buildUnitSumMap(unitRows);
  const unitValueSet = buildUnitValueSet(unitRows);
  const mismatches: string[] = [];

  for (const g of groupedRows) {
    const key = `${g.campus}||${g.serviceLine || 'Other'}||${g.roomType || 'Other'}`;

    if (g.revMonthlyImpact === null || g.revMonthlyImpact === undefined) {
      // Null invariant: the grouped endpoint reports null, so units must too.
      if (unitValueSet.has(key)) {
        mismatches.push(
          `${key}: grouped=null but at least one unit has non-null revMonthlyImpact`,
        );
      }
    } else {
      // Sum invariant.
      const groupedVal = Number(g.revMonthlyImpact);
      const unitSum    = unitSumMap.get(key) ?? 0;
      const diff       = Math.abs(round2(unitSum) - round2(groupedVal));
      if (diff > TOLERANCE) {
        mismatches.push(
          `${key}: grouped=${round2(groupedVal)} units_sum=${round2(unitSum)} diff=${round2(diff)}`,
        );
      }
    }
  }

  expect(mismatches.length).toBe(
    0,
    `${label} — parity failures (${mismatches.length}):\n` +
      mismatches.map(m => `  • ${m}`).join('\n'),
  );
}

// ── Seeded state setup / teardown ─────────────────────────────────────────────

test.beforeAll(async () => {
  if (!HAS_DB) return; // DATABASE_URL not available; Scenarios B and C will skip
  const db = await openDb();
  try {
    // 1. Discover the latest upload month dynamically — no hard-coded dates.
    const monthRes = await db.query<{ m: string }>(
      `SELECT MAX(upload_month) AS m FROM rent_roll_data WHERE client_id = 'demo'`,
    );
    SEED_UPLOAD_MONTH = monthRes.rows[0]?.m ?? '';
    if (!SEED_UPLOAD_MONTH) return; // no demo data at all; Case C will skip

    // 2. Fetch all units for the target group, capturing original field values
    //    so afterAll can restore them exactly.
    const res = await db.query<{
      id: string;
      street_rate: number;
      rule_adjusted_rate: number | null;
      move_in_date: string | null;
    }>(
      `SELECT id, street_rate, rule_adjusted_rate, move_in_date
       FROM rent_roll_data
       WHERE client_id    = 'demo'
         AND upload_month = $1
         AND location     = $2
         AND service_line = $3
         AND room_type    = $4
         AND street_rate  > 0
       LIMIT 20`,
      [SEED_UPLOAD_MONTH, SEED_LOCATION, SEED_SERVICE_LINE, SEED_ROOM_TYPE],
    );

    if (res.rows.length === 0) return; // seed group not present; Case C will skip

    // Save originals for exact restoration in afterAll.
    seedState.allUnits = res.rows.map(r => ({
      id:           r.id,
      originalRate: r.rule_adjusted_rate ?? null,
    }));
    // Give 3 units a T3-window move_in_date so revMonthlyImpact becomes non-null.
    seedState.moveInUnits = res.rows.slice(0, 3).map(r => ({
      id:             r.id,
      originalMoveIn: r.move_in_date,
    }));

    // 3. Seed rule_adjusted_rate = ROUND(street_rate × 1.05) for all units.
    await db.query(
      `UPDATE rent_roll_data
       SET rule_adjusted_rate = ROUND(street_rate * 1.05)
       WHERE id = ANY($1)`,
      [seedState.allUnits.map(u => u.id)],
    );

    // 4. Seed a T3-window move_in_date for 3 units.
    //    One month before the latest upload month is always inside the T3 window.
    //    Compute with Date arithmetic to handle January → December year rollover.
    const [uploadYear, uploadMon] = SEED_UPLOAD_MONTH.split('-').map(Number);
    const prevDate = new Date(uploadYear, uploadMon - 1 - 1, 15); // month is 0-based
    const t3SeedDate = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-15`;
    await db.query(
      `UPDATE rent_roll_data
       SET move_in_date = $1
       WHERE id = ANY($2)`,
      [t3SeedDate, seedState.moveInUnits.map(u => u.id)],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  if (seedState.allUnits.length === 0) return;
  const db = await openDb();
  try {
    // Restore rule_adjusted_rate to its exact original value per row
    // (may be NULL or a previously stored engine-produced rate).
    for (const { id, originalRate } of seedState.allUnits) {
      await db.query(
        `UPDATE rent_roll_data SET rule_adjusted_rate = $1 WHERE id = $2`,
        [originalRate, id],
      );
    }
    // Restore original move_in_date for the 3 units that received a seeded date.
    for (const { id, originalMoveIn } of seedState.moveInUnits) {
      await db.query(
        `UPDATE rent_roll_data SET move_in_date = $1 WHERE id = $2`,
        [originalMoveIn, id],
      );
    }
  } finally {
    await db.end();
  }

  // Explicitly bust the reference-data cache so the application does not
  // serve stale seeded values after the test suite completes.  Uses the
  // SEED_SECRET-guarded POST /api/admin/bust-ref-data-cache endpoint that
  // calls invalidateRefDataCache() directly without a debounced side-effect.
  // Failures are swallowed so they never mask the DB-restore result above.
  try {
    await fetch(`${BASE_URL}/api/admin/bust-ref-data-cache`, {
      method: 'POST',
      headers: { 'x-seed-secret': process.env.SEED_SECRET ?? '' },
    });
  } catch {
    // Cache invalidation is best-effort; DB restore above is the authoritative cleanup.
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Reference-data impact parity — units sum == grouped', () => {
  test.setTimeout(120_000);

  // ── Core ───────────────────────────────────────────────────────────────────
  // Verifies both the null-invariant and sum-invariant across every group
  // returned by the endpoints.  Includes the seeded Wichita group which carries
  // a non-null revMonthlyImpact, making this a meaningful end-to-end check.
  test(
    'sum(unit.revMonthlyImpact) rounds to grouped.revMonthlyImpact within $0.01 for every group',
    async ({ request }) => {
      const [gRes, uRes] = await Promise.all([
        request.get(`${BASE_URL}/api/reference-data`),
        request.get(`${BASE_URL}/api/reference-data/units`),
      ]);
      expect(gRes.ok()).toBeTruthy();
      expect(uRes.ok()).toBeTruthy();

      const groupedRows: any[] = (await gRes.json()).rows ?? [];
      const unitRows: any[]    = (await uRes.json()).rows ?? [];
      expect(groupedRows.length).toBeGreaterThan(0);
      expect(unitRows.length).toBeGreaterThan(0);

      assertParity(groupedRows, unitRows, 'Core parity');
    },
  );

  // ── Scenario A: manual rate override ──────────────────────────────────────
  test('parity holds for groups with a manual rate override', async ({ request }) => {
    // 1. Discover any pre-existing overrides so we can choose an unoccupied group.
    const existingRes = await request.get(`${BASE_URL}/api/manual-rate-overrides`);
    expect(existingRes.ok()).toBeTruthy();
    const existing: any[] = await existingRes.json();
    const existingKeys = new Set(
      existing.map((o: any) =>
        `${o.location_name}||${o.service_line}||${o.room_type}`,
      ),
    );

    // 2. Pick the first grouped row that has a street rate and no existing override.
    const gRes0 = await request.get(`${BASE_URL}/api/reference-data`);
    expect(gRes0.ok()).toBeTruthy();
    const allGrouped: any[] = (await gRes0.json()).rows ?? [];

    const target = allGrouped.find(
      (r) =>
        r.streetSpot !== null &&
        r.streetSpot > 0 &&
        !existingKeys.has(
          `${r.campus}||${r.serviceLine}||${r.roomType || 'Other'}`,
        ),
    );
    if (!target) {
      test.skip(true, 'No group without a pre-existing override found — skipping');
      return;
    }

    const overrideRate = Math.round(Number(target.streetSpot) * 1.05);
    const overrideKey  =
      `${target.campus}||${target.serviceLine}||${target.roomType || 'Other'}`;

    // 3. Seed the override.  The POST also invalidates the grouped endpoint cache.
    const postRes = await request.post(`${BASE_URL}/api/manual-rate-override`, {
      data: {
        locationName: target.campus,
        serviceLine:  target.serviceLine,
        roomType:     target.roomType || 'Other',
        overrideRate,
      },
    });
    expect(postRes.ok()).toBeTruthy();

    try {
      const [gRes, uRes] = await Promise.all([
        request.get(`${BASE_URL}/api/reference-data`),
        request.get(`${BASE_URL}/api/reference-data/units`),
      ]);
      expect(gRes.ok()).toBeTruthy();
      expect(uRes.ok()).toBeTruthy();

      const groupedRows: any[] = (await gRes.json()).rows ?? [];
      const unitRows: any[]    = (await uRes.json()).rows ?? [];

      const overriddenGroup = groupedRows.find(
        (r) =>
          `${r.campus}||${r.serviceLine || 'Other'}||${r.roomType || 'Other'}` ===
          overrideKey,
      );
      expect(overriddenGroup).toBeTruthy();
      expect(overriddenGroup.hasManualOverride).toBe(true);

      assertParity([overriddenGroup], unitRows, 'Scenario A (manual override)');
    } finally {
      // 5. Restore: the group had no prior override, so a plain DELETE is correct.
      await request.delete(
        `${BASE_URL}/api/manual-rate-override/${encodeURIComponent(target.campus)}/` +
        `${encodeURIComponent(target.serviceLine)}/` +
        `${encodeURIComponent(target.roomType || 'Other')}`,
      );
    }
  });

  // ── Scenario B: rule-preview fallback ─────────────────────────────────────
  // Groups whose proposedRule comes exclusively from the rule-preview pipeline
  // (no stored rule_adjusted_rate in the DB, no manual override).
  // The demo dataset always has active adjustment rules for the Kalamazoo
  // location whose units carry no engine-produced stored rates.
  // A direct DB check verifies that claim before asserting parity.
  test('parity holds for groups using rule-preview fallback (no stored rate)', async ({
    request,
  }) => {
    const [gRes, uRes] = await Promise.all([
      request.get(`${BASE_URL}/api/reference-data`),
      request.get(`${BASE_URL}/api/reference-data/units`),
    ]);
    expect(gRes.ok()).toBeTruthy();
    expect(uRes.ok()).toBeTruthy();

    const groupedRows: any[] = (await gRes.json()).rows ?? [];
    const unitRows: any[]    = (await uRes.json()).rows ?? [];

    // Candidate preview-fallback groups: proposedRule set, no manual override,
    // explicitly excluding the Case-C seeded group which has a stored rate.
    const candidateGroups = groupedRows.filter(
      (g) =>
        g.proposedRule !== null &&
        g.proposedRule !== undefined &&
        !g.hasManualOverride &&
        !(
          g.campus                   === SEED_LOCATION &&
          g.serviceLine              === SEED_SERVICE_LINE &&
          (g.roomType || 'Other')    === SEED_ROOM_TYPE
        ),
    );

    // Active adjustment rules always produce preview rates for Kalamazoo groups
    // in the demo dataset.  If this count is zero the rule seeding is broken.
    expect(candidateGroups.length).toBeGreaterThan(
      0,
      'Expected at least one preview-fallback candidate; verify adjustment rules exist for demo client',
    );

    // ── DB proof: confirm none of the candidate groups have a stored rate ──
    // This distinguishes genuine rule-preview groups from stored-rate groups
    // that happen to have no manual override.  Requires DATABASE_URL; skip
    // without it rather than asserting an unverified claim.
    if (!HAS_DB) {
      test.skip(true, 'DATABASE_URL not set — cannot verify stored-rate absence for Scenario B');
      return;
    }
    const candidateCampuses = [...new Set(candidateGroups.map((g: any) => g.campus as string))];
    const db = await openDb();
    let storedRateCount = 0;
    try {
      const dbRes = await db.query<{ n: string }>(
        `SELECT COUNT(*)::int AS n
         FROM rent_roll_data
         WHERE client_id    = 'demo'
           AND upload_month = $1
           AND location     = ANY($2)
           AND rule_adjusted_rate > 0`,
        [SEED_UPLOAD_MONTH || (new Date().getFullYear() + '-07'), candidateCampuses],
      );
      storedRateCount = Number(dbRes.rows[0]?.n ?? 0);
    } finally {
      await db.end();
    }
    expect(storedRateCount).toBe(
      0,
      `Candidate preview groups include locations with stored rule_adjusted_rate — ` +
      `they are not pure preview-fallback groups`,
    );

    // Rename for clarity after the DB proof passes.
    const previewGroups = candidateGroups;

    // Active adjustment rules always produce preview rates for Kalamazoo groups
    // in the demo dataset.  If this count is zero the rule seeding is broken.
    expect(previewGroups.length).toBeGreaterThan(
      0,
      'Expected at least one preview-fallback group; verify adjustment rules exist for demo client',
    );

    assertParity(previewGroups, unitRows, 'Scenario B (rule-preview fallback)');
  });

  // ── Scenario C: stored rule_adjusted_rate ─────────────────────────────────
  // beforeAll seeds rule_adjusted_rate = ROUND(street_rate × 1.05) on every
  // SEED_LOCATION / SEED_SERVICE_LINE / SEED_ROOM_TYPE unit and sets
  // move_in_date = '2026-06-15' on three of them so the T3 move-in count
  // becomes non-null.  This causes the grouped endpoint to produce a non-null
  // revMonthlyImpact, making the sum-parity assertion test real arithmetic.
  test('parity holds for groups with stored rule_adjusted_rate (non-null impact)', async ({
    request,
  }) => {
    if (seedState.allUnits.length === 0) {
      test.skip(
        true,
        `Seed group ${SEED_LOCATION}/${SEED_SERVICE_LINE}/${SEED_ROOM_TYPE} ` +
        `not found in upload_month ${SEED_UPLOAD_MONTH} — stored-rate path cannot be exercised`,
      );
      return;
    }

    // Explicitly bust the reference-data cache so both endpoints reflect the
    // seeded DB state rather than a pre-seed cached payload.  The dedicated
    // bust endpoint calls invalidateRefDataCache() synchronously without
    // triggering the debounced 5-second re-warm that dummy mutations cause.
    await request.post(`${BASE_URL}/api/admin/bust-ref-data-cache`, {
      headers: { 'x-seed-secret': process.env.SEED_SECRET ?? '' },
    });

    const [gRes, uRes] = await Promise.all([
      request.get(`${BASE_URL}/api/reference-data`),
      request.get(`${BASE_URL}/api/reference-data/units`),
    ]);
    expect(gRes.ok()).toBeTruthy();
    expect(uRes.ok()).toBeTruthy();

    const groupedRows: any[] = (await gRes.json()).rows ?? [];
    const unitRows: any[]    = (await uRes.json()).rows ?? [];

    // Stored-rate group: the seeded location, identified by campus/SL/roomType
    // and the absence of a manual override.
    const storedRateGroups = groupedRows.filter(
      (g) =>
        g.campus                        === SEED_LOCATION &&
        g.serviceLine                   === SEED_SERVICE_LINE &&
        (g.roomType || 'Other')         === SEED_ROOM_TYPE &&
        g.proposedRule !== null &&
        g.proposedRule !== undefined &&
        !g.hasManualOverride,
    );

    // The seed was applied in beforeAll — the group must appear.
    expect(storedRateGroups.length).toBeGreaterThan(
      0,
      `Seeded group ${SEED_LOCATION}/${SEED_SERVICE_LINE}/${SEED_ROOM_TYPE} ` +
      `not found in grouped endpoint with a non-null proposedRule`,
    );

    // The three seeded T3-window move_in_dates must produce non-null impact.
    const seededGroup = storedRateGroups[0];
    expect(seededGroup.revMonthlyImpact).not.toBeNull();
    expect(Number(seededGroup.revMonthlyImpact)).toBeGreaterThan(0);

    // This is the key assertion: sum of unit impacts must equal grouped impact.
    assertParity(storedRateGroups, unitRows, 'Scenario C (stored rule_adjusted_rate)');
  });

  // ── Filtered parity: serviceLine filter ───────────────────────────────────
  // Confirms that parity holds when both endpoints are called with a
  // serviceLine filter — the shared T3 builder must apply the same scope so
  // impacts computed from filtered T3 counts match on both sides.
  test('filtered parity — serviceLine=AL', async ({ request }) => {
    const [gRes, uRes] = await Promise.all([
      request.get(`${BASE_URL}/api/reference-data?serviceLine=AL`),
      request.get(`${BASE_URL}/api/reference-data/units?serviceLine=AL`),
    ]);
    expect(gRes.ok()).toBeTruthy();
    expect(uRes.ok()).toBeTruthy();

    const groupedRows: any[] = (await gRes.json()).rows ?? [];
    const unitRows: any[]    = (await uRes.json()).rows ?? [];

    // Must have AL groups to exercise the assertion meaningfully.
    expect(groupedRows.length).toBeGreaterThan(
      0,
      'Expected AL grouped rows; verify demo data contains AL service line',
    );

    assertParity(groupedRows, unitRows, 'Filtered (serviceLine=AL)');
  });

  // ── Filtered parity: single-location filter ───────────────────────────────
  // Verifies that parity holds when both endpoints are scoped to one specific
  // campus — exercises the locations[] allowlist path in getGroupedT3MoveInsMap.
  test('filtered parity — locations=Kalamazoo - 301', async ({ request }) => {
    const loc = encodeURIComponent('Kalamazoo - 301');
    const [gRes, uRes] = await Promise.all([
      request.get(`${BASE_URL}/api/reference-data?locations=${loc}`),
      request.get(`${BASE_URL}/api/reference-data/units?locations=${loc}`),
    ]);
    expect(gRes.ok()).toBeTruthy();
    expect(uRes.ok()).toBeTruthy();

    const groupedRows: any[] = (await gRes.json()).rows ?? [];
    const unitRows: any[]    = (await uRes.json()).rows ?? [];

    expect(groupedRows.length).toBeGreaterThan(
      0,
      'Expected rows for Kalamazoo - 301; verify demo data contains that location',
    );
    // All returned groups must belong to the filtered location.
    for (const g of groupedRows) {
      expect(g.campus).toBe('Kalamazoo - 301');
    }

    assertParity(groupedRows, unitRows, 'Filtered (locations=Kalamazoo - 301)');
  });

  // ── Filtered parity: region filter ────────────────────────────────────────
  // Verifies that parity holds when both endpoints are scoped to a region —
  // exercises the regions[] → allowedLocs resolution in getGroupedT3MoveInsMap.
  test('filtered parity — regions=Central', async ({ request }) => {
    const [gRes, uRes] = await Promise.all([
      request.get(`${BASE_URL}/api/reference-data?regions=Central`),
      request.get(`${BASE_URL}/api/reference-data/units?regions=Central`),
    ]);
    expect(gRes.ok()).toBeTruthy();
    expect(uRes.ok()).toBeTruthy();

    const groupedRows: any[] = (await gRes.json()).rows ?? [];
    const unitRows: any[]    = (await uRes.json()).rows ?? [];

    expect(groupedRows.length).toBeGreaterThan(
      0,
      'Expected rows for region=Central; verify demo data contains that region',
    );

    assertParity(groupedRows, unitRows, 'Filtered (regions=Central)');
  });
});
