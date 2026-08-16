/**
 * Regression tests for the pricing-rule enforceability guard.
 *
 * Background: `parseTrigger` returns `{ type: 'immediate' }` as its fallback
 * whenever it cannot map a clause onto a supported metric, and
 * `validateParsedRule` accepts that. The failure is silent and severe — a rule
 * described as "increase 5% ... where the T12 growth is negative" was stored
 * with NO trigger and repriced 12,551 units instead of roughly 1,000.
 *
 * `checkRuleEnforceable` compares what a sentence PROMISES against what the
 * parser actually captured so every rule-creation path can refuse the rule.
 *
 * The two risks these tests hold the line on:
 *   1. FALSE NEGATIVES — an unenforceable condition slipping through and
 *      silently becoming a blanket rule.
 *   2. FALSE POSITIVES — the guard rejecting rules users legitimately write.
 *      This is the more damaging failure, since campuses have names like
 *      "Overlook Ridge" that contain comparison words.
 *
 * Run with: npx tsx tests/ruleEnforceability.test.ts
 */
import { parseNaturalLanguageRule, checkRuleEnforceable } from '../server/naturalLanguageParser';
import { conditionValueIssue } from '../shared/ruleThresholdScales';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0;
let failed = 0;

function expectEnforceable(shouldAllow: boolean, sentence: string, note: string) {
  const parsed = parseNaturalLanguageRule(sentence);
  const result = checkRuleEnforceable(sentence, parsed);
  if (result.ok === shouldAllow) {
    passed++;
    console.log(`  ${PASS} [${shouldAllow ? 'allow' : 'reject'}] ${note}`);
  } else {
    failed++;
    console.log(`  ${FAIL} [${shouldAllow ? 'allow' : 'reject'}] ${note}`);
    console.log(`      sentence: ${sentence}`);
    console.log(`      got ok=${result.ok}${result.reason ? ` reason="${result.reason}"` : ''}`);
    console.log(`      trigger=${JSON.stringify(parsed?.trigger)}`);
    console.log(`      filters=${JSON.stringify(parsed?.action?.filters)}`);
  }
}

console.log('\nLegitimate rules must NOT be rejected');
expectEnforceable(true, 'Increase street rate by 5% for Studio Dlx, Companion, Studio units',
  'unconditional but properly targeted');
expectEnforceable(true, 'If service line occupancy is greater than or equal to 92 AND room type occupancy is less than 85, decrease street rate by 4% for vacant Studio units',
  'compound clause, both conditions parse');
expectEnforceable(true, 'Increase street rate by 5% when in-house to street variance is greater than 10%',
  'single supported condition');
expectEnforceable(true, 'Decrease street rate by 8% for vacant One Bedroom units over 60 days',
  'vacancy duration enforced via action filter');
expectEnforceable(true, 'Increase street rate by 3% for occupied Two Bedroom units',
  'occupancy status filter');
expectEnforceable(true, 'If room type occupancy is between 80 and 90, increase street rate by 5%',
  'between range expands to two bounds');
expectEnforceable(true, 'Increase street rate by 2% for Studio units at Overlook Ridge',
  'campus proper noun containing a comparison word');
expectEnforceable(true, 'Decrease street rate by 5% for Companion units when days vacant is greater than 45',
  'days vacant stated as a comparison');
expectEnforceable(true, 'If days vacant is between 30 and 90, decrease street rate by 5%',
  'days vacant between range via if-form');

console.log('\nUnenforceable rules must be rejected');
expectEnforceable(false, 'Increase street rate by 5% for Companion, Studio units where the T12 growth is negative',
  'T12 growth — the original incident');
expectEnforceable(false, 'Increase street rate by 5% for Studio units when trailing 12 month revenue growth is negative',
  'revenue growth is not a supported metric');
expectEnforceable(false, 'Increase street rate by 5% for Studio units when room type occupancy is high',
  'supported metric but no numeric threshold');
expectEnforceable(false, 'Increase street rate by 5% for Studio units if room type occupancy is above 90 AND the T12 growth is negative',
  'compound clause where one side silently drops');
expectEnforceable(false, 'Increase street rate by 5% monthly when T12 growth is negative',
  'time trigger must not mask a dropped condition');
expectEnforceable(false, 'Increase street rate by 4% when a unit becomes vacant if year over year change is below -2',
  'event trigger must not mask a dropped condition');
expectEnforceable(false, 'Increase street rate by 5% when room type occupancy is between 80 and 90',
  'between is only supported in the "If <clause>, <action>" form');
expectEnforceable(false, 'Increase street rate by 5% when occupancy is above 90 where T12 growth is negative',
  'second gate introducer must not hide a dropped condition');
expectEnforceable(false, 'Increase street rate by 5% when days vacant is high and T12 growth is below -2',
  'days vacant must not adopt an unrelated clause number');
expectEnforceable(false, 'Increase street rate by 5% when days vacant is high and competitor variance is above 10',
  'days vacant must not adopt a neighbouring metric threshold');

console.log('\nVacancy duration must not steal a number from another clause');
// Every clause-boundary word must stop the match, not just "and"/"or". The
// vacancy regex and the guard share one vocabulary so these cannot drift.
for (const [sentence, label] of [
  ['Increase street rate by 5% for vacant Studio units and occupied units over 60 days are excluded', 'and'],
  ['Increase street rate by 5% for vacant units while units over 60 days are reviewed', 'while'],
  ['Increase street rate by 5% for vacant units whenever units over 60 days are reviewed', 'whenever'],
  ['Increase street rate by 5% for vacant units provided that units over 60 days are reviewed', 'provided that'],
] as [string, string][]) {
  const parsed = parseNaturalLanguageRule(sentence);
  const stolen = parsed?.action?.filters?.vacancyDuration;
  if (!stolen) {
    passed++;
    console.log(`  ${PASS} "${label}" boundary blocks cross-clause vacancyDuration capture`);
  } else {
    failed++;
    console.log(`  ${FAIL} "${label}" boundary crossed: ${JSON.stringify(stolen)}`);
  }
}
for (const [sentence, label] of [
  // The AI prompt's own canonical phrasing — a room type sits between the
  // vacancy keyword and "units", which previously dropped the day threshold.
  ['Decrease street rate by 8% for vacant One Bedroom units over 60 days', 'room type between vacancy keyword and "units"'],
  // Service-line labels contain slashes; the bounded gap must still allow them.
  ['Decrease street rate by 8% for vacant AL/MC Studio units over 60 days', 'slash-containing service line label'],
] as [string, string][]) {
  const parsed = parseNaturalLanguageRule(sentence);
  const vd = parsed?.action?.filters?.vacancyDuration;
  if (vd && vd.days === 60) {
    passed++;
    console.log(`  ${PASS} ${label} still captures 60 days`);
  } else {
    failed++;
    console.log(`  ${FAIL} ${label}: expected 60-day vacancyDuration, got ${JSON.stringify(vd)}`);
  }
}

// ── Threshold scale and sign ────────────────────────────────────────────────
// The description is re-parsed server-side, so the number the engine stores is
// inferred, not given. These pin the inference so "%" and "-" cannot be misread.

console.log('\nAn explicit "%" declares the scale');
const condValue = (sentence: string): number | undefined => {
  const p = parseNaturalLanguageRule(sentence);
  const t: any = p?.trigger;
  if (t?.type !== 'condition') return undefined;
  return (t.conditions ?? [t.condition])[0]?.value;
};
for (const [sentence, expected, label] of [
  ['Increase street rate by 5% when occupancy is above 85%', 0.85, '"85%" -> 0.85'],
  ['Increase street rate by 5% when occupancy is above 85', 0.85, 'bare "85" -> 0.85 via magnitude'],
  ['Increase street rate by 5% when occupancy is above 0.85', 0.85, 'bare "0.85" reads as a fraction'],
  // The regression: the "%" used to be discarded, so this became 85%.
  ['Increase street rate by 5% when occupancy is above 0.85%', 0.0085, '"0.85%" -> 0.0085, not 0.85'],
  ['Increase street rate by 5% when in-house to street variance is greater than 10%', 10, 'raw-scale metric keeps 10'],
] as [string, number, string][]) {
  const got = condValue(sentence);
  if (got === expected) {
    passed++;
    console.log(`  ${PASS} ${label}`);
  } else {
    failed++;
    console.log(`  ${FAIL} ${label}: expected ${expected}, got ${got}`);
  }
}

console.log('\nThresholds the engine would silently rescale must be refused');
// ih_street_variance is on the 0–100 scale, but the evaluators treat any value
// of 1 or less as a legacy fraction and multiply it by 100.
expectEnforceable(false, 'Increase street rate by 5% when in-house to street variance is greater than 0.5',
  'sub-1 raw-pct threshold would become 50%');
expectEnforceable(false, 'Increase street rate by 5% when in-house to street variance is greater than 1',
  'threshold of exactly 1 would become 100%');
expectEnforceable(false, 'Increase street rate by 5% when in-house to street variance is less than -0.5',
  'negative sub-1 threshold would become -50%');
expectEnforceable(true, 'Increase street rate by 5% when in-house to street variance is greater than 10',
  'raw-pct threshold on the 0-100 scale is fine');
expectEnforceable(true, 'Increase street rate by 5% when in-house to street variance is less than -5',
  'negative raw-pct threshold on the 0-100 scale is fine');

console.log('\nAdjustment sign must never be flipped or guessed');
{
  // The minus used to be dropped entirely, turning a cut into a rise.
  const p = parseNaturalLanguageRule('Adjust street rate by -5% for Studio units');
  if (p?.action?.adjustmentValue === -5) {
    passed++;
    console.log(`  ${PASS} neutral "adjust by -5%" keeps the minus`);
  } else {
    failed++;
    console.log(`  ${FAIL} expected -5, got ${p?.action?.adjustmentValue}`);
  }
}
expectEnforceable(false, 'Increase street rate by -5% for Studio units',
  'direction verb contradicting a negative amount');
expectEnforceable(false, 'Decrease street rate by -5% for Studio units',
  'double negative is ambiguous');
expectEnforceable(true, 'Decrease street rate by 5% for Studio units',
  'positive amount with a direction verb');

// ── Designer-side threshold validation ──────────────────────────────────────
console.log('\nDesigner blocks values the server would misread');
const vcase = (metric: string, value: string, shouldBlock: boolean, label: string) => {
  const issue = conditionValueIssue(metric, value);
  if (!!issue === shouldBlock) {
    passed++;
    console.log(`  ${PASS} ${label}`);
  } else {
    failed++;
    console.log(`  ${FAIL} ${label}: expected ${shouldBlock ? 'block' : 'allow'}, issue=${issue}`);
  }
};
vcase('Room Type Occupancy', '85', false, 'occupancy "85" accepted');
vcase('Room Type Occupancy', '85%', false, 'occupancy "85%" accepted');
vcase('Room Type Occupancy', '0.85', true, 'bare sub-1 occupancy is ambiguous');
vcase('Room Type Occupancy', '0.85%', false, 'explicit "0.85%" is unambiguous');
vcase('Room Type Occupancy', '150', true, 'occupancy above 100 rejected');
vcase('Quality Mix', '120', true, 'quality mix above 100 rejected');
// Variances are percentage-POINT deltas and legitimately exceed ±100.
vcase('Street Rate to Top Comp Var %', '125', false, 'variance above 100 allowed');
vcase('Street Rate to Top Comp Var %', '-140', false, 'variance below -100 allowed');
vcase('Competitor Rate', '110', false, 'competitor variance above 100 allowed');
vcase('In House to Street Rate var % - Single Occupant', '0.5', true, 'IH sub-1 refused: evaluator rescales it');
vcase('In House to Street Rate var % - Single Occupant', '0.5%', true, 'IH sub-1 refused even with explicit %');
vcase('In House to Street Rate var % - Single Occupant', '10', false, 'IH "10" accepted');
vcase('In House to Street Rate var % - Single Occupant', '-125', false, 'IH large negative variance allowed');
vcase('Days Vacant', '45', false, 'non-percentage metric unconstrained');
vcase('Room Type Occupancy', 'abc', true, 'non-numeric rejected');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
