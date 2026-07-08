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
import { isRuleAdditive, isRuleExclusive, exclusivePriority } from '../shared/ruleStacking';

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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
