/**
 * The impact stored on an accepted AI suggestion must be the impact the
 * operator approved on the card.
 *
 * Generation draws the card from the qualified rule-impact engine under the
 * run's FULL scope — every service line the suggestion covers, and every
 * campus the run was filtered to. Accept used to recompute with the naive
 * elasticity estimate scoped to `locationId` alone and the FIRST service line
 * alone. A region or division run has no single `locationId`, so the number
 * persisted on the rule was portfolio-wide: the operator approved one figure
 * and Rule Administration then reported another.
 *
 * The seeded portfolio is deliberately lopsided — two small in-scope campuses
 * and one large out-of-scope campus, with units in two service lines — so a
 * scope leak or a dropped service line changes the answer by a wide margin
 * rather than a rounding error. Every expectation is computed by calling the
 * impact engine directly, never by copying the endpoint's arithmetic.
 *
 * Requires the dev server running on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/aiSuggestionImpactParity.test.ts
 */
import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';
import { parseNaturalLanguageRule } from '../server/naturalLanguageParser';
import {
  buildRuleImpactContext,
  computeQualifiedRuleImpact,
  selectSuggestionImpact,
} from '../server/services/ruleImpactService';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const CLIENT = 'ptest-ai-impact-parity';
const USERNAME = 'ptest_ai_impact_parity';
const PASSWORD = 'ptest-password-1';
const MONTH = '2026-07';

// Two small campuses form the run's scope; the big one must never leak in.
const SMALL_A = 'Parity Small A';
const SMALL_B = 'Parity Small B';
const BIG_C = 'Parity Big C';

const RULE_NAME = 'Parity Test Studio Increase';
const RULE_SENTENCE = 'Increase street rate by 5% for occupied Studio units';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function ok(desc: string, cond: boolean, detail = '') {
  if (cond) { console.log(`${PASS} ${desc}`); passed++; }
  else { console.log(`${FAIL} ${desc}${detail ? `\n    ${detail}` : ''}`); failed++; }
}

function near(desc: string, actual: number | null, expected: number | null, tol = 0.5) {
  const a = actual ?? 0, e = expected ?? 0;
  ok(desc, Math.abs(a - e) <= tol, `expected: ${e}\n    actual:   ${a}`);
}

function apart(desc: string, a: number | null, b: number | null) {
  ok(desc, Math.abs((a ?? 0) - (b ?? 0)) > 1,
    `these must differ or the test proves nothing: ${a} vs ${b}`);
}

// ── seed ────────────────────────────────────────────────────────────────────

const locIds = new Map<string, string>();

async function seed() {
  await cleanup();
  await pool.query(`INSERT INTO clients (id, name) VALUES ($1, 'AI Impact Parity Test') ON CONFLICT (id) DO NOTHING`, [CLIENT]);
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, client_id) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, client_id = $3`,
    [USERNAME, hash, CLIENT],
  );

  for (const [name, region] of [[SMALL_A, 'RSmall'], [SMALL_B, 'RSmall'], [BIG_C, 'RBig']] as const) {
    const r = await pool.query(
      `INSERT INTO locations (client_id, name, region, division) VALUES ($1,$2,$3,'DTest') RETURNING id`,
      [CLIENT, name, region],
    );
    locIds.set(name, r.rows[0].id);
  }

  // Big C carries 10x the units of each small campus, so a scope leak is
  // unmistakable in the resulting dollar figure.
  const plan: Array<[string, string, number]> = [
    [SMALL_A, 'AL', 6], [SMALL_A, 'SL', 6],
    [SMALL_B, 'AL', 6], [SMALL_B, 'SL', 6],
    [BIG_C, 'AL', 60], [BIG_C, 'SL', 60],
  ];
  for (const [loc, sl, count] of plan) {
    for (let i = 0; i < count; i++) {
      await pool.query(
        `INSERT INTO rent_roll_data
           (client_id, upload_month, date, location, location_id, room_number, room_type,
            source_room_type, occupied_yn, size, street_rate, in_house_rate, service_line,
            payor_type, days_vacant, move_in_date)
         VALUES ($1,$2,$3,$4,$5,$6,'Studio','Studio',true,'400',$7,$8,$9,'Private Pay',0,$10)`,
        [CLIENT, MONTH, `${MONTH}-01`, loc, locIds.get(loc), `${sl}-${i + 1}`,
         4000, 3800, sl, `${MONTH}-05`],
      );
    }
  }
}

async function cleanup() {
  // prefix match: the suite also creates "<RULE_NAME> (single)" etc.
  await pool.query(`DELETE FROM adjustment_rules WHERE name LIKE $1 OR client_id = $2`,
    [`${RULE_NAME}%`, CLIENT]);
  await pool.query(`DELETE FROM ai_suggestion_runs WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM ai_suggestion_feedback WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM locations WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM clients WHERE id = $1`, [CLIENT]);
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('no session cookie returned');
  return cookie.split(';')[0];
}

// ── pure-policy checks (no DB) ──────────────────────────────────────────────

function policyChecks() {
  console.log('\n── impact-selection policy ──');
  const streetAction = { target: 'street_rate', adjustmentType: 'percentage', adjustmentValue: 5 };
  const naive = { unitsImpacted: 7, monthlyImpact: 700, annualImpact: 8400 };

  // No context at all: the naive estimate is the documented street-rate fallback.
  const noCtx = selectSuggestionImpact(null, {
    action: streetAction, trigger: { type: 'immediate' },
    serviceLines: ['AL'], locationId: null, naive,
  });
  ok('street rule with no impact context falls back to the naive estimate',
    noCtx.monthlyImpact === 700 && noCtx.unitsImpacted === 7 && noCtx.basis === 'unavailable');

  // In-house rules must never borrow the naive number — it counts vacant units.
  const ih = selectSuggestionImpact(null, {
    action: { ...streetAction, target: 'in_house_rate' }, trigger: { type: 'immediate' },
    serviceLines: ['AL'], locationId: null, naive,
  });
  ok('in-house rule never falls back to the naive (vacant-inclusive) estimate',
    ih.monthlyImpact === null && ih.unitsImpacted === 0 && ih.basis === 'unavailable');

}

// The empty-scope contract only means anything against a REAL context: with a
// null context every path returns the fallback, so a scope bug would hide.
function emptyScopeChecks(ctx: any, parsed: any, portfolioMonthly: number | null) {
  console.log('\n── an unresolvable campus scope reports nothing, not everything ──');
  // A LOUD naive estimate, standing in for the portfolio-wide elasticity figure
  // the endpoint really computes when there is no single locationId. A zeroed
  // naive here would let a fallback bug pass unnoticed.
  const loudNaive = {
    unitsImpacted: 9999, monthlyImpact: 123456, annualImpact: 1481472,
    computedForLocationId: null,
  };
  const empty = selectSuggestionImpact(ctx, {
    action: parsed.action, trigger: parsed.trigger,
    serviceLines: ['AL', 'SL'], locationId: null, scopeLocationIds: [],
    naive: loudNaive,
  });
  ok('a campus scope that resolves to no campus affects no units',
    empty.unitsImpacted === 0, `got ${empty.unitsImpacted} units`);
  ok('...and does NOT widen to the portfolio-wide figure',
    (empty.monthlyImpact ?? 0) === 0,
    `got ${empty.monthlyImpact}, portfolio-wide is ${portfolioMonthly}`);

  ok('...and does not borrow the portfolio-wide naive estimate either',
    empty.monthlyImpact !== loudNaive.monthlyImpact && empty.basis !== 'naive',
    `monthly=${empty.monthlyImpact} basis=${empty.basis}`);

  const unscoped = selectSuggestionImpact(ctx, {
    action: parsed.action, trigger: parsed.trigger,
    serviceLines: ['AL', 'SL'], locationId: null, scopeLocationIds: null,
    naive: { unitsImpacted: 0, monthlyImpact: null, annualImpact: null, computedForLocationId: null },
  });
  ok('while an ABSENT scope still means the whole portfolio',
    Math.abs((unscoped.monthlyImpact ?? 0) - (portfolioMonthly ?? 0)) < 0.5,
    `got ${unscoped.monthlyImpact}, expected ${portfolioMonthly}`);

  // A multi-campus scope can never use the naive estimate, because the naive
  // calculator cannot express more than one campus.
  const multi = selectSuggestionImpact(ctx, {
    action: parsed.action, trigger: parsed.trigger,
    serviceLines: ['AL', 'SL'], locationId: null,
    scopeLocationIds: [locIds.get(SMALL_A)!, locIds.get(SMALL_B)!],
    naive: loudNaive,
  });
  ok('a multi-campus scope never falls back to the single-campus naive estimate',
    multi.monthlyImpact !== loudNaive.monthlyImpact && multi.basis !== 'naive',
    `monthly=${multi.monthlyImpact} basis=${multi.basis}`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  await seed();

  const parsed = parseNaturalLanguageRule(RULE_SENTENCE);
  if (!parsed) throw new Error(`fixture sentence no longer parses: "${RULE_SENTENCE}"`);

  const ctx = await buildRuleImpactContext(CLIENT);
  if (!ctx) throw new Error('buildRuleImpactContext returned null for the seeded client');

  const scopeIds = [locIds.get(SMALL_A)!, locIds.get(SMALL_B)!];
  const bothSLs = ['AL', 'SL'];

  // The accept handler persists the rule with the campus scope written into
  // action.filters.location, so score the expectation against that same rule.
  const scopedAction = {
    ...parsed.action,
    filters: { ...(parsed.action?.filters || {}), location: [SMALL_A, SMALL_B] },
  };

  const expected = computeQualifiedRuleImpact(
    ctx,
    { action: scopedAction, trigger: parsed.trigger, serviceLines: bothSLs, locationId: null },
    { locationIds: scopeIds },
  );
  // What the old code produced: no campus scope, first service line only.
  const portfolioWide = computeQualifiedRuleImpact(
    ctx, { action: parsed.action, trigger: parsed.trigger, serviceLines: bothSLs, locationId: null });
  const firstSlOnly = computeQualifiedRuleImpact(
    ctx,
    { action: scopedAction, trigger: parsed.trigger, serviceLines: ['AL'], locationId: null },
    { locationIds: scopeIds },
  );

  console.log('\n── fixture discriminates ──');
  ok('the seeded scope produces a non-zero impact',
    expected.monthlyImpact !== 0 && expected.affectedUnits > 0,
    `units=${expected.affectedUnits} monthly=${expected.monthlyImpact}`);
  apart('two-campus scope differs from portfolio-wide', expected.monthlyImpact, portfolioWide.monthlyImpact);
  apart('both service lines differ from the first one alone', expected.monthlyImpact, firstSlOnly.monthlyImpact);

  policyChecks();
  emptyScopeChecks(ctx, parsed, portfolioWide.monthlyImpact);

  // Seed the cached run exactly as generation would, carrying the campus scope
  // and the figures shown on the card.
  const suggestionId = '11111111-2222-3333-4444-555555555555';
  const cardPayload = {
    suggestions: [{
      suggestionId,
      name: RULE_NAME,
      description: RULE_SENTENCE,
      serviceLine: bothSLs.join(', '),
      serviceLines: bothSLs,
      locationId: null,
      locationNames: [SMALL_A, SMALL_B],
      trigger: parsed.trigger,
      action: parsed.action,
      unitsImpacted: expected.affectedUnits,
      monthlyImpact: expected.monthlyImpact,
      annualImpact: expected.annualImpact,
    }],
    context: { campus: '2 campuses' },
  };
  await pool.query(
    `INSERT INTO ai_suggestion_runs (client_id, payload) VALUES ($1, $2)
     ON CONFLICT (client_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [CLIENT, JSON.stringify(cardPayload)],
  );

  const cookie = await login();
  const res = await fetch(`${BASE}/api/adjustment-rules/suggestions/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      suggestionId,
      name: RULE_NAME,
      description: RULE_SENTENCE,
      locationId: null,
      serviceLine: bothSLs.join(', '),
      serviceLines: bothSLs,
    }),
  });
  if (!res.ok) throw new Error(`accept failed: ${res.status} ${await res.text()}`);

  const stored = await pool.query(
    `SELECT monthly_impact, annual_impact, volume_adjusted_annual_impact,
            action->'filters'->'location' AS loc_filter, service_lines
     FROM adjustment_rules WHERE name = $1`,
    [RULE_NAME],
  );
  ok('exactly one rule was created', stored.rows.length === 1, `got ${stored.rows.length}`);
  const row = stored.rows[0];
  const card = cardPayload.suggestions[0];

  console.log('\n── accepted rule matches the approved card ──');
  near('stored monthly impact matches the card', Number(row.monthly_impact), card.monthlyImpact);
  near('stored annual impact matches the card', Number(row.annual_impact), card.annualImpact);
  near('volume-adjusted annual is derived from the same annual figure',
    Number(row.volume_adjusted_annual_impact), Math.round((card.annualImpact ?? 0) * 1.05), 1.5);

  console.log('\n── the old failure modes stay fixed ──');
  apart('stored impact is NOT the portfolio-wide figure',
    Number(row.monthly_impact), portfolioWide.monthlyImpact);
  apart('stored impact is NOT the first-service-line-only figure',
    Number(row.monthly_impact), firstSlOnly.monthlyImpact);
  ok('the rule carries the recovered multi-campus filter',
    Array.isArray(row.loc_filter) && row.loc_filter.length === 2,
    `loc_filter=${JSON.stringify(row.loc_filter)}`);
  ok('the rule carries both service lines',
    Array.isArray(row.service_lines) && row.service_lines.length === 2,
    `service_lines=${JSON.stringify(row.service_lines)}`);

  // ── a cached scope whose campuses no longer resolve ──────────────────────
  // The run is still cached, so accept proceeds — but the campus names no
  // longer match any location (renamed or removed since generation). The
  // qualified engine correctly yields nothing; the danger is the naive
  // elasticity estimate, which has no campus scope at all, standing in for it
  // and persisting a portfolio-wide number under a two-campus rule.
  console.log('\n── a campus scope that no longer resolves stores nothing, not everything ──');
  const goneName = `${RULE_NAME} (scope gone)`;
  await pool.query(
    `INSERT INTO ai_suggestion_runs (client_id, payload) VALUES ($1, $2)
     ON CONFLICT (client_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [CLIENT, JSON.stringify({
      suggestions: [{
        ...cardPayload.suggestions[0],
        suggestionId: '44444444-3333-2222-1111-000000000000',
        locationNames: ['Campus That No Longer Exists', 'Also Gone'],
      }],
      context: { campus: '2 campuses' },
    })],
  );
  const goneRes = await fetch(`${BASE}/api/adjustment-rules/suggestions/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      suggestionId: '44444444-3333-2222-1111-000000000000',
      name: goneName,
      description: RULE_SENTENCE,
      locationId: null,
      serviceLine: bothSLs.join(', '),
      serviceLines: bothSLs,
    }),
  });
  ok('the accept still completes', goneRes.ok, `HTTP ${goneRes.status}`);
  const goneRow = (await pool.query(
    `SELECT monthly_impact, annual_impact FROM adjustment_rules WHERE name = $1`,
    [goneName])).rows[0];
  ok('a rule was created for the unresolvable scope', !!goneRow);
  if (goneRow) {
    ok('its stored impact is zero, not the portfolio-wide fallback',
      Math.abs(Number(goneRow.monthly_impact)) < 0.5,
      `monthly_impact=${goneRow.monthly_impact}, portfolio-wide is ${portfolioWide.monthlyImpact}`);
    apart('and is definitively not the portfolio-wide figure',
      Number(goneRow.monthly_impact), portfolioWide.monthlyImpact);
  }

  // ── an expired run is refused, not silently widened ──────────────────────
  // Without the cached run the campus scope is unrecoverable. The old
  // behaviour saved a portfolio-wide rule from a region-scoped card.
  console.log('\n── an expired suggestion run is refused ──');
  await pool.query(`DELETE FROM ai_suggestion_runs WHERE client_id = $1`, [CLIENT]);
  const expiredName = `${RULE_NAME} (expired)`;
  const expiredRes = await fetch(`${BASE}/api/adjustment-rules/suggestions/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      suggestionId: '99999999-8888-7777-6666-555555555555',
      name: expiredName,
      description: RULE_SENTENCE,
      locationId: null,
      serviceLine: bothSLs.join(', '),
      serviceLines: bothSLs,
    }),
  });
  ok('accepting a suggestion whose run has expired is rejected',
    expiredRes.status === 409, `got HTTP ${expiredRes.status}`);
  const expiredRows = await pool.query(
    `SELECT id FROM adjustment_rules WHERE name = $1`, [expiredName]);
  ok('...and no portfolio-wide rule is left behind',
    expiredRows.rows.length === 0, `${expiredRows.rows.length} rule(s) created`);

  // ── single-campus runs need no cache and must stay scoped ────────────────
  console.log('\n── a single-campus suggestion stores its own campus figure ──');
  const singleName = `${RULE_NAME} (single)`;
  const singleExpected = computeQualifiedRuleImpact(
    ctx,
    { action: parsed.action, trigger: parsed.trigger, serviceLines: bothSLs, locationId: locIds.get(SMALL_A)! },
    { locationIds: [locIds.get(SMALL_A)!] },
  );
  const singleRes = await fetch(`${BASE}/api/adjustment-rules/suggestions/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      suggestionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: singleName,
      description: RULE_SENTENCE,
      locationId: locIds.get(SMALL_A)!,
      serviceLine: bothSLs.join(', '),
      serviceLines: bothSLs,
    }),
  });
  ok('a single-campus accept succeeds without a cached run',
    singleRes.ok, `HTTP ${singleRes.status}`);
  const singleRow = (await pool.query(
    `SELECT monthly_impact FROM adjustment_rules WHERE name = $1`, [singleName])).rows[0];
  ok('the single-campus rule was created', !!singleRow);
  if (singleRow) {
    near('its stored impact is the one campus, computed the same way',
      Number(singleRow.monthly_impact), singleExpected.monthlyImpact);
    apart('and is not the two-campus figure',
      Number(singleRow.monthly_impact), expected.monthlyImpact);
  }

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await cleanup(); } catch {}
  await pool.end();
  process.exit(1);
});
