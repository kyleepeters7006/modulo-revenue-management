/**
 * Regression tests: a competitor that charges $0 separately for Level-2 care
 * must produce a real care adjustment, not "no data".
 *
 * Background
 * ----------
 * Several HC competitors bundle care into their daily room rate. The survey
 * records that as `care_level_2_rate = 0`, which is a *surveyed* fact: the same
 * rows carry real street rates, and the whole zero-care era of the survey
 * (every month from 2025-12 onward) coexists with positive values from other
 * competitors in the same month. Brooke Knoll Village is the canonical case —
 * $389/day, $0 care — and against our $33/day HC care the correct adjustment is
 * −$33, because a resident who needs Level-2 care pays them $389 and us $389+33.
 *
 * Two separate gates had to allow that zero through, and only the first one
 * did:
 *
 *   1. the missing-data check (`rate <= 0` → null, since relaxed to `rate < 0`)
 *   2. the HC plausibility band, which rejects anything under $5/day
 *
 * Gate 2 caught the zero straight after gate 1 let it past, so the adjustment
 * still came back null and the competitor still displayed as if their care
 * pricing were unknown. `rate === 0` now short-circuits both: zero is
 * basis-independent ($0/day and $0/month are the same charge), so the band —
 * which exists to decide daily-vs-monthly and reject import noise — has nothing
 * to say about it.
 *
 * The risk this guards on the other side is over-reading zero. A zero must NOT
 * be manufactured where the survey simply has no value: `null` care has to stay
 * null all the way to the UI, because "they charge nothing extra" and "we don't
 * know what they charge" imply opposite pricing decisions.
 *
 * These tests call the production helpers — `computeCompetitorCareAdj` (the
 * function the /api/competitors endpoint itself uses for both its service-line
 * breakdown and its per-room-type rows) and the compBenchmark aggregation that
 * feeds the Competitive Position scatter. Nothing here re-implements the
 * comparison, so a regression in either path fails this file.
 *
 * Run with: npx tsx tests/hcZeroCareAdjustment.test.ts
 */

import {
  computeCompetitorCareAdj,
  normalizeCompetitorCareRate,
  normalizeCompetitorCareRateMonthly,
  DAYS_PER_MONTH,
} from '../shared/careRates';
import {
  aggregateSurveyRows,
  normalizeBaseRate,
  StudioCompBenchmark,
  type SurveyRow,
  type CompBenchmarkEntry,
} from '../server/services/compBenchmark';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0;
let failed = 0;

function assert(description: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertClose(description: string, actual: number | null | undefined, expected: number) {
  if (actual != null && Math.abs(actual - expected) < 0.01) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ~${expected}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

/** Our own care schedule for a campus: HC is $33/day, AL is $570/month. */
const ourCare = new Map<string, number>([
  ['HC', 33],
  ['AL', 570],
]);

// ---------------------------------------------------------------------------
// Section 1 — the three competitor states, on the HC (daily) line
//
// The distinction under test is null vs 0 vs equal. All three are legitimate
// survey states and each must reach the UI as a different value.
// ---------------------------------------------------------------------------
console.log('\n=== 1. careAdj for zero / missing / matching competitor care (HC) ===\n');

// (1) Brooke Knoll: care bundled into the room rate.
const zeroCare = computeCompetitorCareAdj(0, ourCare, 'HC');
assertClose('$0 competitor care yields careAdj = −33 (our full care rate)', zeroCare.careAdj, -33);
assert('$0 competitor care is reported as 0, not null', zeroCare.theirCare, 0);
assert('our side of a $0 comparison is still $33/day', zeroCare.ourCare, 33);

// (2) No survey value at all. Null must survive to the UI: showing −33 here
// would assert that an unsurveyed competitor bundles care, which is a guess.
const noCare = computeCompetitorCareAdj(null, ourCare, 'HC');
assert('null competitor care yields careAdj = null', noCare.careAdj, null);
assert('null competitor care is not coerced to 0', noCare.theirCare, null);
assert('undefined competitor care yields careAdj = null', computeCompetitorCareAdj(undefined, ourCare, 'HC').careAdj, null);

// (3) Same care rate as ours — a real comparison whose answer happens to be 0.
// This is the value a broken implementation also returns for cases (1) and (2),
// which is why all three are asserted together.
const sameCare = computeCompetitorCareAdj(33, ourCare, 'HC');
assert('matching $33/day competitor care yields careAdj = 0', sameCare.careAdj, 0);
assert('matching competitor care is reported as 33', sameCare.theirCare, 33);

// The three states must be mutually distinguishable, not merely individually
// correct: null-vs-0 collapse is the exact failure this file exists to catch.
assert('the three states produce three distinct careAdj values',
  new Set([String(zeroCare.careAdj), String(noCare.careAdj), String(sameCare.careAdj)]).size, 3);

// A competitor charging more than us still differences normally — the zero
// short-circuit must not have disturbed the ordinary path.
assertClose('a $45/day competitor yields careAdj = +12', computeCompetitorCareAdj(45, ourCare, 'HC').careAdj, 12);

// ---------------------------------------------------------------------------
// Section 2 — zero must not be re-read as a monthly figure, and the
// plausibility band must still reject genuine junk
//
// The band exists because the HC care column mixes daily and monthly values
// (2, 8, 31, 33, 100, 200, 1050 all appear in one survey month). Exempting
// zero must not exempt anything else.
// ---------------------------------------------------------------------------
console.log('\n=== 2. the zero exemption is exactly one value wide ===\n');

assert('HC $0 passes the plausibility band', normalizeCompetitorCareRate(0, 'HC'), 0);
assert('HC $0 stays $0 when expressed monthly', normalizeCompetitorCareRateMonthly(0, 'HC'), 0);
assert('HC $2 is still rejected as import noise', normalizeCompetitorCareRate(2, 'HC'), null);
assert('HC $100 is still rejected as credible on neither basis', normalizeCompetitorCareRate(100, 'HC'), null);
assert('a negative care rate is still junk', normalizeCompetitorCareRate(-5, 'HC'), null);
assert('NaN is still junk', normalizeCompetitorCareRate(Number.NaN, 'HC'), null);
assertClose('HC $1,004/mo still converts to ~$33/day', normalizeCompetitorCareRate(1004, 'HC'), 1004 / DAYS_PER_MONTH);

// The monthly lines never had a plausibility band, so zero only had to clear
// the missing-data check there. Assert it anyway: AL and HC must agree that
// zero is a value.
console.log('');
assert('AL $0 competitor care is a value, not missing', normalizeCompetitorCareRate(0, 'AL'), 0);
assertClose('AL $0 competitor care yields careAdj = −570', computeCompetitorCareAdj(0, ourCare, 'AL').careAdj, -570);

// SL and VIL carry no Level-2 care at all, so a zero there is not a $0 charge —
// it is a column that does not apply, and no adjustment may be published.
assert('SL ignores competitor care entirely, even at $0', computeCompetitorCareAdj(0, ourCare, 'SL').careAdj, null);
assert('VIL ignores competitor care entirely, even at $0', computeCompetitorCareAdj(0, ourCare, 'VIL').careAdj, null);

// A zero on their side is only half the comparison: with no care rate of our
// own there is still nothing to difference against.
assert('$0 competitor care with no rate of our own yields null', computeCompetitorCareAdj(0, new Map(), 'HC').careAdj, null);

// HC/MC inherits our HC rate when the campus has no explicit HC/MC row, so a
// zero-care HC/MC competitor is comparable through the inherited figure.
const mcInherited = computeCompetitorCareAdj(0, ourCare, 'HC/MC');
assertClose('HC/MC $0 competitor care yields careAdj = −33 via the inherited HC rate', mcInherited.careAdj, -33);
assert('the inherited HC/MC comparison is flagged as inherited', mcInherited.ourCareInherited, true);

// ---------------------------------------------------------------------------
// Section 3 — Competitive Position scatter
//
// The scatter drops competitors whose surveyed daily rate cannot be a daily
// rate (a monthly figure typed into the daily field survives division only if
// the result is still a credible day rate). That screen must keep working, and
// must not swallow zero-care competitors along with it: a bundled-care
// competitor is one of the most competitive points on the chart and is exactly
// the point a user would notice missing.
// ---------------------------------------------------------------------------
console.log('\n=== 3. the scatter keeps zero-care competitors and drops implausible rates ===\n');

const surveyRow = (
  competitor_type: string,
  monthly_rate_avg: number | null,
  care_level_2_rate: number | null,
): SurveyRow => ({
  keystats_location: 'Mooresville - 5174',
  competitor_type,
  monthly_rate_avg,
  care_level_2_rate,
  medication_management_fee: 0,
});

// Base-rate screen, unchanged by the care fix.
assertClose('a $389/day HC rate is kept', normalizeBaseRate('HC', 389), 389);
assert('a $1,200 HC rate is dropped — /30.44 leaves $39/day, below the daily floor', normalizeBaseRate('HC', 1200), null);
assert('a $20/day HC rate is dropped as too low to be a day rate', normalizeBaseRate('HC', 20), null);
assertClose('a $12,000 HC rate converts to a credible ~$394/day', normalizeBaseRate('HC', 12000), 12000 / DAYS_PER_MONTH);

// Aggregation: the zero-care competitor must still produce an entry, and the
// three care states must stay distinguishable in it. `careL2 = null` means "not
// surveyed"; only an actual survey value — including 0 — may become a number.
const aggregated = aggregateSurveyRows([surveyRow('HC', 389, 0)]);
const entry = aggregated.get('Mooresville - 5174|||HC');
assert('a zero-care competitor still yields a benchmark entry', entry != null, true);
assertClose('its base rate is untouched by the zero care value', entry?.baseRate, 389);
assertClose('a surveyed $0 is retained as the value 0, not discarded', entry?.careL2, 0);

const unsurveyed = aggregateSurveyRows([surveyRow('HC', 389, null)])
  .get('Mooresville - 5174|||HC');
assert('an unsurveyed competitor still yields an entry', unsurveyed != null, true);
assert('but its care is null, not 0 — absence is not a $0 charge', unsurveyed?.careL2, null);

// The distinction has to survive averaging: a group holding both a bundled-care
// row and a paid-care row must average the two, not drop the zero. Averaging
// 0 and 40 gives 20; ignoring the zero would give 40 and understate how
// aggressively that competitor prices care.
const mixed = aggregateSurveyRows([surveyRow('HC', 389, 0), surveyRow('HC', 389, 40)])
  .get('Mooresville - 5174|||HC');
assertClose('a mixed zero/positive group averages both rows', mixed?.careL2, 20);

// A competitor whose only row is an implausible rate yields nothing at all —
// this is the exclusion the scatter relies on, asserted next to the inclusion
// above so the two cannot be confused for one another.
assert('a competitor with only an implausible rate yields no entry',
  aggregateSurveyRows([surveyRow('HC', 1200, 0)]).size, 0);

// End to end through the scatter's own benchmark object. `careL2: 0` is what
// aggregation produces for a bundled-care competitor, and the scatter's
// adjustment is (their care − ours), so the point lands at 389 − 33 = 356 —
// the same care-adjusted figure the Competitors tab now shows for it.
const scatterCare = new Map<string, number>([['Mooresville - 5174|||HC', 33]]);
const compKey = 'Mooresville - 5174|||HC|||Brooke Knoll Village';
const weightDist = new Map([[compKey, { weight: 1, distanceMiles: 3 }]]);
const scatterFor = (careL2: number | null) => new StudioCompBenchmark(
  new Map<string, CompBenchmarkEntry>([[compKey, { baseRate: 389, careL2, medMgmt: 0 }]]),
  scatterCare,
  weightDist,
).benchmarkFor('Mooresville - 5174', 'HC');

const bench = scatterFor(0);
assert('the zero-care competitor appears on the scatter', bench?.topName, 'Brooke Knoll Village');
assertClose('its care-adjusted rate is 389 − 33 = 356', bench?.topAdjusted, 356);
assertClose('the scatter reports the same −33 adjustment as the Competitors tab', bench?.topCareAdj, -33);

// The counter-case that makes the assertion above mean something: an unsurveyed
// competitor must NOT land in the same place. Without the null/zero split both
// of these came out at 356, so the test above would have passed no matter what
// the code did with a zero.
const benchNull = scatterFor(null);
assert('an unsurveyed competitor still appears on the scatter', benchNull?.topName, 'Brooke Knoll Village');
assertClose('but it gets no care adjustment', benchNull?.topCareAdj, 0);
assertClose('so it plots at its raw $389, not at a fabricated $356', benchNull?.topAdjusted, 389);
assert('the two states are genuinely different points',
  bench?.topAdjusted !== benchNull?.topAdjusted, true);

// The scatter has no competitor left once the implausible-rate screen removes
// the only row, so the location/SL simply produces no point rather than a
// fabricated one.
const emptyScatter = new StudioCompBenchmark(new Map(), scatterCare, new Map());
assert('a location whose only competitor was screened out yields no point',
  emptyScatter.benchmarkFor('Mooresville - 5174', 'HC'), null);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
