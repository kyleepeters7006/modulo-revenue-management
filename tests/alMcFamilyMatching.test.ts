/**
 * Regression tests: AL-scoped rules must include AL/MC units in impact counts.
 *
 * Guards the invariant that family matching works throughout the impact pipeline:
 *   • computeQualifiedRuleImpact — group-level slFamily check
 *   • unitPasses — legacy trigger conds.serviceLine check
 *   • computeReferenceDataRulePreview — action filters.serviceLine check
 *
 * Run with: npx tsx tests/alMcFamilyMatching.test.ts
 */

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
    console.log(`    Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertGt(description: string, actual: number, min: number) {
  if (actual > min) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected > ${min}, Got: ${actual}`);
    failed++;
  }
}

console.log('\n=== AL/MC Family Matching Tests ===\n');

import('../server/services/ruleImpactService').then(async ({
  computeQualifiedRuleImpact,
  computeProspectiveRuleImpact,
}) => {

  // ---------------------------------------------------------------------------
  // 1. Build a minimal RuleImpactContext with AL and AL/MC units
  // ---------------------------------------------------------------------------
  console.log('-- 1. computeQualifiedRuleImpact: AL-scoped rule covers AL/MC groups --');

  const makeUnit = (id: string, sl: string, occupied: boolean = true) => ({
    id,
    location_id: 'loc-1',
    location: 'Campus A',
    service_line: sl,
    room_type: 'Studio',
    room_number: '101',
    street_rate: 4000,
    care_rate: 0,
    in_house_rate: 3800,
    occupied_yn: occupied,
    days_vacant: occupied ? 0 : 30,
    competitor_final_rate: 4200,
    payor_type: 'Private Pay',
  });

  const alUnit  = makeUnit('u-al-1',   'AL',    true);
  const alUnit2 = makeUnit('u-al-2',   'AL',    false);
  const alMcUnit = makeUnit('u-almc-1', 'AL/MC', true);
  const alMcUnit2 = makeUnit('u-almc-2', 'AL/MC', false);
  const vilUnit  = makeUnit('u-vil-1',  'VIL',   true);

  const allUnits = [alUnit, alUnit2, alMcUnit, alMcUnit2, vilUnit];

  // Build minimal groups map: locId|sl|rt → units[]
  const groups = new Map<string, typeof allUnits>([
    ['loc-1|AL|Studio',    [alUnit,   alUnit2]],
    ['loc-1|AL/MC|Studio', [alMcUnit, alMcUnit2]],
    ['loc-1|VIL|Studio',   [vilUnit]],
  ]);

  // Build minimal metrics map (just enough to not crash)
  const makeAgg = () => ({ total: 1, occupied: 1, stSum: 4000, stN: 1, compStSum: 4000, compCSum: 4200, compN: 1, ihStSum: 3800, ihISum: 3800, ihN: 1, dvSum: 0, dvN: 1 });
  const metrics = new Map([
    ['loc-1',               { ...makeAgg(), total: 5, occupied: 3 }],
    ['loc-1|AL',            { ...makeAgg(), total: 2, occupied: 1 }],
    ['loc-1|AL|Studio',     { ...makeAgg(), total: 2, occupied: 1 }],
    ['loc-1|AL/MC',         { ...makeAgg(), total: 2, occupied: 1 }],
    ['loc-1|AL/MC|Studio',  { ...makeAgg(), total: 2, occupied: 1 }],
    ['loc-1|VIL',           { ...makeAgg(), total: 1, occupied: 1 }],
    ['loc-1|VIL|Studio',    { ...makeAgg(), total: 1, occupied: 1 }],
  ]);

  // slMoveInRate: 0.1 move-in per unit per month (keeps math simple)
  const slMoveInRate = new Map([['AL', 0.1], ['AL/MC', 0.1], ['VIL', 0.1]]);

  const ctx: any = {
    clientId: 'test',
    latestMonth: '2026-07',
    units: allUnits,
    groups,
    metrics,
    moveMap: new Map(),
    slMoveInRate,
    compBenchmark: {},
    locIdToName: new Map([['loc-1', 'Campus A']]),
    campusStreetToCompVar: new Map(),
    trailingOccMap: new Map(),
    rtgReverse: new Map(),
  };

  // ── Test A: AL-scoped rule includes AL/MC units ──
  const alRule = {
    id: 'rule-al',
    serviceLine: 'AL',
    serviceLines: null,
    locationId: null,
    action: {
      adjustmentType: 'percentage',
      adjustmentValue: 5,
      filters: {},
    },
    trigger: { type: 'immediate' },
    isActive: true,
    isHistorical: false,
    priority: 0,
    createdAt: new Date('2026-01-01'),
  };

  const alResult = computeQualifiedRuleImpact(ctx, alRule);

  // AL: 2 units, AL/MC: 2 units. VIL must be excluded.
  assert('AL-scoped rule: affectedUnits covers both AL and AL/MC',
    alResult.affectedUnits, 4);
  assertGt('AL-scoped rule: monthlyImpact is non-zero', alResult.monthlyImpact, 0);
  assert('AL-scoped rule: VIL units excluded (perServiceLine has no VIL)',
    alResult.perServiceLine.some(s => s.serviceLine === 'VIL'), false);
  assert('AL-scoped rule: AL/MC appears in perServiceLine breakdown',
    alResult.perServiceLine.some(s => s.serviceLine === 'AL/MC'), true);
  assert('AL-scoped rule: AL appears in perServiceLine breakdown',
    alResult.perServiceLine.some(s => s.serviceLine === 'AL'), true);

  // ── Test B: AL/MC-scoped rule covers only AL/MC (not AL) ──
  console.log('\n-- 2. AL/MC-scoped rule covers only AL/MC --');
  const alMcRule = {
    ...alRule,
    id: 'rule-almc',
    serviceLine: 'AL/MC',
    serviceLines: null,
  };
  const alMcResult = computeQualifiedRuleImpact(ctx, alMcRule);
  assert('AL/MC-scoped rule: affectedUnits = 2 (only AL/MC)',
    alMcResult.affectedUnits, 2);
  assert('AL/MC-scoped rule: AL not included',
    alMcResult.perServiceLine.some(s => s.serviceLine === 'AL'), false);

  // ── Test C: HC-scoped rule covers HC/MC ──
  console.log('\n-- 3. HC-scoped rule covers HC/MC --');
  const hcUnit   = makeUnit('u-hc-1',   'HC',    true);
  const hcMcUnit = makeUnit('u-hcmc-1', 'HC/MC', true);

  const ctxHC: any = {
    ...ctx,
    units: [hcUnit, hcMcUnit],
    groups: new Map([
      ['loc-1|HC|Studio',    [hcUnit]],
      ['loc-1|HC/MC|Studio', [hcMcUnit]],
    ]),
    metrics: new Map([
      ['loc-1',              { ...makeAgg(), total: 2, occupied: 2 }],
      ['loc-1|HC',           { ...makeAgg(), total: 1, occupied: 1 }],
      ['loc-1|HC|Studio',    { ...makeAgg(), total: 1, occupied: 1 }],
      ['loc-1|HC/MC',        { ...makeAgg(), total: 1, occupied: 1 }],
      ['loc-1|HC/MC|Studio', { ...makeAgg(), total: 1, occupied: 1 }],
    ]),
    slMoveInRate: new Map([['HC', 0.1], ['HC/MC', 0.1]]),
  };

  const hcRule = { ...alRule, id: 'rule-hc', serviceLine: 'HC', serviceLines: null };
  const hcResult = computeQualifiedRuleImpact(ctxHC, hcRule);
  assert('HC-scoped rule: affectedUnits covers both HC and HC/MC',
    hcResult.affectedUnits, 2);
  assert('HC-scoped rule: HC/MC appears in perServiceLine',
    hcResult.perServiceLine.some(s => s.serviceLine === 'HC/MC'), true);

  // ── Test D: serviceLines array ['AL'] also includes AL/MC ──
  console.log('\n-- 4. serviceLines array [\'AL\'] also covers AL/MC --');
  const alArrRule = {
    ...alRule,
    id: 'rule-al-arr',
    serviceLine: null,
    serviceLines: ['AL'],
  };
  const alArrResult = computeQualifiedRuleImpact(ctx, alArrRule);
  assert('serviceLines:[\'AL\'] rule: affectedUnits covers AL + AL/MC',
    alArrResult.affectedUnits, 4);

  // ── Test E: Blanket rule (no SL scope) covers all ──
  console.log('\n-- 5. Blanket rule (no SL scope) covers all service lines --');
  const blanketRule = { ...alRule, id: 'rule-blanket', serviceLine: null, serviceLines: null };
  const blanketResult = computeQualifiedRuleImpact(ctx, blanketRule);
  assert('Blanket rule: affectedUnits = 5 (all service lines)',
    blanketResult.affectedUnits, 5);

  // ── Test F: computeProspectiveRuleImpact preview also respects family matching ──
  console.log('\n-- 6. computeProspectiveRuleImpact (rule designer preview) respects family matching --');
  const { net, gross } = computeProspectiveRuleImpact(ctx, alRule, []);
  assert('Prospective AL rule gross: covers AL + AL/MC',
    gross.affectedUnits, 4);
  assert('Prospective AL rule net: covers AL + AL/MC (no dedup conflict)',
    net.affectedUnits, 4);

  // ── Test G: VIL-scoped rule does NOT bleed into AL/MC ──
  console.log('\n-- 7. VIL-scoped rule does not include AL/MC --');
  const vilRule = { ...alRule, id: 'rule-vil', serviceLine: 'VIL', serviceLines: null };
  const vilResult = computeQualifiedRuleImpact(ctx, vilRule);
  assert('VIL-scoped rule: affectedUnits = 1 (VIL only)',
    vilResult.affectedUnits, 1);
  assert('VIL-scoped rule: AL/MC not included',
    vilResult.perServiceLine.some(s => s.serviceLine === 'AL/MC'), false);

  // ── Test H: slMoveInRate lookup for AL/MC is used (non-zero move-in impact) ──
  console.log('\n-- 8. Move-in impact for AL/MC group is non-zero --');
  const alMcSLResult = alResult.perServiceLine.find(s => s.serviceLine === 'AL/MC');
  assertGt('AL/MC perServiceLine entry has non-zero moveInsPerMonth',
    alMcSLResult?.moveInsPerMonth ?? 0, 0);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n=== Summary ===');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);

}).catch(err => {
  console.error('Test failed to load:', err);
  process.exit(1);
});
