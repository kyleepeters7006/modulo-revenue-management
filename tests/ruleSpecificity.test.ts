/**
 * Regression tests for specificity-based rule precedence.
 *
 * Guards the invariant that targeted rules (campus/SL/RT-scoped) always
 * take priority over blanket portfolio rules in both:
 *   a) the unit-level dedup that drives coverage-map and impact totals, and
 *   b) the live pricing engine (applyAdjustmentRulesToUnit).
 *
 * Run with: npx tsx tests/ruleSpecificity.test.ts
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

function assertClose(description: string, actual: number, expected: number, epsilon = 1) {
  if (Math.abs(actual - expected) <= epsilon) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ~${expected}, Got: ${actual}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. ruleSpecificityScore
// ---------------------------------------------------------------------------
console.log('\n=== ruleSpecificity.test.ts ===\n');
console.log('-- 1. ruleSpecificityScore --');

// Import the exported function directly to test it in isolation.
// The function is a pure calculation — no DB required.
import('../server/services/ruleImpactService').then(async ({ ruleSpecificityScore }) => {

  // Blanket: no location, no SL, no RT filter → score 0
  assert('Blanket rule scores 0',
    ruleSpecificityScore({ action: { adjustmentValue: 3 } }),
    0);

  // SL-only: service line set, no location or RT → score 2
  assert('SL-specific rule scores 2',
    ruleSpecificityScore({ serviceLine: 'VIL', action: {} }),
    2);

  // SL array: serviceLines non-empty → score 2
  assert('serviceLines[] rule scores 2',
    ruleSpecificityScore({ serviceLines: ['AL', 'HC'], action: {} }),
    2);

  // RT-only filter: room type in action.filters, no location/SL → score 1
  assert('RT-specific (no SL) rule scores 1',
    ruleSpecificityScore({ action: { filters: { roomType: ['Studio'] } } }),
    1);

  // Location-specific: locationId set → score 4
  assert('Location-specific rule scores 4',
    ruleSpecificityScore({ locationId: 'loc-1', action: {} }),
    4);

  // Location + SL → score 6
  assert('Location + SL rule scores 6',
    ruleSpecificityScore({ locationId: 'loc-1', serviceLine: 'VIL', action: {} }),
    6);

  // Location + SL + RT → score 7 (maximum)
  assert('Location + SL + RT rule scores 7',
    ruleSpecificityScore({
      locationId: 'loc-1',
      serviceLine: 'VIL',
      action: { filters: { roomType: ['Studio'] } },
    }),
    7);

  // Empty serviceLines array: no SL scope → score 0 contribution for SL
  assert('Empty serviceLines[] does not score SL points',
    ruleSpecificityScore({ serviceLines: [], action: {} }),
    0);

  // ---------------------------------------------------------------------------
  // 2. Sort order: targeted rules sort before blanket rules
  // ---------------------------------------------------------------------------
  console.log('\n-- 2. Dedup sort order (specificity > priority > date) --');

  const blanket    = { id: '1', serviceLine: null,  serviceLines: null, locationId: null,    action: { adjustmentValue: 3 },  priority: 10, effectiveDate: '2026-07-01' };
  const slSpecific = { id: '2', serviceLine: 'VIL', serviceLines: null, locationId: null,    action: { adjustmentValue: 6 },  priority:  0, effectiveDate: '2026-04-01' };
  const locSpec    = { id: '3', serviceLine: 'VIL', serviceLines: null, locationId: 'loc-A', action: { adjustmentValue: 8 },  priority:  0, effectiveDate: '2026-04-01' };

  const sorted = [blanket, slSpecific, locSpec].sort((a, b) => {
    const specDiff = ruleSpecificityScore(b) - ruleSpecificityScore(a);
    if (specDiff !== 0) return specDiff;
    const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priDiff !== 0) return priDiff;
    const da = a.effectiveDate ?? '';
    const db = b.effectiveDate ?? '';
    return db.localeCompare(da);
  });

  assert('Location-specific rule sorts first', sorted[0].id, '3');
  assert('SL-specific rule sorts second', sorted[1].id, '2');
  assert('Blanket rule (even with high priority) sorts last', sorted[2].id, '1');

  // Within same specificity tier, higher explicit priority sorts first
  const sl1 = { id: 'a', serviceLine: 'AL', serviceLines: null, locationId: null, action: { adjustmentValue: 3 }, priority: 5, effectiveDate: '2026-04-01' };
  const sl2 = { id: 'b', serviceLine: 'AL', serviceLines: null, locationId: null, action: { adjustmentValue: 6 }, priority: 2, effectiveDate: '2026-07-01' };
  const slSorted = [sl1, sl2].sort((a, b) => {
    const specDiff = ruleSpecificityScore(b) - ruleSpecificityScore(a);
    if (specDiff !== 0) return specDiff;
    const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priDiff !== 0) return priDiff;
    return (b.effectiveDate ?? '').localeCompare(a.effectiveDate ?? '');
  });
  assert('Within same specificity tier: higher explicit priority sorts first', slSorted[0].id, 'a');

  // Within same specificity + priority, newer effectiveDate sorts first
  const sl3 = { id: 'c', serviceLine: 'AL', serviceLines: null, locationId: null, action: { adjustmentValue: 3 }, priority: 0, effectiveDate: '2026-07-01' };
  const sl4 = { id: 'd', serviceLine: 'AL', serviceLines: null, locationId: null, action: { adjustmentValue: 5 }, priority: 0, effectiveDate: '2026-04-01' };
  const dateSorted = [sl4, sl3].sort((a, b) => {
    const specDiff = ruleSpecificityScore(b) - ruleSpecificityScore(a);
    if (specDiff !== 0) return specDiff;
    const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priDiff !== 0) return priDiff;
    return (b.effectiveDate ?? '').localeCompare(a.effectiveDate ?? '');
  });
  assert('Within same specificity + priority: newer date sorts first', dateSorted[0].id, 'c');

  // ---------------------------------------------------------------------------
  // 3. Engine: applyAdjustmentRulesToUnit — targeted suppresses blanket
  // ---------------------------------------------------------------------------
  console.log('\n-- 3. applyAdjustmentRulesToUnit — targeted suppresses blanket --');

  // We need to test the engine without a DB.  Import the function and pass
  // pre-built active rules + a unit that qualifies for both.
  const { applyAdjustmentRulesToUnit } = await import('../server/services/adjustmentRulesService');

  const unit = {
    clientId: 'test',
    locationId: 'loc-A',
    serviceLine: 'VIL',
    roomType: 'Studio',
    occupiedYN: false,
    daysVacant: 45,
    streetRate: 3000,
  };

  // Minimal rule shape expected by the engine
  const targetedRule: any = {
    id: 'targeted',
    name: 'VIL Studio +6%',
    isActive: true,
    priority: 0,
    effectiveDate: '2026-04-01',
    locationId: null,             // not campus-pinned; just SL+RT scoped
    serviceLine: 'VIL',
    serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 6 },
  };

  const blanketRule: any = {
    id: 'blanket',
    name: 'Portfolio +3%',
    isActive: true,
    priority: 10,                 // higher explicit priority — must NOT override targeted
    effectiveDate: '2026-07-01',  // newer date — must NOT override targeted
    locationId: null,
    serviceLine: null,
    serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 },
  };

  const baseRate = 3000;

  // Targeted rule alone: +6% → 3180
  const resultTargetedOnly = applyAdjustmentRulesToUnit(unit, baseRate, [targetedRule]);
  assert('Targeted rule alone applies +6%',
    resultTargetedOnly.ruleAdjustedRate, Math.round(baseRate * 1.06));
  assert('Targeted rule name recorded',
    resultTargetedOnly.appliedRuleName, 'VIL Studio +6%');

  // Blanket rule alone: +3% → 3090
  const resultBlanketOnly = applyAdjustmentRulesToUnit(unit, baseRate, [blanketRule]);
  assert('Blanket rule alone applies +3%',
    resultBlanketOnly.ruleAdjustedRate, Math.round(baseRate * 1.03));

  // Both together: targeted wins, blanket is suppressed → 3180 (not 3090 or 3275)
  const resultBoth = applyAdjustmentRulesToUnit(unit, baseRate, [blanketRule, targetedRule]);
  assert('Targeted rule suppresses blanket (only +6% applied, not additive)',
    resultBoth.ruleAdjustedRate, Math.round(baseRate * 1.06));
  assert('Only targeted rule name in result',
    resultBoth.appliedRuleName, 'VIL Studio +6%');
  assert('Blanket rule with higher priority does not override targeted rule',
    resultBoth.ruleAdjustedRate !== Math.round(baseRate * 1.03), true);

  // Blanket-only portfolio: two blanket rules stack as before (no suppression)
  const blanket2: any = {
    id: 'blanket2',
    name: 'Portfolio concession -2%',
    isActive: true,
    priority: 0,
    effectiveDate: null,
    locationId: null,
    serviceLine: null,
    serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: -2 },
  };
  const resultTwoBlankets = applyAdjustmentRulesToUnit(unit, baseRate, [blanketRule, blanket2]);
  // blanket +3% then -2%: 3000 * 1.03 = 3090, * 0.98 = 3028
  const expectedTwoBlankets = Math.round(Math.round(baseRate * 1.03) * 0.98);
  assert('Two blanket rules stack (no suppression when no targeted rule)',
    resultTwoBlankets.ruleAdjustedRate, expectedTwoBlankets);

  // No qualifying rules: null result
  const noMatchRule: any = {
    ...targetedRule,
    serviceLine: 'HC',  // unit is VIL — won't match
  };
  const resultNoMatch = applyAdjustmentRulesToUnit(unit, baseRate, [noMatchRule]);
  assert('Non-matching rule returns null rate', resultNoMatch.ruleAdjustedRate, null);
  assert('Non-matching rule returns null name', resultNoMatch.appliedRuleName, null);

  console.log('\n-- 3b. Engine: cross-scope targeted rules & cycle supersession --');

  // Unit with a locationId so location-pinned rules can qualify
  const unitAtCampusA: any = { ...unit, locationId: 'campus-a' };

  // April SL-only (scope key: ''|VIL|'') + July Campus-A+SL (scope key: 'campus-a'|VIL|'')
  // Different scope keys → neither supersedes the other → both stack
  const aprSLOnly: any = {
    id: 'apr-sl', name: 'VIL Portfolio +3%', isActive: true, priority: 0,
    effectiveDate: '2026-04-01', locationId: null, serviceLine: 'VIL', serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 },
  };
  const julLocSL: any = {
    id: 'jul-loc', name: 'Campus A VIL +5%', isActive: true, priority: 0,
    effectiveDate: '2026-07-01', locationId: 'campus-a', serviceLine: 'VIL', serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 5 },
  };
  // Most-specific-wins: campus+SL (spec 6) suppresses SL-only (spec 2) for campus units.
  // Only the campus+SL rule applies → +5% only, not additive.
  const resultCrossScope = applyAdjustmentRulesToUnit(unitAtCampusA, baseRate, [aprSLOnly, julLocSL]);
  assert('Most-specific-wins: campus+SL (spec 6) suppresses SL-only (spec 2) for campus units',
    resultCrossScope.ruleAdjustedRate, Math.round(baseRate * 1.05));

  // Same scope key (both Campus-A + VIL) → July supersedes April
  const aprLocSL: any = {
    id: 'apr-loc', name: 'Campus A VIL +3% (April)', isActive: true, priority: 0,
    effectiveDate: '2026-04-01', locationId: 'campus-a', serviceLine: 'VIL', serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 },
  };
  const resultSameScopeCycle = applyAdjustmentRulesToUnit(unitAtCampusA, baseRate, [aprLocSL, julLocSL]);
  // Only July rule survives cycle filter → +5% only
  assert('Same-scope targeted: July supersedes April in engine cycle filter',
    resultSameScopeCycle.ruleAdjustedRate, Math.round(baseRate * 1.05));
  assert('Same-scope targeted: only July rule name applied',
    resultSameScopeCycle.appliedRuleName, 'Campus A VIL +5%');

  // Cross-scope check: April+CampusA and July+CampusB both for a CampusA unit.
  // The July CampusB rule does NOT qualify for CampusA unit (locationId mismatch), so only April applies.
  const julLocSLCampusB: any = {
    id: 'jul-loc-b', name: 'Campus B VIL +5%', isActive: true, priority: 0,
    effectiveDate: '2026-07-01', locationId: 'campus-b', serviceLine: 'VIL', serviceLines: null,
    trigger: { type: 'immediate' },
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 5 },
  };
  const resultDiffCampus = applyAdjustmentRulesToUnit(unitAtCampusA, baseRate, [aprLocSL, julLocSLCampusB]);
  // Campus-B rule doesn't qualify for Campus-A unit → only April Campus-A rule applies
  assert('Campus-B rule does not qualify for Campus-A unit — only Campus-A April rule applies',
    resultDiffCampus.ruleAdjustedRate, Math.round(baseRate * 1.03));

  // ---------------------------------------------------------------------------
  // 4. Client-side supersededIds: targeted rules must not be superseded by
  //    newer blanket rules (mirrors pricing-controls.tsx supersededIds logic)
  // ---------------------------------------------------------------------------
  console.log('\n-- 4. Client-side supersededIds cycle logic --');

  // Inline mirror of the scopeKey + supersededIds logic from pricing-controls.tsx
  function scopeKey(r: any): string {
    const hasSL = (Array.isArray(r.serviceLines) && r.serviceLines.length > 0) || !!r.serviceLine;
    const hasRT = Array.isArray(r.action?.filters?.roomType) && r.action.filters.roomType.length > 0;
    const tier = (r.locationId || hasSL || hasRT) ? 'targeted' : 'blanket';
    const loc = r.locationId ?? '';
    const sl  = r.serviceLine ?? (Array.isArray(r.serviceLines) && r.serviceLines.length ? r.serviceLines.slice().sort().join('+') : '');
    const rt  = Array.isArray(r.action?.filters?.roomType)
      ? r.action.filters.roomType.slice().sort().join('+') : '';
    return `${tier}|${loc}|${sl}|${rt}`;
  }

  function computeSupersededIds(rules: any[]): Set<string> {
    const latestCyclePerKey: Record<string, string> = {};
    rules.forEach(r => {
      if (!r.effectiveDate) return;
      const key   = scopeKey(r);
      const month = String(r.effectiveDate).slice(0, 7);
      if (!latestCyclePerKey[key] || month > latestCyclePerKey[key]) latestCyclePerKey[key] = month;
    });
    const ids = new Set<string>();
    rules.forEach(r => {
      if (!r.effectiveDate) return;
      const key    = scopeKey(r);
      const month  = String(r.effectiveDate).slice(0, 7);
      const latest = latestCyclePerKey[key];
      if (latest && month < latest) ids.add(r.id);
    });
    return ids;
  }

  // ── Tier isolation: blanket cannot supersede targeted ──
  const commTargeted = { id: 't1', serviceLine: 'VIL', serviceLines: null, locationId: null, effectiveDate: '2026-04-01', action: { adjustmentValue: 6 } };
  const commBlanket  = { id: 'b1', serviceLine: null,  serviceLines: null, locationId: null, effectiveDate: '2026-07-01', action: { adjustmentValue: 3 } };
  const sup1 = computeSupersededIds([commTargeted, commBlanket]);
  assert('Targeted April VIL rule NOT superseded by blanket July rule', sup1.has('t1'), false);
  assert('Blanket July rule is not superseded (latest in its tier)', sup1.has('b1'), false);

  // ── Same-scope targeted: older IS superseded ──
  const commTargetedOld = { id: 't2', serviceLine: 'VIL', serviceLines: null, locationId: null, effectiveDate: '2026-04-01', action: { adjustmentValue: 3 } };
  const commTargetedNew = { id: 't3', serviceLine: 'VIL', serviceLines: null, locationId: null, effectiveDate: '2026-07-01', action: { adjustmentValue: 5 } };
  const sup2 = computeSupersededIds([commTargetedOld, commTargetedNew]);
  assert('Older targeted VIL rule (April) superseded by newer targeted VIL rule (July)', sup2.has('t2'), true);
  assert('Newer targeted VIL rule (July) is not superseded', sup2.has('t3'), false);

  // ── Same-scope blanket: older IS superseded ──
  const commBlanketOld = { id: 'b2', serviceLine: null, serviceLines: null, locationId: null, effectiveDate: '2026-04-01', action: { adjustmentValue: 3 } };
  const commBlanketNew = { id: 'b3', serviceLine: null, serviceLines: null, locationId: null, effectiveDate: '2026-07-01', action: { adjustmentValue: 5 } };
  const sup3 = computeSupersededIds([commBlanketOld, commBlanketNew]);
  assert('Older blanket rule (April) superseded by newer blanket rule (July)', sup3.has('b2'), true);
  assert('Newer blanket rule (July) is not superseded', sup3.has('b3'), false);

  // ── No effectiveDate = ongoing rule: never superseded ──
  const commOngoing = { id: 'on1', serviceLine: 'VIL', serviceLines: null, locationId: null, effectiveDate: null, action: { adjustmentValue: 2 } };
  const sup4 = computeSupersededIds([commOngoing, commTargetedNew]);
  assert('Ongoing rule (no effectiveDate) is never superseded', sup4.has('on1'), false);

  // ── effectiveRulesForTotal: mirrors engine Pass 3 blanket suppression ──
  // Both rules survive cycle-supersession. Whether a blanket rule contributes to
  // the NET TOTAL depends on whether it has leftover units (affectedUnits > 0).
  // This mirrors the engine's Pass 3 which suppresses blanket rules per-unit when
  // a targeted rule qualifies for the same unit.
  // clientSpecScore mirrors the module-level function in pricing-controls.tsx
  function clientSpecScore(r: any): number {
    let score = 0;
    if (r.locationId) score += 4;
    const sls = Array.isArray(r.serviceLines) && r.serviceLines.length
      ? r.serviceLines : r.serviceLine ? [r.serviceLine] : [];
    if (sls.length > 0) score += 2;
    const rt = r.action?.filters?.roomType;
    if (Array.isArray(rt) && rt.length > 0) score += 1;
    return score;
  }
  function effectiveRulesForTotal(rules: any[]): any[] {
    return rules.filter(r =>
      clientSpecScore(r) > 0          // targeted rules always count
      || (r.affectedUnits ?? 0) > 0  // blanket only counts when it has leftover units
    );
  }
  const survivedCycle = [commTargeted, commBlanket].filter(r => !sup1.has(r.id));
  assert('Both rules survive cycle-supersession (neither is cycle-superseded)', survivedCycle.length, 2);

  // Fully-displaced blanket (affectedUnits: 0) → excluded from total
  const blanketDisplaced  = { ...commBlanket,  affectedUnits: 0,  annualImpact: 0 };
  const targetedWithUnits = { ...commTargeted, affectedUnits: 50, annualImpact: 30000 };
  const totalRules1 = [targetedWithUnits, blanketDisplaced].filter(r => !sup1.has(r.id));
  const forTotal1 = effectiveRulesForTotal(totalRules1);
  assert('Fully-displaced blanket (affectedUnits: 0) excluded from total', forTotal1.length, 1);
  assert('Only targeted rule appears in effectiveRulesForTotal when blanket is displaced', forTotal1[0].id, 't1');

  // Partially-displaced blanket (affectedUnits > 0) → included in total
  const blanketPartial = { ...commBlanket, affectedUnits: 25, annualImpact: 15000 };
  const totalRules2 = [targetedWithUnits, blanketPartial].filter(r => !sup1.has(r.id));
  const forTotal2 = effectiveRulesForTotal(totalRules2);
  assert('Partially-displaced blanket (affectedUnits > 0) IS included in total', forTotal2.length, 2);
  const netTotal = forTotal2.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
  assert('Net total = targeted impact + blanket-leftover impact', netTotal, 30000 + 15000);

  // ── Cross-scope: Campus A VIL (April) NOT superseded by Campus B VIL (July) ──
  const campusAVIL = { id: 'ca1', serviceLine: 'VIL', serviceLines: null, locationId: 'loc-campus-a', effectiveDate: '2026-04-01', action: { adjustmentValue: 4 } };
  const campusBVIL = { id: 'cb1', serviceLine: 'VIL', serviceLines: null, locationId: 'loc-campus-b', effectiveDate: '2026-07-01', action: { adjustmentValue: 6 } };
  const sup5 = computeSupersededIds([campusAVIL, campusBVIL]);
  assert('Campus A VIL (April) NOT superseded by Campus B VIL (July) — different location scope', sup5.has('ca1'), false);
  assert('Campus B VIL (July) is not superseded (latest for its scope)', sup5.has('cb1'), false);

  // ── Same-campus same-SL: older IS superseded ──
  const campusAVILOld = { id: 'ca2', serviceLine: 'VIL', serviceLines: null, locationId: 'loc-campus-a', effectiveDate: '2026-04-01', action: { adjustmentValue: 3 } };
  const campusAVILNew = { id: 'ca3', serviceLine: 'VIL', serviceLines: null, locationId: 'loc-campus-a', effectiveDate: '2026-07-01', action: { adjustmentValue: 5 } };
  const sup6 = computeSupersededIds([campusAVILOld, campusAVILNew]);
  assert('Same-campus same-SL older rule (April) IS superseded by newer (July)', sup6.has('ca2'), true);
  assert('Same-campus same-SL newer rule (July) is not superseded', sup6.has('ca3'), false);

  // ── Room-type-only rules at different campuses do not supersede each other ──
  const rtCampusA = { id: 'rt1', serviceLine: null, serviceLines: null, locationId: 'loc-campus-a', effectiveDate: '2026-04-01', action: { filters: { roomType: ['Studio'] }, adjustmentValue: 2 } };
  const rtCampusB = { id: 'rt2', serviceLine: null, serviceLines: null, locationId: 'loc-campus-b', effectiveDate: '2026-07-01', action: { filters: { roomType: ['Studio'] }, adjustmentValue: 3 } };
  const sup7 = computeSupersededIds([rtCampusA, rtCampusB]);
  assert('RT-only Campus A (April) NOT superseded by RT-only Campus B (July)', sup7.has('rt1'), false);
  assert('RT-only Campus B (July) is not superseded', sup7.has('rt2'), false);

  // ── Three-way: location-pinned (spec 6) + SL-only (spec 2) + blanket (spec 0) ──
  // All three exist in Apr/Apr/Jul. Only the blanket is a separate tier; the other two
  // have different scopes so they don't supersede each other either.
  const threeLoc = { id: '3loc', serviceLine: 'VIL', serviceLines: null, locationId: 'loc-a', effectiveDate: '2026-04-01', action: { adjustmentValue: 5 } };
  const threeSL  = { id: '3sl',  serviceLine: 'VIL', serviceLines: null, locationId: null,    effectiveDate: '2026-04-01', action: { adjustmentValue: 3 } };
  const threeBl  = { id: '3bl',  serviceLine: null,  serviceLines: null, locationId: null,    effectiveDate: '2026-07-01', action: { adjustmentValue: 2 } };
  const sup8 = computeSupersededIds([threeLoc, threeSL, threeBl]);
  assert('Three-way: location-pinned (April) not superseded', sup8.has('3loc'), false);
  assert('Three-way: SL-only (April) not superseded by blanket (July)', sup8.has('3sl'), false);
  assert('Three-way: blanket (July) is not superseded (latest in blanket tier)', sup8.has('3bl'), false);
  const effectiveThree = [threeLoc, threeSL, threeBl].filter(r => !sup8.has(r.id));
  assert('Three-way: all three rules count toward net total', effectiveThree.length, 3);

  // ---------------------------------------------------------------------------
  // 5. buildGroupRulePreviewRates — targeted beats high-priority blanket
  // ---------------------------------------------------------------------------
  console.log('\n-- 5. buildGroupRulePreviewRates: targeted-over-blanket in reference-data preview --');

  const { buildGroupRulePreviewRates } = await import('../server/services/ruleImpactService');

  const previewGroup = [{
    campus: 'campus-a',
    sl: 'VIL',
    rt: 'Studio',
    locationId: 'campus-a',
    modeStreetRate: 4000,
    avgIhRate: 3800,
    total: 20,
    occ: 14,
  }];

  // Blanket rule (spec 0): priority 10, +3% → would give 4120
  const blanketActiveRule: any = {
    id: 'bl1', name: 'Portfolio +3%', description: '', priority: 10,
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 },
    trigger: { type: 'immediate' },
    location_id: null, service_line: null, service_lines: null, effective_date: '2026-07-01', notes: null,
  };

  // Targeted rule (spec 2, SL-scoped): priority 0, +6% → would give 4240
  const targetedActiveRule: any = {
    id: 'tg1', name: 'VIL +6%', description: '', priority: 0,
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 6 },
    trigger: { type: 'immediate' },
    location_id: null, service_line: 'VIL', service_lines: null, effective_date: '2026-04-01', notes: null,
  };

  const campOcc = new Map([['campus-a', 0.7]]);
  const slOcc   = new Map([['campus-a||VIL', 0.7]]);
  const ihVar   = new Map<string, number>();

  // Blanket-only: +3% applied → 4120
  const { rulePreviewMap: pm1 } = buildGroupRulePreviewRates(
    previewGroup, [blanketActiveRule], campOcc, slOcc, ihVar
  );
  assertClose('Blanket-only preview rate = +3% of 4000', pm1.get('campus-a||VIL||Studio') ?? 0, 4120);

  // Targeted-only: +6% applied → 4240
  const { rulePreviewMap: pm2 } = buildGroupRulePreviewRates(
    previewGroup, [targetedActiveRule], campOcc, slOcc, ihVar
  );
  assertClose('Targeted-only preview rate = +6% of 4000', pm2.get('campus-a||VIL||Studio') ?? 0, 4240);

  // Both together: targeted wins even though blanket has higher priority (10 vs 0)
  const { rulePreviewMap: pm3, ruleRatesMap: rm3 } = buildGroupRulePreviewRates(
    previewGroup, [blanketActiveRule, targetedActiveRule], campOcc, slOcc, ihVar
  );
  const previewRate = pm3.get('campus-a||VIL||Studio') ?? 0;
  assertClose('Targeted rule wins preview rate over higher-priority blanket (reference-data path)',
    previewRate, 4240);
  assert('Blanket preview rate (4120) NOT selected when targeted rule qualifies',
    Math.abs(previewRate - 4120) > 10, true);

  // Both rules appear in ruleRatesMap (all qualifying rates shown in detail columns)
  assert('Targeted rule appears in ruleRatesMap', rm3.has('campus-a||VIL||Studio||tg1'), true);
  assert('Blanket rule appears in ruleRatesMap (rate column still shows it)', rm3.has('campus-a||VIL||Studio||bl1'), true);

  // Blanket-only group (no targeted rule qualifies): blanket preview is used
  const nonVILGroup = [{ ...previewGroup[0], sl: 'AL', rt: 'Studio', locationId: 'campus-a' }];
  const { rulePreviewMap: pm4 } = buildGroupRulePreviewRates(
    nonVILGroup, [blanketActiveRule, targetedActiveRule], campOcc,
    new Map([['campus-a||AL', 0.75]]), ihVar
  );
  // VIL targeted rule doesn't match AL group → blanket applies → 4120
  assertClose('Non-VIL group gets blanket rule (targeted SL-scoped rule does not apply to AL)',
    pm4.get('campus-a||AL||Studio') ?? 0, 4120);

  // ── Targeted vs targeted (different spec levels): higher spec wins ──
  // campus+SL rule (spec 6): VIL +3% → 4120; campus+SL+RT rule (spec 7): VIL Studio +6% → 4240
  const campusSLRule: any = {
    id: 'csl', name: 'Campus-A VIL +3%', description: '', priority: 5,
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 },
    trigger: { type: 'immediate' },
    location_id: 'campus-a', service_line: 'VIL', service_lines: null, effective_date: '2026-04-01', notes: null,
  };
  const campusSLRTRule: any = {
    id: 'cslrt', name: 'Campus-A VIL Studio +6%', description: '', priority: 0,
    action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 6, filters: { roomType: ['Studio'] } },
    trigger: { type: 'immediate' },
    location_id: 'campus-a', service_line: 'VIL', service_lines: null, effective_date: '2026-07-01', notes: null,
  };
  // Preview for VIL Studio group: campus+SL+RT (spec 7) wins over campus+SL (spec 6)
  const { rulePreviewMap: pm5 } = buildGroupRulePreviewRates(
    previewGroup, [campusSLRule, campusSLRTRule], campOcc, slOcc, ihVar
  );
  assertClose('campus+SL+RT rule (spec 7) wins VIL Studio preview over campus+SL (spec 6)',
    pm5.get('campus-a||VIL||Studio') ?? 0, 4240);
  assert('campus+SL rule (spec 6) does NOT win VIL Studio preview (suppressed by higher spec)',
    Math.abs((pm5.get('campus-a||VIL||Studio') ?? 0) - 4120) > 10, true);

  // Engine: campus+SL+RT wins for Studio unit, campus+SL wins for non-RT unit
  const studioUnit: any = { serviceLine: 'VIL', roomType: 'Studio', occupiedYN: false, daysVacant: 30, streetRate: 4000, locationId: 'campus-a' };
  const resultStudio = applyAdjustmentRulesToUnit(studioUnit, 4000, [
    { ...campusSLRule, action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 }, locationId: 'campus-a', serviceLine: 'VIL', serviceLines: null, effectiveDate: '2026-04-01', priority: 5, isActive: true, name: campusSLRule.name, id: campusSLRule.id, trigger: campusSLRule.trigger },
    { ...campusSLRTRule, action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 6, filters: { roomType: ['Studio'] } }, locationId: 'campus-a', serviceLine: 'VIL', serviceLines: null, effectiveDate: '2026-07-01', priority: 0, isActive: true, name: campusSLRTRule.name, id: campusSLRTRule.id, trigger: campusSLRTRule.trigger },
  ] as any);
  assertClose('Engine: campus+SL+RT rule (+6%) wins for Studio unit (campus+SL +3% suppressed)',
    resultStudio.ruleAdjustedRate ?? 0, 4240);
  assert('Engine: campus+SL rule NOT applied to Studio unit (suppressed by higher spec)',
    Math.abs((resultStudio.ruleAdjustedRate ?? 0) - Math.round(4000 * 1.03 * 1.06)) > 1, true);

  // Engine: only campus+SL applies to non-Studio VIL unit (campus+SL+RT doesn't qualify)
  const oneSuiteUnit: any = { serviceLine: 'VIL', roomType: 'One Bedroom', occupiedYN: false, daysVacant: 10, streetRate: 4500, locationId: 'campus-a' };
  const resultOneSuite = applyAdjustmentRulesToUnit(oneSuiteUnit, 4500, [
    { ...campusSLRule, action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 3 }, locationId: 'campus-a', serviceLine: 'VIL', serviceLines: null, effectiveDate: '2026-04-01', priority: 5, isActive: true, name: campusSLRule.name, id: campusSLRule.id, trigger: campusSLRule.trigger },
    { ...campusSLRTRule, action: { type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: 6, filters: { roomType: ['Studio'] } }, locationId: 'campus-a', serviceLine: 'VIL', serviceLines: null, effectiveDate: '2026-07-01', priority: 0, isActive: true, name: campusSLRTRule.name, id: campusSLRTRule.id, trigger: campusSLRTRule.trigger },
  ] as any);
  assertClose('Engine: campus+SL rule (+3%) applies to non-Studio VIL unit (campus+SL+RT does not qualify)',
    resultOneSuite.ruleAdjustedRate ?? 0, Math.round(4500 * 1.03));

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);

}).catch(err => {
  console.error('Test setup error:', err);
  process.exit(1);
});
