/**
 * Regression tests: HC / HC-MC daily street rates must survive the street-rate
 * outlier gate.
 *
 * Background
 * ----------
 * The rent-roll export overwrites street_rate with the prorated first-month
 * charge during a move-in or move-out month. For senior-housing service lines
 * (AL, AL/MC, SL, VIL) that produces values like $169 — far below a real
 * monthly rate — so every rate aggregate screens rows before averaging.
 *
 * That screen used to be an absolute floor, `street_rate >= 1000`, with an
 * explicit `service_line IN ('HC','HC/MC')` carve-out bolted on. HC and HC/MC
 * rates are DAILY ($150–$350/day is normal), so without the carve-out the
 * floor blanked the entire service line. The floor is gone: the gate is now
 * relative and two-level, defined once in the rate_baseline_v view and
 * mirrored in JS by `passesStreetGate`. A relative gate needs no carve-out at
 * all, because it compares each rate to its own peers rather than to a dollar
 * amount.
 *
 * The regression this file exists to catch is any reintroduction of an
 * absolute dollar threshold anywhere in that path. Every HC assertion below
 * uses rates under $1,000 on purpose.
 *
 * These tests call the PRODUCTION gate and the PRODUCTION grouping function.
 * Earlier versions of this file re-implemented both in local helpers, which
 * meant they passed no matter what the real code did.
 *
 * Run with: npx tsx tests/hcDailyRatePlausibilityGuard.test.ts
 */

import { RATE_OUTLIER_FLOOR_RATIO } from '../shared/rateOutliers';
import { passesStreetGate } from '../server/services/rateBaselineView';
import {
  computeGroupStreetRateMap,
  type StreetRateGateRow,
} from '../server/services/groupStreetRateJs';

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

function assertClose(description: string, actual: number | undefined, expected: number) {
  if (actual != null && Math.abs(actual - expected) < 0.01) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ~${expected}, Got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

/**
 * Stands in for the rate_baseline_v lookup so a test can state a baseline
 * outright instead of seeding rows and letting the view derive one. The gate
 * and the averaging under test are the real implementations; only the
 * baseline source is substituted.
 */
function baselineQuery(baselines: Record<string, number | null>) {
  return async () => ({
    rows: Object.entries(baselines).map(([key, baseline_street]) => {
      const [location, service_line] = key.split('||');
      return { location, service_line, baseline_street };
    }),
  });
}

// ---------------------------------------------------------------------------
// Section 1 — the production predicate, `passesStreetGate`
// ---------------------------------------------------------------------------
console.log('\n=== 1. passesStreetGate — relative, with no dollar threshold ===\n');

// The whole point: an HC campus's baseline is a daily rate, so HC rates clear
// it comfortably despite every value being under $1,000.
assert('HC $220/day passes against a $220 HC baseline', passesStreetGate(220, 220), true);
assert('HC $150/day passes against a $220 HC baseline', passesStreetGate(150, 220), true);
assert('HC $350/day passes against a $220 HC baseline', passesStreetGate(350, 220), true);

// A monthly service line judged against a monthly baseline drops the prorated
// rows the old floor was built to drop.
assert('AL $169 fails against a $3800 AL baseline', passesStreetGate(169, 3800), false);
assert('AL $250 fails against a $3800 AL baseline', passesStreetGate(250, 3800), false);
assert('AL $3800 passes against a $3800 AL baseline', passesStreetGate(3800, 3800), true);

// The cutoff tracks the constant rather than any dollar figure, in both bases.
const alCutoff = RATE_OUTLIER_FLOOR_RATIO * 3800;
assert('AL rate exactly at the cutoff passes', passesStreetGate(alCutoff, 3800), true);
assert('AL rate just under the cutoff fails', passesStreetGate(alCutoff - 0.01, 3800), false);
const hcCutoff = RATE_OUTLIER_FLOOR_RATIO * 220;
assert('HC rate exactly at the cutoff passes', passesStreetGate(hcCutoff, 220), true);
assert('HC rate just under the cutoff fails', passesStreetGate(hcCutoff - 0.01, 220), false);

// A rate that cannot be judged is reported, not suppressed. Blanking on a
// missing baseline would silently erase whole campuses.
assert('unknown baseline is permissive (null)', passesStreetGate(220, null), true);
assert('unknown baseline is permissive (undefined)', passesStreetGate(220, undefined), true);
assert('zero baseline is permissive', passesStreetGate(220, 0), true);

// ---------------------------------------------------------------------------
// Section 2 — the production grouping function over a realistic rent roll
// ---------------------------------------------------------------------------
console.log('\n=== 2. computeGroupStreetRateMap over HC and AL data ===\n');

function rows(...specs: Array<[string, string, string, number, number]>): StreetRateGateRow[] {
  const out: StreetRateGateRow[] = [];
  let n = 100;
  for (const [campus, sl, rt, rate, count] of specs) {
    for (let i = 0; i < count; i++) {
      out.push({
        campus,
        service_line: sl,
        room_type: rt,
        room_number: String(n++),
        street_rate: rate,
      });
    }
  }
  return out;
}

// 8 HC beds at $220/day plus 2 prorated at $169. $169 is only 23% below the
// baseline — well inside the gate — so a prorated day rate is averaged in
// rather than discarded. It is a real charge, not a corrupt value.
const hcMap = await computeGroupStreetRateMap(
  baselineQuery({ 'Campus HC||HC': 220 }),
  'test',
  '2026-08',
  rows(['Campus HC', 'HC', 'Semi-Private', 220, 8], ['Campus HC', 'HC', 'Semi-Private', 169, 2]),
);
assertClose('HC group averages all 10 daily rates', hcMap.get('Campus HC||HC||Semi-Private'), (8 * 220 + 2 * 169) / 10);
assert('HC group is present despite every rate being sub-$1000', hcMap.has('Campus HC||HC||Semi-Private'), true);

// A degenerate campus where prorated rows outnumber correct ones still reports
// a number. The gate never blanks a group merely for being cheap.
const hcEdge = await computeGroupStreetRateMap(
  baselineQuery({ 'Campus HC||HC': 169 }),
  'test',
  '2026-08',
  rows(['Campus HC', 'HC', 'Private', 220, 3], ['Campus HC', 'HC', 'Private', 169, 4]),
);
assert('HC group with a prorated majority still reports a rate', (hcEdge.get('Campus HC||HC||Private') ?? 0) > 0, true);

// AL: the junk rows the old floor targeted are still removed, now because they
// are an order of magnitude below their peers rather than below $1,000.
const alMap = await computeGroupStreetRateMap(
  baselineQuery({ 'Campus AL||AL': 3800 }),
  'test',
  '2026-08',
  rows(
    ['Campus AL', 'AL', 'Studio', 3800, 8],
    ['Campus AL', 'AL', 'Studio', 169, 1],
    ['Campus AL', 'AL', 'Studio', 250, 1],
  ),
);
assertClose('AL group drops the $169/$250 rows and averages the rest', alMap.get('Campus AL||AL||Studio'), 3800);

// Mixed portfolio: an AL baseline must never be applied to HC rows. If the two
// service lines shared a baseline, HC would vanish entirely.
const mixed = await computeGroupStreetRateMap(
  baselineQuery({ 'Campus Mixed||HC': 220, 'Campus Mixed||AL': 4000 }),
  'test',
  '2026-08',
  rows(
    ['Campus Mixed', 'HC', 'Private', 220, 5],
    ['Campus Mixed', 'AL', 'Studio', 4000, 5],
    ['Campus Mixed', 'AL', 'Studio', 169, 1],
  ),
);
assertClose('mixed portfolio: HC keeps its daily average', mixed.get('Campus Mixed||HC||Private'), 220);
assertClose('mixed portfolio: AL drops its prorated row', mixed.get('Campus Mixed||AL||Studio'), 4000);

// ---------------------------------------------------------------------------
// Section 3 — level 2, supplied by the view
//
// A campus whose ENTIRE service line was imported at a fraction of the
// portfolio rate cannot police itself: its own median is junk, so every row
// clears level 1. The view substitutes the service-line median, which is why
// the gate's baseline is read from the view rather than derived from the rows
// in hand.
// ---------------------------------------------------------------------------
console.log('\n=== 3. level-2 substitution reaches the JS path ===\n');

const junkCampus = await computeGroupStreetRateMap(
  // The view already resolved level 2: this campus's own median was implausible
  // against the AL service line, so baseline_street is the SL median.
  baselineQuery({ 'Campus Junk||AL': 5825 }),
  'test',
  '2026-08',
  rows(['Campus Junk', 'AL', 'Studio', 155, 5]),
);
assert('a wholly implausible AL campus is blanked, not reported at ~$155', junkCampus.has('Campus Junk||AL||Studio'), false);

const cheapCampus = await computeGroupStreetRateMap(
  baselineQuery({ 'Campus Cheap||AL': 3000 }),
  'test',
  '2026-08',
  rows(['Campus Cheap', 'AL', 'Studio', 3000, 3]),
);
assertClose('a legitimately lower-priced AL campus keeps its rates', cheapCampus.get('Campus Cheap||AL||Studio'), 3000);

// Level 2 for HC is an HC-wide median, itself a daily figure, so it cannot
// blank HC either. This is the assertion that fails if anyone reintroduces a
// portfolio-wide baseline that mixes daily and monthly service lines.
const hcLevel2 = await computeGroupStreetRateMap(
  baselineQuery({ 'Campus HC2||HC': 240 }),
  'test',
  '2026-08',
  rows(['Campus HC2', 'HC', 'Private', 220, 3]),
);
assertClose('level 2 leaves HC intact against the HC service-line median', hcLevel2.get('Campus HC2||HC||Private'), 220);

// A campus with no baseline row at all reports its rates rather than
// disappearing — the same permissiveness Section 1 asserts on the predicate.
const noBaseline = await computeGroupStreetRateMap(
  baselineQuery({}),
  'test',
  '2026-08',
  rows(['Campus Unknown', 'HC', 'Private', 220, 3]),
);
assertClose('a campus with no baseline still reports', noBaseline.get('Campus Unknown||HC||Private'), 220);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
