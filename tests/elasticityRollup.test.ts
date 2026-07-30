/**
 * Unit-level tests for elasticity / DTS rollup logic.
 *
 * Imports the production AGG_WAVG_KEYS list and wavg helper from
 * shared/referenceDataAgg.ts so that:
 *   - Removing an elasticity key from AGG_WAVG_KEYS breaks ELASTICITY_KEYS check
 *   - The wavg arithmetic tested is identical to what the frontend runs
 *
 * For API-level parity (grouped vs Room Detail endpoints), see:
 *   tests/e2e/elasticity-rollup-parity.spec.ts
 *
 * Run with: npx tsx tests/elasticityRollup.test.ts
 */
import { AGG_WAVG_KEYS, wavg } from '../shared/referenceDataAgg';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0;
let failed = 0;

function assert(description: string, actual: unknown, expected: unknown) {
  const eq =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) < 1e-9
      : actual === expected;
  if (eq) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Guard: verify the elasticity/DTS keys are present in AGG_WAVG_KEYS.
// This assertion fails immediately if a key is removed from the production list.
// ---------------------------------------------------------------------------
const ELASTICITY_KEYS = ['elasticity', 'daysToSellBefore', 'daysToSellAfter', 'daysToSellChange'];

console.log('\n=== AGG_WAVG_KEYS contract ===\n');
for (const k of ELASTICITY_KEYS) {
  assert(`AGG_WAVG_KEYS includes "${k}"`, AGG_WAVG_KEYS.includes(k), true);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface GroupElasticityData {
  elasticity: number | null;
  daysToSellBefore: number | null;
  daysToSellAfter: number | null;
  daysToSellChange: number | null;
}

function makeUnitRows(n: number, groupData: GroupElasticityData): Record<string, any>[] {
  // Server sets totalUnits = 1 for each Room Detail row.
  return Array.from({ length: n }, () => ({ totalUnits: 1, ...groupData }));
}

// ---------------------------------------------------------------------------
// Tests using the shared wavg (production logic, not a copy)
// ---------------------------------------------------------------------------
console.log('\n=== Elasticity / DTS Rollup Parity (using shared/referenceDataAgg wavg) ===\n');

console.log('-- Populated elasticity --');
{
  const g: GroupElasticityData = { elasticity: -1.42, daysToSellBefore: 28.5, daysToSellAfter: 35.2, daysToSellChange: 6.7 };
  for (const n of [1, 5, 15]) {
    const rows = makeUnitRows(n, g);
    for (const k of ELASTICITY_KEYS) {
      assert(`${n}-unit group: ${k} wavg == group value`, wavg(rows, r => r[k]), (g as any)[k]);
    }
  }
}

console.log('\n-- Positive elasticity --');
{
  const g: GroupElasticityData = { elasticity: 0.87, daysToSellBefore: 14.0, daysToSellAfter: 12.2, daysToSellChange: -1.8 };
  const rows = makeUnitRows(3, g);
  assert('Positive elasticity wavg preserved', wavg(rows, r => r.elasticity), g.elasticity);
  assert('Negative daysToSellChange wavg preserved', wavg(rows, r => r.daysToSellChange), g.daysToSellChange);
}

console.log('\n-- Null elasticity group --');
{
  const g: GroupElasticityData = { elasticity: null, daysToSellBefore: null, daysToSellAfter: null, daysToSellChange: null };
  for (const n of [1, 8]) {
    const rows = makeUnitRows(n, g);
    for (const k of ELASTICITY_KEYS) {
      assert(`${n}-unit null group: ${k} wavg == null`, wavg(rows, r => r[k]), null);
    }
  }
}

console.log('\n-- Partial data (elasticity set, some DTS fields null) --');
{
  const g: GroupElasticityData = { elasticity: -0.55, daysToSellBefore: null, daysToSellAfter: 22.0, daysToSellChange: null };
  const rows = makeUnitRows(4, g);
  assert('Partial: elasticity wavg preserved', wavg(rows, r => r.elasticity), -0.55);
  assert('Partial: daysToSellBefore wavg == null', wavg(rows, r => r.daysToSellBefore), null);
  assert('Partial: daysToSellAfter wavg preserved', wavg(rows, r => r.daysToSellAfter), 22.0);
  assert('Partial: daysToSellChange wavg == null', wavg(rows, r => r.daysToSellChange), null);
}

console.log('\n-- Cross-group isolation --');
{
  const gA: GroupElasticityData = { elasticity: -2.1, daysToSellBefore: 30, daysToSellAfter: 42, daysToSellChange: 12 };
  const gB: GroupElasticityData = { elasticity: -0.3, daysToSellBefore: 20, daysToSellAfter: 18, daysToSellChange: -2 };
  assert('Group A: wavg == A value', wavg(makeUnitRows(3, gA), r => r.elasticity), gA.elasticity);
  assert('Group B: wavg == B value', wavg(makeUnitRows(7, gB), r => r.elasticity), gB.elasticity);
  const combined = [...makeUnitRows(3, gA), ...makeUnitRows(7, gB)];
  const expectedBlend = (gA.elasticity! * 3 + gB.elasticity! * 7) / 10;
  assert('Cross-group blend is unit-weighted', wavg(combined, r => r.elasticity), expectedBlend);
}

console.log('\n-- Parity: grouped-view value == unit wavg within the same group --');
{
  for (const v of [-3.14, 0.0, 1.001, -0.0001, 100]) {
    const rows = makeUnitRows(6, { elasticity: v, daysToSellBefore: 10, daysToSellAfter: 15, daysToSellChange: 5 });
    assert(`Parity for elasticity=${v}`, wavg(rows, r => r.elasticity), v);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests total: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
