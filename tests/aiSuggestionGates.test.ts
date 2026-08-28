/**
 * Every AI-drafted rule that never reaches the operator must be attributed to a
 * reason.
 *
 * The suggestion endpoint asks Opus for up to 10 rules and runs each through a
 * gauntlet of gates. Those gates used to be bare `continue`s, so a run where
 * seven of ten candidates were rejected showed three cards and no trace of the
 * rest — indistinguishable from a scope where the AI genuinely had little to
 * say.
 *
 * That distinction matters because of a failure mode this codebase has already
 * been bitten by: the prompt teaches the model an exact phrasing and the parser
 * must accept exactly that phrasing. When the two drift apart the ONLY symptom
 * is fewer suggestions. These assertions pin each rejection to the gate that
 * actually fired, so a future prompt or parser change that starts shredding
 * candidates fails here instead of quietly halving the output.
 *
 * Drives the real exported gate logic — a test that re-implements the gates
 * would guard nothing. Pure logic: no server and no database required.
 *
 * Run with: npx tsx tests/aiSuggestionGates.test.ts
 */
import {
  evaluateSuggestionCandidate,
  partitionCandidates,
  MAX_SUGGESTIONS_PER_RUN,
  summarizeRejections,
  describeDiagnostics,
  EMPTY_RUN_MESSAGES,
  REJECTION_LABELS,
  suggestionImpactRejection,
  OVER_CAP_CODE,
  type SuggestionRejection,
  type SuggestionRejectionCode,
  type EmptyRunReason,
} from '../server/services/suggestionGates';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function ok(desc: string, cond: boolean, detail = '') {
  if (cond) { console.log(`${PASS} ${desc}`); passed++; }
  else { console.log(`${FAIL} ${desc}${detail ? `\n    ${detail}` : ''}`); failed++; }
}

const SLS = ['AL', 'AL/MC', 'HC'];
const STREET_ONLY = { validServiceLines: SLS, includeInHouse: false };
const WITH_IN_HOUSE = { validServiceLines: SLS, includeInHouse: true };

/** Assert a candidate is rejected, and rejected for the expected reason. */
function expectRejected(
  desc: string,
  candidate: any,
  expected: SuggestionRejectionCode,
  opts = STREET_ONLY,
) {
  const outcome = evaluateSuggestionCandidate(candidate, opts);
  if (outcome.ok) {
    ok(desc, false, `expected rejection "${expected}", but the candidate was accepted`);
    return;
  }
  ok(desc, outcome.code === expected,
    `expected "${expected}", got "${outcome.code}" — ${outcome.detail}`);
}

/**
 * Assert a candidate is rejected for one of several acceptable reasons. Used
 * where the invariant is "this must never become a rule, and it must count as a
 * grammar failure" rather than which of the grammar gates happens to fire
 * first — the parser may legitimately refuse a sentence outright instead of
 * parsing it and failing enforceability.
 */
function expectRejectedAmong(
  desc: string,
  candidate: any,
  expected: SuggestionRejectionCode[],
  opts = STREET_ONLY,
) {
  const outcome = evaluateSuggestionCandidate(candidate, opts);
  if (outcome.ok) {
    ok(desc, false, `expected one of ${expected.join(' / ')}, but the candidate was accepted`);
    return;
  }
  ok(desc, expected.includes(outcome.code),
    `expected one of ${expected.join(' / ')}, got "${outcome.code}" — ${outcome.detail}`);
}

function expectAccepted(desc: string, candidate: any, opts = STREET_ONLY) {
  const outcome = evaluateSuggestionCandidate(candidate, opts);
  ok(desc, outcome.ok,
    outcome.ok ? '' : `rejected as "${outcome.code}" — ${outcome.detail}`);
  return outcome;
}

console.log('\n=== Gate attribution: each bad candidate blames the right gate ===\n');

// ── A candidate with nothing to parse ──────────────────────────────────────
expectRejected('empty object → empty_sentence', {}, 'empty_sentence');
expectRejected('blank rule string → empty_sentence', { rule: '   ' }, 'empty_sentence');

// ── Text the parser cannot read as a pricing rule at all ───────────────────
expectRejected(
  'prose with no action → unparseable',
  { rule: 'Consider whether the market supports a change this quarter.' },
  'unparseable',
);

// ── A gate the engine has no metric for. This is the drift signature: the
//    sentence announces a threshold, the parser maps nothing, and the rule
//    would silently become a blanket repricing.
expectRejectedAmong(
  'forbidden metric in the condition is refused on grammar grounds',
  { rule: 'If T12 revenue growth is less than 3, increase street rate by 5% for vacant Studio units' },
  ['unparseable', 'unenforceable'],
);
expectRejected(
  'compound clause that under-parses → unenforceable',
  { rule: 'If service line occupancy is greater than 90 AND resident length of stay is above 18, increase street rate by 4% for vacant units' },
  'unenforceable',
);

// ── Parsed, but not a valid rule ───────────────────────────────────────────
expectRejected(
  'impossible percentage → invalid_rule',
  { rule: 'Increase street rate by 150% for vacant Studio units' },
  'invalid_rule',
);

// ── No condition and no targeting: a blanket change ────────────────────────
expectRejected(
  'unconditional untargeted change → blanket_rule',
  { rule: 'Increase street rate by 5%' },
  'blanket_rule',
);

// ── Target policy ──────────────────────────────────────────────────────────
expectRejected(
  'in-house rule when in-house was not requested → unsupported_target',
  { rule: 'Increase in-house rate by 3% for occupied units' },
  'unsupported_target',
);
expectRejected(
  'in-house DECREASE even when in-house was requested → unsupported_target',
  { rule: 'Decrease in-house rate by 3% for occupied units' },
  'unsupported_target',
  WITH_IN_HOUSE,
);

console.log('\n=== Good candidates still pass ===\n');

expectAccepted(
  'targeted street-rate rule with a condition',
  { rule: 'If service line occupancy is greater than or equal to 92, increase street rate by 5% for vacant Studio units' },
);
expectAccepted(
  'street-rate rule targeted by vacancy duration only',
  { rule: 'Decrease street rate by 8% for vacant One Bedroom units over 60 days' },
);
expectAccepted(
  'in-house increase once the caller opts in',
  { rule: 'Increase in-house rate by 3% for occupied units' },
  WITH_IN_HOUSE,
);

console.log('\n=== Final impact gate: zero-value cards never reach the operator ===\n');

ok(
  'zero qualified units are rejected',
  suggestionImpactRejection({ unitsImpacted: 0, monthlyImpact: 50, annualImpact: 3900 }) === 'zero_qualified_units',
);
ok(
  'positive units with zero monthly impact are rejected',
  suggestionImpactRejection({ unitsImpacted: 3, monthlyImpact: 0, annualImpact: 100 }) === 'zero_financial_impact',
);
ok(
  'positive units with zero annual impact are rejected',
  suggestionImpactRejection({ unitsImpacted: 3, monthlyImpact: 10, annualImpact: 0 }) === 'zero_financial_impact',
);
ok(
  'negative financial impact remains actionable',
  suggestionImpactRejection({ unitsImpacted: 3, monthlyImpact: -10, annualImpact: -780 }) === null,
);

console.log('\n=== Service-line resolution ===\n');

{
  const outcome = expectAccepted('known service lines are kept', {
    rule: 'Increase street rate by 5% for vacant Studio units',
    serviceLines: ['AL', 'HC'],
  });
  if (outcome.ok) {
    ok('both requested service lines survive',
      outcome.serviceLines.join(',') === 'AL,HC', outcome.serviceLines.join(','));
  }
}
{
  const outcome = expectAccepted('unknown service lines fall back to the first valid one', {
    rule: 'Increase street rate by 5% for vacant Studio units',
    serviceLines: ['VIL'],
  });
  if (outcome.ok) {
    ok('falls back to the first valid service line',
      outcome.serviceLines.join(',') === 'AL', outcome.serviceLines.join(','));
  }
}
{
  // A rejection still has to say which service line it was drafted for, or the
  // tally cannot tell the operator where the AI was struggling.
  const outcome = evaluateSuggestionCandidate(
    { rule: 'Increase street rate by 5%', serviceLines: ['HC'] }, STREET_ONLY);
  ok('a rejected candidate still reports its service line',
    !outcome.ok && outcome.serviceLines.join(',') === 'HC',
    outcome.ok ? 'accepted' : outcome.serviceLines.join(','));
}

console.log('\n=== Tally: counts, ordering, and the 10-rule cap ===\n');

function rejection(code: SuggestionRejectionCode, sentence: string): SuggestionRejection {
  return { code, detail: 'test', sentence, serviceLines: ['AL'] };
}

{
  const rejections = [
    rejection('unenforceable', 'rule one'),
    rejection('unenforceable', 'rule two'),
    rejection('unenforceable', 'rule three'),
    rejection('blanket_rule', 'rule four'),
  ];
  const d = summarizeRejections(rejections, 10, 6);
  ok('drafted is what the model returned', d.drafted === 10, String(d.drafted));
  ok('shown is what survived', d.shown === 6, String(d.shown));
  ok('dropped counts every genuine rejection', d.dropped === 4, String(d.dropped));
  ok('reasons are grouped', d.byReason.length === 2, JSON.stringify(d.byReason.map(r => r.code)));
  ok('the biggest reason sorts first', d.byReason[0].code === 'unenforceable', d.byReason[0].code);
  ok('grouped count is right', d.byReason[0].count === 3, String(d.byReason[0].count));
  ok('examples are capped at three', d.byReason[0].examples.length === 3,
    String(d.byReason[0].examples.length));
  ok('reason carries an operator-facing label',
    d.byReason[0].label === REJECTION_LABELS.unenforceable, d.byReason[0].label);
}

{
  // Surplus beyond the cap is not a failure — the model was asked for at most
  // 10 and returned more. Counting it as "could not be used" would tell the
  // operator something false.
  const rejections = [
    rejection(OVER_CAP_CODE, 'surplus one'),
    rejection(OVER_CAP_CODE, 'surplus two'),
    rejection('blanket_rule', 'genuinely bad'),
  ];
  const d = summarizeRejections(rejections, 13, 10);
  ok('over-cap surplus is not counted as dropped', d.dropped === 1, String(d.dropped));
  ok('over-cap surplus is reported separately', d.overCap === 2, String(d.overCap));
}

{
  const d = summarizeRejections([], 4, 4);
  ok('a clean run reports nothing dropped', d.dropped === 0, String(d.dropped));
  ok('a clean run has no summary line', describeDiagnostics(d) === null, String(describeDiagnostics(d)));
  ok('a clean run raises no drift warning', d.driftWarning === null, String(d.driftWarning));
}

{
  const d = summarizeRejections([rejection('blanket_rule', 'x')], 5, 4);
  const summary = describeDiagnostics(d);
  ok('summary states shown, drafted and dropped',
    !!summary && summary.includes('4') && summary.includes('5') && summary.includes('1'),
    String(summary));
}

console.log('\n=== The 10-rule cap is applied before the gates ===\n');

const GOOD = 'Increase street rate by 5% for vacant Studio units';
const BAD = 'Increase street rate by 5%'; // blanket: no condition, no targeting

{
  // The run filled every card, then the model's 11th draft was malformed.
  // Blaming a gate for it would inflate "could not be used" — and a run of
  // junk after the cap could tip the drift heuristic on a perfectly healthy
  // run. A draft past the limit was never considered at all.
  const candidates = [
    ...Array.from({ length: MAX_SUGGESTIONS_PER_RUN }, () => ({ rule: GOOD })),
    { rule: BAD },
    { rule: 'not a rule at all' },
    {},
  ];
  const { accepted, rejections } = partitionCandidates(candidates, STREET_ONLY);
  ok('the cap is honoured', accepted.length === MAX_SUGGESTIONS_PER_RUN, String(accepted.length));
  ok('every post-cap draft is surplus, whatever its quality',
    rejections.length === 3 && rejections.every(r => r.code === OVER_CAP_CODE),
    JSON.stringify(rejections.map(r => r.code)));

  const d = summarizeRejections(rejections, candidates.length, accepted.length);
  ok('a full run reports nothing dropped', d.dropped === 0, String(d.dropped));
  ok('the surplus is reported as over-cap', d.overCap === 3, String(d.overCap));
  ok('post-cap junk cannot trigger a drift warning', d.driftWarning === null,
    String(d.driftWarning));
}
{
  // Below the cap, bad drafts are still blamed on the gate that caught them.
  const candidates = [{ rule: GOOD }, { rule: BAD }, { rule: GOOD }, { rule: 'nonsense prose here' }];
  const { accepted, rejections } = partitionCandidates(candidates, STREET_ONLY);
  ok('good drafts below the cap are accepted', accepted.length === 2, String(accepted.length));
  ok('bad drafts below the cap keep their real reason',
    rejections.map(r => r.code).sort().join(',') === 'blanket_rule,unparseable',
    JSON.stringify(rejections.map(r => r.code)));
  ok('an accepted candidate carries its raw model entry through',
    accepted.every(a => a.candidate && a.parsed && a.sentence === GOOD));

  const d = summarizeRejections(rejections, candidates.length, accepted.length);
  ok('the partitioned tally adds up',
    d.shown + d.dropped + d.overCap === d.drafted,
    `${d.shown} + ${d.dropped} + ${d.overCap} != ${d.drafted}`);
}
{
  const { accepted, rejections } = partitionCandidates([], STREET_ONLY);
  ok('an empty candidate list partitions cleanly',
    accepted.length === 0 && rejections.length === 0);
}

console.log('\n=== Prompt/parser drift detection ===\n');

{
  // Half the run failing on grammar is the signature of the prompt teaching a
  // phrasing the parser no longer accepts.
  const rejections = Array.from({ length: 5 }, (_, i) => rejection('unenforceable', `rule ${i}`));
  const d = summarizeRejections(rejections, 10, 5);
  ok('a burst of grammar failures raises a drift warning', d.driftWarning !== null,
    String(d.driftWarning));
}
{
  // Business-policy rejections are not drift. The parser understood these
  // perfectly; the run simply did not allow them.
  const rejections = Array.from({ length: 6 }, (_, i) => rejection('unsupported_target', `rule ${i}`));
  const d = summarizeRejections(rejections, 10, 4);
  ok('policy rejections alone do NOT raise a drift warning', d.driftWarning === null,
    String(d.driftWarning));
}
{
  // One bad draft in a tiny run is noise, not a signal.
  const d = summarizeRejections([rejection('unparseable', 'x')], 2, 1);
  ok('a single failure in a small run does not cry wolf', d.driftWarning === null,
    String(d.driftWarning));
}
{
  // A model drafting 150% increases is a prompt-CONTENT problem: the parser
  // read every one of them perfectly. Blaming grammar drift would send the
  // next engineer looking for a mismatch that isn't there.
  const rejections = Array.from({ length: 5 }, (_, i) => rejection('invalid_rule', `rule ${i}`));
  const d = summarizeRejections(rejections, 10, 5);
  ok('policy-invalid rules do NOT raise a drift warning', d.driftWarning === null,
    String(d.driftWarning));
  ok('...but they are still reported as dropped', d.dropped === 5, String(d.dropped));
}
{
  // The tally is the operator's whole picture of the run; it has to add up.
  const rejections = [
    rejection('unparseable', 'a'),
    rejection('blanket_rule', 'b'),
    rejection(OVER_CAP_CODE, 'c'),
  ];
  const d = summarizeRejections(rejections, 13, 10);
  ok('shown + dropped + overCap accounts for every drafted rule',
    d.shown + d.dropped + d.overCap === d.drafted,
    `${d.shown} + ${d.dropped} + ${d.overCap} != ${d.drafted}`);
}

console.log('\n=== Malformed model output degrades safely ===\n');

// The model returns free-form JSON. A malformed field must produce an
// attributed rejection or a conservative fallback — never a coerced value that
// silently matches something, and never an exception that takes down the run.
expectRejected(
  'a non-string rule field → empty_sentence, not a crash',
  { rule: 42 },
  'empty_sentence',
);
expectRejected(
  'a null rule with a null description → empty_sentence',
  { rule: null, description: null },
  'empty_sentence',
);
{
  const outcome = evaluateSuggestionCandidate(
    // A nested array where a string belongs must NOT be coerced into a match.
    { rule: 'Increase street rate by 5% for vacant Studio units', serviceLine: ['HC'] },
    STREET_ONLY,
  );
  ok('a malformed service line falls back instead of being coerced into a match',
    outcome.ok && outcome.serviceLines.join(',') === 'AL',
    outcome.ok ? outcome.serviceLines.join(',') : `rejected as ${outcome.code}`);
}
{
  const outcome = evaluateSuggestionCandidate(
    { rule: 'Increase street rate by 5% for vacant Studio units', serviceLines: ['AL', 7, null] as any },
    STREET_ONLY,
  );
  ok('non-string entries in serviceLines are ignored, valid ones kept',
    outcome.ok && outcome.serviceLines.join(',') === 'AL',
    outcome.ok ? outcome.serviceLines.join(',') : `rejected as ${outcome.code}`);
}
{
  const outcome = evaluateSuggestionCandidate(
    { rule: 'Increase street rate by 5% for vacant Studio units' },
    { validServiceLines: [], includeInHouse: false },
  );
  ok('a run with no valid service lines yields an empty list, not a crash',
    outcome.ok && outcome.serviceLines.length === 0,
    outcome.ok ? outcome.serviceLines.join(',') : `rejected as ${outcome.code}`);
}

console.log('\n=== Empty-run reasons are distinct and actionable ===\n');

{
  const reasons: EmptyRunReason[] = [
    'no_campuses_match_filters',
    'no_rent_roll_data',
    'no_units_in_scope',
    'model_returned_none',
    'all_candidates_rejected',
  ];
  for (const r of reasons) {
    ok(`"${r}" has operator-facing copy`,
      typeof EMPTY_RUN_MESSAGES[r] === 'string' && EMPTY_RUN_MESSAGES[r].length > 20);
  }
  const messages = reasons.map(r => EMPTY_RUN_MESSAGES[r]);
  ok('every empty-run cause says something different',
    new Set(messages).size === reasons.length, `${new Set(messages).size} distinct of ${reasons.length}`);
  ok('a rent-roll-less client is not told to change filters',
    !/filter/i.test(EMPTY_RUN_MESSAGES.no_rent_roll_data), EMPTY_RUN_MESSAGES.no_rent_roll_data);
  ok('an all-rejected run points at the prompt, not the data',
    /prompt/i.test(EMPTY_RUN_MESSAGES.all_candidates_rejected),
    EMPTY_RUN_MESSAGES.all_candidates_rejected);
}

console.log('\n=== Every rejection code has a label ===\n');
{
  const codes: SuggestionRejectionCode[] = [
    'empty_sentence', 'unparseable', 'invalid_rule',
    'unenforceable', 'blanket_rule', 'unsupported_target', 'over_cap',
  ];
  for (const c of codes) {
    ok(`"${c}" has a plain-language label`,
      typeof REJECTION_LABELS[c] === 'string' && REJECTION_LABELS[c].length > 0);
  }
  ok('no label leaks a function name',
    !codes.some(c => /parse|validate|checkRule|null/i.test(REJECTION_LABELS[c])));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
