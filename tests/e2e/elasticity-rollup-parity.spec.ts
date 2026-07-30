/**
 * Regression test: elasticity / DTS parity between the grouped Reference Data
 * view and the Room Detail (units) view.
 *
 * The /api/reference-data endpoint returns one row per campus × SL × room-type
 * group, with elasticity and DTS values read directly from elasticity_metrics.
 *
 * The /api/reference-data/units endpoint returns one row per unit; each unit
 * repeats the group-level elasticity/DTS values (same pattern as campusOccSpot).
 *
 * The frontend rolls up unit rows to the grouped view using the weighted-average
 * helper with AGG_WAVG_KEYS. This test verifies:
 *   wavg(unit rows for group, key) ≈ grouped row[key]
 *
 * for every elasticity/DTS key in AGG_WAVG_KEYS, covering both populated groups
 * (real data from the API) and the null case (groups with no elasticity data).
 *
 * Importing AGG_WAVG_KEYS from the shared module means this test fails if any
 * elasticity key is removed from that list — preventing silent contract drift.
 *
 * Run with: npx playwright test tests/e2e/elasticity-rollup-parity.spec.ts
 */

import { test, expect } from '@playwright/test';
import { AGG_WAVG_KEYS, wavg } from '../../shared/referenceDataAgg';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

/** Keys from AGG_WAVG_KEYS that live in both endpoints' unit rows. */
const ELASTICITY_KEYS = [
  'elasticity',
  'daysToSellBefore',
  'daysToSellAfter',
  'daysToSellChange',
  'predictedDaysToSellChange',
] as const;

// Verify the keys we test are actually present in the production key list —
// this assertion fails at import time if a key is removed from AGG_WAVG_KEYS.
for (const k of ELASTICITY_KEYS) {
  if (!AGG_WAVG_KEYS.includes(k)) {
    throw new Error(
      `Key "${k}" is missing from AGG_WAVG_KEYS in shared/referenceDataAgg.ts. ` +
      `Remove it from ELASTICITY_KEYS or restore it to AGG_WAVG_KEYS.`
    );
  }
}

const EPSILON = 1e-9;

function approxEq(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < EPSILON;
}

test.describe('Elasticity / DTS rollup parity — grouped vs Room Detail', () => {

  test('every group: unit-level wavg of elasticity/DTS equals the grouped-view value', async ({ request }) => {
    // Fetch both endpoints in parallel.
    const [groupedRes, unitsRes] = await Promise.all([
      request.get(`${BASE_URL}/api/reference-data`),
      request.get(`${BASE_URL}/api/reference-data/units`),
    ]);

    expect(groupedRes.ok()).toBeTruthy();
    expect(unitsRes.ok()).toBeTruthy();

    const grouped: { rows: Record<string, any>[] } = await groupedRes.json();
    const units:   { rows: Record<string, any>[] } = await unitsRes.json();

    expect(Array.isArray(grouped.rows)).toBeTruthy();
    expect(Array.isArray(units.rows)).toBeTruthy();

    // Bail early (not a failure) if there is no data yet.
    if (grouped.rows.length === 0) {
      console.warn('[elasticity-rollup] No grouped rows — skipping parity check (no data seeded).');
      return;
    }

    // Index unit rows by their campus||serviceLine||roomType key.
    const unitsByGroup = new Map<string, Record<string, any>[]>();
    for (const u of units.rows) {
      const key = `${u.campus}||${u.serviceLine || 'Other'}||${u.roomType || 'Other'}`;
      if (!unitsByGroup.has(key)) unitsByGroup.set(key, []);
      unitsByGroup.get(key)!.push(u);
    }

    let checkedGroups = 0;
    let nullGroups    = 0;
    let populatedGroups = 0;

    for (const groupRow of grouped.rows) {
      const key = `${groupRow.campus}||${groupRow.serviceLine || 'Other'}||${groupRow.roomType || 'Other'}`;
      const unitRows = unitsByGroup.get(key);

      // Every grouped row must have at least one unit row.
      expect(unitRows, `No unit rows found for group key: ${key}`).toBeTruthy();
      if (!unitRows) continue;

      for (const field of ELASTICITY_KEYS) {
        const groupVal: number | null = groupRow[field] ?? null;
        const unitWavg = wavg(unitRows, (r) => r[field] ?? null);

        expect(
          approxEq(unitWavg, groupVal),
          `Group "${key}" field "${field}": ` +
          `unit wavg=${unitWavg} does not match grouped=${groupVal}`
        ).toBeTruthy();
      }

      checkedGroups++;
      if (groupRow.elasticity === null || groupRow.elasticity === undefined) {
        nullGroups++;
      } else {
        populatedGroups++;
      }
    }

    console.log(
      `[elasticity-rollup] Checked ${checkedGroups} groups ` +
      `(${populatedGroups} with elasticity data, ${nullGroups} null).`
    );

    // At least one group must exist to count as a meaningful run.
    expect(checkedGroups).toBeGreaterThan(0);
  });

  test('null-field groups: wavg returns null when every unit row has null for that field', async ({ request }) => {
    const unitsRes = await request.get(`${BASE_URL}/api/reference-data/units`);
    expect(unitsRes.ok()).toBeTruthy();
    const units: { rows: Record<string, any>[] } = await unitsRes.json();

    if (units.rows.length === 0) {
      console.warn('[elasticity-rollup] No unit rows — skipping null case (no data seeded).');
      return;
    }

    // Index unit rows by group key.
    const unitsByGroup = new Map<string, Record<string, any>[]>();
    for (const u of units.rows) {
      const key = `${u.campus}||${u.serviceLine || 'Other'}||${u.roomType || 'Other'}`;
      if (!unitsByGroup.has(key)) unitsByGroup.set(key, []);
      unitsByGroup.get(key)!.push(u);
    }

    // For each elasticity key independently, find groups where every unit row
    // carries null for that field and verify wavg resolves to null.
    // Note: elasticity may be null while DTS fields are non-null (or vice versa),
    // so we test each field on its own rather than assuming all fields move together.
    const nullCoverage: Record<string, number> = {};
    for (const field of ELASTICITY_KEYS) {
      let nullGroupsForField = 0;
      for (const [key, rows] of Array.from(unitsByGroup.entries())) {
        const allNull = rows.every(r => r[field] === null || r[field] === undefined);
        if (!allNull) continue;
        const result = wavg(rows, (r) => r[field] ?? null);
        expect(
          result,
          `Group "${key}" field "${field}": all units are null so wavg must be null, got ${result}`
        ).toBeNull();
        nullGroupsForField++;
      }
      nullCoverage[field] = nullGroupsForField;
    }

    console.log('[elasticity-rollup] Null-field group coverage:', nullCoverage);

    // At least one field must have null-group coverage to be a meaningful run.
    const totalNullGroups = Object.values(nullCoverage).reduce((a, b) => a + b, 0);
    expect(totalNullGroups, 'Expected at least one null-field group across all elasticity keys').toBeGreaterThan(0);
  });

  test('AGG_WAVG_KEYS contains all four elasticity/DTS fields', () => {
    // This test fails immediately at import time (see top-of-file loop) if a
    // key is missing; this assertion documents the expectation explicitly.
    for (const k of ELASTICITY_KEYS) {
      expect(AGG_WAVG_KEYS).toContain(k);
    }
  });
});
