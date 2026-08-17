/**
 * Regression tests for the structured rule payload path.
 *
 * The rule designer's structured tab posts the exact conditions and action the
 * user picked; `buildRuleFromStructured` converts them straight into a
 * ParsedRule so nothing is ever recovered from the display sentence. These
 * tests hold two lines:
 *
 *   1. Every metric/operator/action/scope the designer offers is representable
 *      and lands on the same engine fields and threshold scales the sentence
 *      parser uses (occupancy = 0–1 fractions, variance metrics = raw 0–100).
 *   2. Anything else is REJECTED ({ok:false}) — the server must 400, never
 *      fall back to sentence guessing for a structured submission.
 *
 * Run with: npx tsx tests/structuredRuleBuilder.test.ts
 */
import { buildRuleFromStructured } from '../server/structuredRuleBuilder';
import { parseNaturalLanguageRule, validateParsedRule } from '../server/naturalLanguageParser';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function check(ok: boolean, note: string, detail?: unknown) {
  if (ok) { passed++; console.log(`  ${PASS} ${note}`); }
  else {
    failed++;
    console.log(`  ${FAIL} ${note}`);
    if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
  }
}

const act = (over: Partial<any> = {}) => ({ type: 'decrease_rate', amountType: 'percent', amountValue: '3', scope: 'All selected campuses', ...over });
const cond = (metric: string, over: Partial<any> = {}) => ({ metric, timePeriod: 'Current Month', operator: 'is less than', value: '85', ...over });
const build = (conditions: any[], action: any, op: 'AND' | 'OR' = 'AND') =>
  buildRuleFromStructured({ conditions, conditionOperator: op, action }, 'display sentence');
// Single-condition rules use the singular {condition} shape, multi use {conditions[]} —
// mirroring the sentence parser so downstream evaluators see familiar shapes.
const trigConds = (r: any): any[] => r?.rule?.trigger?.conditions ?? (r?.rule?.trigger?.condition ? [r.rule.trigger.condition] : []);

console.log('\nSupported metrics land on the right engine field & scale:');
{
  const cases: Array<[string, Partial<any>, string, number]> = [
    ['Campus Occupancy', {}, 'occupancy', 0.85],
    ['Campus Occupancy', { timePeriod: 'Trailing 3' }, 'occupancy_trailing3', 0.85],
    ['Campus Occupancy', { timePeriod: 'Trailing 6' }, 'occupancy_trailing6', 0.85],
    ['Campus Occupancy', { timePeriod: 'Trailing 12' }, 'occupancy_trailing12', 0.85],
    ['Service Line Occupancy', {}, 'service_line_occupancy', 0.85],
    ['Room Type Occupancy', { timePeriod: 'Trailing 6' }, 'room_type_occupancy_trailing6', 0.85],
    ['Days Vacant', { operator: 'is greater than', value: '60' }, 'days_vacant', 60],
    ['Street Rate to Top Comp Var %', { value: '10' }, 'street_to_comp_var', 10],
    ['In House to Street Rate var % - Single Occupant', { value: '-5' }, 'ih_street_variance', -5],
    ['Vacant Units/Beds', { operator: 'is greater than', value: '5' }, 'vacant_units', 5],
    ['Total Units/Beds', { operator: 'is greater than', value: '20' }, 'total_units', 20],
    ['Competitor Rate', { value: '10' }, 'competitor_variance', 10],
    ['Inquiry and Tour Volume', { value: '3' }, 'inquiry_volume', 3],
    ['Quality Mix', { value: '40' }, 'quality_mix', 40],
  ];
  for (const [metric, over, field, value] of cases) {
    const r = build([cond(metric, over)], act());
    const c = r.ok ? trigConds(r)[0] : null;
    check(!!r.ok && c.field === field && Math.abs(c.value - value) < 1e-9,
      `${metric}${over.timePeriod ? ` (${over.timePeriod})` : ''} → ${field} = ${value}`, r);
  }
  // Explicit "%" and fraction-scale inputs behave like the sentence parser
  const pct = build([cond('Campus Occupancy', { value: '85%' })], act());
  check(pct.ok && trigConds(pct)[0].value === 0.85, 'explicit "%" respected on fraction metric', pct);
  const frac = build([cond('Campus Occupancy', { value: '0.85' })], act());
  check(frac.ok && trigConds(frac)[0].value === 0.85, 'already-fraction occupancy kept as-is', frac);
  const rawNeg = build([cond('Street Rate to Top Comp Var %', { value: '-12.5' })], act());
  check(rawNeg.ok && trigConds(rawNeg)[0].value === -12.5, 'negative variance threshold survives verbatim', rawNeg);
}

console.log('\nOperators:');
{
  const ops: Array<[string, string]> = [
    ['is less than', '<'], ['is greater than', '>'],
    ['is less than or equal to', '<='], ['is greater than or equal to', '>='],
    ['equals', '='], // engine evaluator accepts '=', '==', '==='
  ];
  for (const [label, sym] of ops) {
    const r = build([cond('Days Vacant', { operator: label, value: '30' })], act());
    check(r.ok && trigConds(r)[0].operator === sym, `"${label}" → ${sym}`, r);
  }
  const between = build([cond('Campus Occupancy', { operator: 'is between', value: '80 and 90' })], act());
  const bc = between.ok ? trigConds(between) : null;
  check(!!between.ok && bc.length === 2 && bc[0].operator === '>=' && bc[0].value === 0.8 && bc[1].operator === '<=' && bc[1].value === 0.9,
    '"is between 80 and 90" → two AND-ed fraction bounds', between);
  const betweenOr = buildRuleFromStructured({
    conditions: [cond('Campus Occupancy', { operator: 'is between', value: '80 and 90' }), cond('Days Vacant', { operator: 'is greater than', value: '30' })],
    conditionOperator: 'OR',
    action: act(),
  }, 'x');
  check(!betweenOr.ok, '"is between" + OR with other conditions rejected (matches parser)', betweenOr);
}

console.log('\nActions & scopes (every designer choice):');
{
  const inc = build([cond('Campus Occupancy')], act({ type: 'increase_rate', amountType: 'percent', amountValue: '5' }));
  check(inc.ok && (inc as any).rule.action.adjustmentType === 'percentage' && (inc as any).rule.action.adjustmentValue === 5, 'increase_rate percent → +5%', inc);
  const dec = build([cond('Campus Occupancy')], act({ type: 'decrease_rate', amountType: 'dollar', amountValue: '100' }));
  check(dec.ok && (dec as any).rule.action.adjustmentType === 'absolute' && (dec as any).rule.action.adjustmentValue === -100, 'decrease_rate dollar → -$100', dec);
  const disc = build([cond('Campus Occupancy')], act({ type: 'apply_discount', amountValue: '4' }));
  check(disc.ok && (disc as any).rule.action.adjustmentValue === -4, 'apply_discount → negative adjustment', disc);

  for (const scope of ['All selected campuses', 'Selected campus', 'Selected service line', 'Selected room type']) {
    const r = build([cond('Campus Occupancy')], act({ scope }));
    check(!!r.ok && !(r as any).rule.action.filters, `scope "${scope}" adds no action filter (carried by explicit pickers)`, r);
  }
  const vac = build([cond('Campus Occupancy')], act({ scope: 'Vacant units only' }));
  check(vac.ok && (vac as any).rule.action.filters?.occupancyStatus === 'vacant', 'scope "Vacant units only" → occupancyStatus filter', vac);
  const vd = build([cond('Campus Occupancy')], act({ scope: 'Vacant units only', vacancyDays: 60 }));
  const vdf = vd.ok ? (vd as any).rule.action.filters : null;
  check(!!vd.ok && vdf.vacancyDuration?.days === 60 && vdf.vacancyDuration?.operator === '>' && vdf.occupancyStatus === 'vacant',
    'vacancyDays passthrough preserved as vacancyDuration filter', vd);
}

console.log('\nRejections (server must 400, never fall back to the sentence):');
{
  check(!build([cond('Season')], act()).ok, 'unknown metric rejected');
  check(!build([cond('Campus Occupancy', { operator: 'contains' })], act()).ok, 'unknown operator rejected');
  check(!build([cond('Campus Occupancy')], act({ type: 'set_rate' })).ok, 'set_rate rejected');
  check(!build([cond('Campus Occupancy')], act({ type: 'cap_rate_increase' })).ok, 'cap rejected');
  check(!build([cond('Campus Occupancy')], act({ scope: 'Units matching room attributes' })).ok, 'unknown scope rejected');
  check(!build([cond('Campus Occupancy', { value: 'abc' })], act()).ok, 'non-numeric threshold rejected');
  check(!build([cond('Campus Occupancy')], act({ amountValue: '0' })).ok, 'zero amount rejected');
  check(!build([], act()).ok, 'no conditions rejected');
  check(!build([cond('Days Vacant', { timePeriod: 'Trailing 3' })], act()).ok, 'trailing window on non-occupancy metric rejected');
  check(!build([cond('Campus Occupancy', { operator: 'does not equal' })], act()).ok, '"does not equal" rejected (no engine != evaluator)');
  check(!build([cond('Campus Occupancy', { operator: 'increases by more than' })], act()).ok, 'change-over-time operator rejected');
  check(!build([cond('Campus Occupancy', { timePeriod: 'Trailing 24' })], act()).ok, 'unknown time period rejected, not coerced to current');
  check(!buildRuleFromStructured({ conditions: [cond('Campus Occupancy'), cond('Days Vacant', { operator: 'is greater than', value: '30' })], conditionOperator: 'XOR' as any, action: act() }, 'x').ok,
    'unknown condition operator rejected, not coerced to AND');
}

console.log('\nParity with the sentence parser on a full round-trip:');
{
  const sentence = 'If campus occupancy is below 85%, decrease rates by 3% for vacant units';
  const parsed = parseNaturalLanguageRule(sentence)!;
  const structured = build([cond('Campus Occupancy', { operator: 'is less than', value: '85' })], act({ scope: 'Vacant units only' }));
  const pc = (parsed.trigger as any).condition ?? (parsed.trigger as any).conditions?.[0];
  const sc = trigConds(structured)[0];
  check(structured.ok && pc.field === sc.field && pc.operator === sc.operator && pc.value === sc.value,
    'trigger identical to sentence-parsed equivalent', { pc, sc });
  check(structured.ok && parsed.action.adjustmentValue === (structured as any).rule.action.adjustmentValue
    && parsed.action.filters?.occupancyStatus === (structured as any).rule.action.filters?.occupancyStatus,
    'action identical to sentence-parsed equivalent');
  const v = validateParsedRule((structured as any).rule);
  check(v.isValid, 'built rule passes validateParsedRule', v);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
