/**
 * Regression tests: HC/HC-MC daily street rates must NOT be filtered by the
 * prorated-move-in plausibility guard.
 *
 * Background
 * ----------
 * The rent-roll export overwrites street_rate with the prorated first-month
 * charge during a move-in or move-out month.  For senior-housing service lines
 * (AL, AL/MC, SL, VIL) this typically produces values like $169 — well below a
 * real monthly street rate — so every analytics aggregate applies the guard:
 *
 *   street_rate > 0
 *   AND (service_line IN ('HC','HC/MC') OR street_rate >= 1000)
 *
 * HC and HC/MC rates are DAILY ($150–$350/day is normal), so they are always
 * below $1 000 even when correct.  The exemption `service_line IN ('HC','HC/MC')`
 * must keep them visible.
 *
 * A regression — accidentally dropping the exemption — would blank every HC
 * avg_street_rate tile in analytics, showing NULL instead of the daily rate.
 *
 * What these tests verify
 * -----------------------
 *  1. The predicate itself: correct rows pass, junk rows are excluded.
 *  2. compPositionOwnRates uses the RELATIVE outlier gate, not a hard floor —
 *     we confirm a realistic HC dataset survives it intact. This is the real
 *     regression risk: HC rates are per DAY, so any absolute dollar floor
 *     blanks the entire service line.
 *  3. All non-HC service lines with sub-$1000 values are excluded.
 *
 * Run with: npx tsx tests/hcDailyRatePlausibilityGuard.test.ts
 */

import { RATE_OUTLIER_FLOOR_RATIO } from '../shared/rateOutliers';

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

// ---------------------------------------------------------------------------
// The plausibility predicate — mirrors the SQL guard used in every analytics
// aggregate in routes.ts (lines ~4569, 4681, 6085, 6153, 19076, 19098, 19552,
// 19626, 22363, etc.):
//
//   street_rate > 0
//   AND (service_line IN ('HC','HC/MC') OR street_rate >= 1000)
//
// Returns true when the row should be INCLUDED in the aggregate.
// ---------------------------------------------------------------------------
const HC_DAILY_SLS = new Set(['HC', 'HC/MC']);

function passesPlausibilityGuard(serviceLine: string, streetRate: number): boolean {
  if (streetRate <= 0) return false;
  if (HC_DAILY_SLS.has(serviceLine)) return true;   // HC/HC-MC exempted — daily rate
  return streetRate >= 1000;                          // non-HC must be a plausible monthly rate
}

// ---------------------------------------------------------------------------
// Section 1 — Core predicate behaviour
// ---------------------------------------------------------------------------
console.log('\n=== 1. Plausibility guard predicate ===\n');

// HC daily rates — must PASS (be included)
assert('HC  $220/day is included (daily rate, typical HC)', passesPlausibilityGuard('HC', 220), true);
assert('HC  $300/day is included (daily rate, mid-range HC)', passesPlausibilityGuard('HC', 300), true);
assert('HC  $350/day is included (daily rate, high HC)', passesPlausibilityGuard('HC', 350), true);
assert('HC  $150/day is included (daily rate, low HC)', passesPlausibilityGuard('HC', 150), true);

// HC/MC daily rates — must also PASS
assert('HC/MC $220/day is included (daily rate)', passesPlausibilityGuard('HC/MC', 220), true);
assert('HC/MC $275/day is included (daily rate)', passesPlausibilityGuard('HC/MC', 275), true);

// Non-HC valid monthly rates — must PASS
assert('AL  $4000/mo is included (valid monthly)', passesPlausibilityGuard('AL', 4000), true);
assert('AL/MC $3500/mo is included (valid monthly)', passesPlausibilityGuard('AL/MC', 3500), true);
assert('SL  $2800/mo is included (valid monthly)', passesPlausibilityGuard('SL', 2800), true);
assert('VIL $2200/mo is included (valid monthly)', passesPlausibilityGuard('VIL', 2200), true);
assert('AL  $1000/mo is included (exact threshold)', passesPlausibilityGuard('AL', 1000), true);

// Non-HC prorated move-in rates — must be EXCLUDED
assert('AL  $169/mo is excluded (prorated move-in)', passesPlausibilityGuard('AL', 169), false);
assert('AL/MC $250/mo is excluded (prorated move-in)', passesPlausibilityGuard('AL/MC', 250), false);
assert('SL  $500/mo is excluded (sub-$1000, likely prorated)', passesPlausibilityGuard('SL', 500), false);
assert('VIL $800/mo is excluded (sub-$1000, likely prorated)', passesPlausibilityGuard('VIL', 800), false);
assert('AL  $999/mo is excluded (just below threshold)', passesPlausibilityGuard('AL', 999), false);

// Zero / negative always excluded
assert('HC  $0 is excluded', passesPlausibilityGuard('HC', 0), false);
assert('AL  $0 is excluded', passesPlausibilityGuard('AL', 0), false);
assert('HC -$1 is excluded', passesPlausibilityGuard('HC', -1), false);

// ---------------------------------------------------------------------------
// Section 2 — Aggregate over a realistic dataset
//
// Simulate what AVG(street_rate) FILTER (WHERE ...) would compute over a
// mixed HC rent roll that includes some prorated move-in rows ($169) among
// a majority of correct daily rates ($220).
// ---------------------------------------------------------------------------
console.log('\n=== 2. AVG aggregate over realistic HC dataset ===\n');

type RentRollRow = { service_line: string; street_rate: number };

function avgStreetRate(rows: RentRollRow[]): number | null {
  const valid = rows.filter(r => passesPlausibilityGuard(r.service_line, r.street_rate));
  if (valid.length === 0) return null;
  return valid.reduce((sum, r) => sum + r.street_rate, 0) / valid.length;
}

// 8 HC units at $220/day + 2 prorated at $169 (move-in month)
const hcDataset: RentRollRow[] = [
  ...Array(8).fill({ service_line: 'HC', street_rate: 220 }),
  { service_line: 'HC', street_rate: 169 },  // prorated — still a HC row
  { service_line: 'HC', street_rate: 169 },  // prorated — still a HC row
];

const hcAvg = avgStreetRate(hcDataset);
// HC is EXEMPTED entirely — all 10 rows (including prorated) count.
// avg = (8*220 + 2*169) / 10 = (1760 + 338) / 10 = 209.8
assert('HC dataset: avg includes ALL HC rows (exempted from floor)', hcAvg !== null, true);
// Both prorated HC rows are included because HC is exempt from the $1000 floor.
// So avg = 209.8, not 220.
assert('HC dataset: 10 rows included (all HC rows pass)', hcDataset.filter(r => passesPlausibilityGuard(r.service_line, r.street_rate)).length, 10);

// AL dataset: 8 valid monthly rates + 2 prorated
const alDataset: RentRollRow[] = [
  ...Array(8).fill({ service_line: 'AL', street_rate: 3800 }),
  { service_line: 'AL', street_rate: 169 },   // prorated — must be excluded
  { service_line: 'AL', street_rate: 250 },   // prorated — must be excluded
];

const alAvg = avgStreetRate(alDataset);
assert('AL dataset: avg is non-null (valid rows exist)', alAvg !== null, true);
assert('AL dataset: 8 rows included (prorated excluded)', alDataset.filter(r => passesPlausibilityGuard(r.service_line, r.street_rate)).length, 8);
assert('AL dataset: avg equals $3800 (no contamination from prorated rows)',
  Math.round(alAvg!), 3800);

// Mixed portfolio (HC + AL + prorated rows): confirm HC avg is not lost
const portfolio: RentRollRow[] = [
  ...Array(5).fill({ service_line: 'HC', street_rate: 220 }),
  ...Array(5).fill({ service_line: 'AL', street_rate: 4000 }),
  { service_line: 'AL', street_rate: 169 },   // prorated — excluded from AL avg
  { service_line: 'HC', street_rate: 169 },   // prorated HC — included in HC avg (exempt)
];

const hcOnlyAvg = avgStreetRate(portfolio.filter(r => r.service_line === 'HC'));
const alOnlyAvg = avgStreetRate(portfolio.filter(r => r.service_line === 'AL'));
assert('Portfolio HC avg is non-null (daily rates preserved)', hcOnlyAvg !== null, true);
assert('Portfolio AL avg equals $4000 (prorated AL row excluded)', Math.round(alOnlyAvg!), 4000);
assertGt('Portfolio HC avg > 0 (daily rates present)', hcOnlyAvg!, 0);

// ---------------------------------------------------------------------------
// Section 3 — compPositionOwnRates relative-outlier-gate semantics
//
// compPositionOwnRates.ts reports a true AVERAGE street rate and suppresses
// junk rows with the two-level relative gate from rateBaselineSql.ts, NOT with
// mode() and NOT with any absolute dollar floor.  HC is the service line that
// makes this necessary: its rates are per DAY, so a $1,000 floor would blank
// every HC campus.  A relative gate needs no such carve-out.
// ---------------------------------------------------------------------------
console.log('\n=== 3. relative outlier gate for compPositionOwnRates (HC exemption) ===\n');

// percentile_cont(0.5) — interpolates across an even count, as Postgres does.
function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * JS mirror of buildRateBaselineCte + STREET_RATE_GATE.
 * Level 1 judges each rate against its own group's median; level 2 substitutes
 * the service-line median when the group's own median is itself implausible
 * (a group made entirely of junk would otherwise pass its own test).
 */
function gatedAverage(rates: number[], serviceLineMedian?: number): number | null {
  if (rates.length === 0) return null;
  const own = median(rates);
  const baseline =
    serviceLineMedian != null && own < RATE_OUTLIER_FLOOR_RATIO * serviceLineMedian
      ? serviceLineMedian
      : own;
  const kept = rates.filter((r) => r >= RATE_OUTLIER_FLOOR_RATIO * baseline);
  if (kept.length === 0) return null;
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

// 10 HC units: 8 at $220/day, 2 at $169 (prorated move-in month).
// $169 is only 23% below the median, well inside the gate — a prorated day
// rate is still a real rate, so it is averaged in rather than discarded.
const hcRates = [...Array(8).fill(220), 169, 169];
assert('HC gate keeps all 10 daily rates (none is a relative outlier)',
  gatedAverage(hcRates), (8 * 220 + 2 * 169) / 10);
// The regression this file exists to catch: every one of these is under $1,000.
assert('HC rates are all sub-$1000 yet none is dropped (no absolute floor)',
  hcRates.every((r) => r < 1000) && gatedAverage(hcRates) !== null, true);

// Degenerate campus where prorated rows outnumber correct ones: still returns
// a number.  The gate never blanks a group just because it is cheap.
const hcRatesEdge = [...Array(3).fill(220), 169, 169, 169, 169];
assertGt('HC gate with prorated majority still returns a rate', gatedAverage(hcRatesEdge)!, 0);

// AL: monthly rates with two junk rows an order of magnitude below the median.
// Median $3,800 → cutoff $1,330 → $169 and $250 are excluded, unlike under
// mode(), which merely out-voted them and left them in the unit count.
const alRates = [...Array(8).fill(3800), 169, 250];
assert('AL gate drops the $169/$250 junk rows and averages the rest',
  gatedAverage(alRates), 3800);

// Level 2 — a campus whose ENTIRE service line was imported at a fraction of
// the portfolio rate cannot police itself: its own median is junk, so every
// row passes level 1.  Judged against the service line, all rows fall away and
// the group reports nothing rather than an invented ~$155 assisted-living rate.
assert('Level 2 blanks a campus whose whole service line is implausible',
  gatedAverage([155, 154, 156, 155, 155], 5825), null);
// ...but a campus that is merely cheaper than the portfolio keeps its rates.
assert('Level 2 does NOT punish a legitimately lower-priced campus',
  gatedAverage([3000, 3000, 3000], 5825), 3000);
// ...and level 2 cannot blank HC, whose per-day median is small by nature.
assert('Level 2 leaves HC intact when compared to the HC service-line median',
  gatedAverage([220, 220, 220], 240), 220);

// ---------------------------------------------------------------------------
// Section 4 — Consistency: compPositionOwnRates gate vs routes.ts guard
//
// Some routes.ts surfaces still carry the older explicit plausibility floor
// with its HC carve-out, while compPositionOwnRates uses the relative gate.
// The two disagree on non-HC junk (the relative gate is stricter), but they
// must agree on the one thing that matters here: neither may blank HC.
// ---------------------------------------------------------------------------
console.log('\n=== 4. HC exemption consistency across both approaches ===\n');

// Approach A: explicit floor with an HC carve-out (routes.ts)
const hcPassesFloor = passesPlausibilityGuard('HC', 220);
assert('Approach A (explicit floor): HC $220 passes', hcPassesFloor, true);

// Approach B: relative gate, which needs no carve-out (compPositionOwnRates)
const hcGateResult = gatedAverage([220, 220, 220, 220, 220]);
assert('Approach B (relative gate): HC campus averages $220', hcGateResult, 220);
assert('Approach B (relative gate): HC campus is not blanked', (hcGateResult ?? 0) > 0, true);

// Confirm neither approach returns null / 0 for a healthy HC campus.
assert('HC avg (approach A) is non-null', avgStreetRate(Array(5).fill({ service_line: 'HC', street_rate: 220 })) !== null, true);
assert('HC gated average (approach B) is non-null', gatedAverage(Array(5).fill(220)) !== null, true);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
