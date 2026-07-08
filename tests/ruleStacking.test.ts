/**
 * Regression tests for stacking-vs-exclusive display semantics.
 *
 * Guards against reintroducing the old `!isAdditive` check: rules STACK by
 * default; only rules explicitly marked exclusive (action.isAdditive === false)
 * display as exclusive and count toward exclusive priority numbers.
 *
 * These helpers are used by the Rule Designer badges, the calculation dialog,
 * and the pricing engine (server/services/adjustmentRulesService.ts).
 *
 * Run with: npx tsx tests/ruleStacking.test.ts
 */
import {
  isRuleAdditive,
  isRuleExclusive,
  exclusivePriority,
  applyRuleAdjustmentStep,
  getRuleAdjustment,
  replayRuleChain,
} from '../shared/ruleStacking';

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

console.log('\n=== Stacking-vs-Exclusive Semantics Tests ===\n');

// --- Badge semantics: unset / true / null → "+ stacks"; only false → "⊙ exclusive" ---
console.log('-- Badge display (isRuleAdditive) --');
assert('Unset isAdditive renders "+ stacks" (additive)', isRuleAdditive({}), true);
assert('Missing action object renders "+ stacks"', isRuleAdditive(undefined), true);
assert('Null action renders "+ stacks"', isRuleAdditive(null), true);
assert('isAdditive: null renders "+ stacks"', isRuleAdditive({ isAdditive: null }), true);
assert('isAdditive: true renders "+ stacks"', isRuleAdditive({ isAdditive: true }), true);
assert('isAdditive: false renders "⊙ exclusive"', isRuleAdditive({ isAdditive: false }), false);
// Old regression: `!isAdditive` treated undefined as exclusive. Must NOT happen.
assert('REGRESSION: unset flag must NOT display as exclusive', isRuleExclusive({}), false);
assert('REGRESSION: undefined isAdditive must NOT display as exclusive', isRuleExclusive({ isAdditive: undefined }), false);
assert('Only explicit false is exclusive', isRuleExclusive({ isAdditive: false }), true);
assert('isAdditive: true is not exclusive', isRuleExclusive({ isAdditive: true }), false);

// --- Exclusive priority numbers only count rules with isAdditive === false ---
console.log('\n-- Exclusive priority numbering (exclusivePriority) --');
const rUnset  = { id: 'a', isActive: true, action: {} };
const rTrue   = { id: 'b', isActive: true, action: { isAdditive: true } };
const rExcl1  = { id: 'c', isActive: true, action: { isAdditive: false } };
const rExcl2  = { id: 'd', isActive: true, action: { isAdditive: false } };
const rInact  = { id: 'e', isActive: false, action: { isAdditive: false } };
const ordered = [rUnset, rExcl1, rTrue, rExcl2];

assert('Unset-flag rule gets no exclusive priority', exclusivePriority(ordered, rUnset), null);
assert('isAdditive:true rule gets no exclusive priority', exclusivePriority(ordered, rTrue), null);
assert('First exclusive rule is priority #1', exclusivePriority(ordered, rExcl1), 1);
assert('Second exclusive rule is priority #2', exclusivePriority(ordered, rExcl2), 2);
assert('Inactive exclusive rule gets no priority', exclusivePriority(ordered, rInact), null);
assert(
  'Priority count skips stacking rules (only 2 exclusives among 4 rules)',
  ordered.filter(r => isRuleExclusive(r.action)).length,
  2,
);

// --- Shared adjustment math: dialog replay must equal engine output ---
console.log('\n-- Shared adjustment math (applyRuleAdjustmentStep) --');
assert('Percentage +10% of 3000 rounds to 3300', applyRuleAdjustmentStep(3000, { adjustmentType: 'percentage', adjustmentValue: 10 }), 3300);
assert('Percentage -5% of 3333 rounds like engine', applyRuleAdjustmentStep(3333, { adjustmentType: 'percentage', adjustmentValue: -5 }), Math.round(3333 * 0.95));
assert('Fixed +150 adds and rounds', applyRuleAdjustmentStep(2999.4, { adjustmentType: 'fixed', adjustmentValue: 150 }), Math.round(2999.4 + 150));
assert('Default type is percentage', applyRuleAdjustmentStep(1000, { adjustmentValue: 10 }), 1100);
assert('Legacy percentage field is honored', applyRuleAdjustmentStep(1000, { percentage: 10 }), 1100);
assert('Unknown adjustment type leaves rate unchanged (engine semantics)', applyRuleAdjustmentStep(1000, { adjustmentType: 'bogus', adjustmentValue: 50 }), 1000);
assert('Missing action leaves rate at +0%', applyRuleAdjustmentStep(1000, undefined), 1000);
assert('getRuleAdjustment default', JSON.stringify(getRuleAdjustment({})), JSON.stringify({ adjustmentType: 'percentage', adjustmentValue: 0 }));

// Simulate the engine's stacking loop with the shared step function and
// verify the dialog's replayRuleChain produces the identical final rate.
console.log('\n-- Dialog replay matches engine chain (replayRuleChain) --');
const chainActions = [
  { adjustmentType: 'percentage', adjustmentValue: 7.5 },
  { adjustmentType: 'fixed', adjustmentValue: -125 },
  { adjustmentType: 'percentage', adjustmentValue: -3 },
  { percentage: 4 }, // legacy shape
];
const streetRate = 4187;
// Engine-style loop (same as applyAdjustmentRulesToUnit)
let engineRate = streetRate;
for (const action of chainActions) engineRate = applyRuleAdjustmentStep(engineRate, action);
// Dialog-style replay
const steps = replayRuleChain(streetRate, chainActions);
assert('Replay produces one step per rule', steps.length, chainActions.length);
assert('Replay final rate equals engine final rate', steps[steps.length - 1].after, engineRate);
assert('Steps chain contiguously (step1.after === step2.before)', steps[1].before, steps[0].after);
assert('Steps chain contiguously (step3.after === step4.before)', steps[3].before, steps[2].after);
assert('Deltas sum to net change', steps.reduce((s, x) => s + x.delta, 0), engineRate - streetRate);
assert('First step starts at street rate', steps[0].before, streetRate);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
