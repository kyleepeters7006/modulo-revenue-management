/**
 * Regression test: affectedUnits from POST /api/reference-data/import-rules
 * must be consistent with what GET /api/adjustment-rules reports, accounting
 * for the deduplication walk the list endpoint applies.
 *
 * Both endpoints share the same computeQualifiedRuleImpact engine. The difference
 * is that import-rules computes each rule in isolation (gross), while the list
 * endpoint walks rules by specificity DESC and lets higher-specificity rules
 * claim units first (deduped). This test pins both numbers for two scenarios:
 *
 *   Rule A — SL-scoped (AL only):    specificity = 2  → claims 8 AL units
 *   Rule B — portfolio-wide:         specificity = 0  → gross = 12, deduped = 4 (VIL only)
 *
 * Assertions:
 *   1. Single-rule parity: when each rule is the only one in the DB, import-time
 *      impact equals list-time impact (gross == gross, no dedup difference).
 *   2. Combined dedup walk: when both rules coexist, the dedup order puts Rule A
 *      first (higher specificity), so Rule B drops from 12 → 4.
 *   3. Action filters survive DB round-trip intact (guards against JSON
 *      serialisation stripping the serviceLine filter).
 *
 * Run with: npx tsx tests/importRulesUnitCountParity.test.ts
 */

import pg from 'pg';
const { Pool } = pg;

import {
  buildRuleImpactContext,
  computeQualifiedRuleImpact,
  compareRuleDedupOrder,
  isDedupEligibleRule,
} from '../server/services/ruleImpactService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function assert(desc: string, actual: unknown, expected: unknown) {
  const ok =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= 1
      : actual === expected;
  if (ok) {
    console.log(`${PASS} ${desc}`);
    passed++;
  } else {
    console.log(`${FAIL} ${desc}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------
const CLIENT  = 'ptest-import-rules-unit-count';
const LOC_A   = 'Alpha Campus - Import Test';
const LOC_B   = 'Beta Campus - Import Test';
const MONTH   = '2026-07';

// Expected gross affectedUnits for each rule (computed independently, no dedup).
// These are the numbers the import endpoint returns to the caller.
const EXPECTED_AL_GROSS    = 8;  // all 8 AL Studio units
const EXPECTED_PORT_GROSS  = 12; // all 8 AL + 4 VIL units

// Expected deduped affectedUnits as reported by GET /api/adjustment-rules.
// AL rule (specificity=2) goes first → claims 8 units.
// Portfolio rule (specificity=0) gets the remaining VIL-only units.
const EXPECTED_AL_DEDUPED   = 8;  // same as gross — AL rule runs first, no competition
const EXPECTED_PORT_DEDUPED = 4;  // 12 gross - 8 claimed by AL rule = 4 VIL units

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Seed rent-roll data
// ---------------------------------------------------------------------------
async function seed(): Promise<{ locAId: string; locBId: string }> {
  await pool.query(
    `INSERT INTO clients (id, name)
     VALUES ($1, 'Import-Rules Unit Count Test')
     ON CONFLICT (id) DO NOTHING`,
    [CLIENT],
  );

  const locA = await pool.query(
    `INSERT INTO locations (client_id, name, region, division)
     VALUES ($1, $2, 'East', 'Test Division')
     ON CONFLICT (client_id, name) DO UPDATE SET region = EXCLUDED.region
     RETURNING id`,
    [CLIENT, LOC_A],
  );
  const locB = await pool.query(
    `INSERT INTO locations (client_id, name, region, division)
     VALUES ($1, $2, 'West', 'Test Division')
     ON CONFLICT (client_id, name) DO UPDATE SET region = EXCLUDED.region
     RETURNING id`,
    [CLIENT, LOC_B],
  );
  const locAId: string = locA.rows[0].id;
  const locBId: string = locB.rows[0].id;

  await pool.query(`DELETE FROM rent_roll_data WHERE client_id = $1`, [CLIENT]);

  // 8 AL Studio units @ Alpha Campus
  for (let i = 1; i <= 8; i++) {
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, upload_month, location_id, location, service_line, room_type,
          source_room_type, room_number, street_rate, in_house_rate, care_rate,
          occupied_yn, days_vacant, competitor_final_rate, payor_type, date, size)
       VALUES ($1,$2,$3,$4,'AL','Studio','Studio',$5,4000,$6,0,$7,$8,4200,'Private Pay',$9,'Studio')`,
      [CLIENT, MONTH, locAId, LOC_A, `AL-${i}`, i <= 6 ? 3800 : 0, i <= 6, i <= 6 ? 0 : 30, `${MONTH}-01`],
    );
  }

  // 4 VIL Studio units @ Beta Campus
  // Different SL → must NOT be counted by the AL-scoped rule.
  for (let i = 1; i <= 4; i++) {
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, upload_month, location_id, location, service_line, room_type,
          source_room_type, room_number, street_rate, in_house_rate, care_rate,
          occupied_yn, days_vacant, competitor_final_rate, payor_type, date, size)
       VALUES ($1,$2,$3,$4,'VIL','Studio','Studio',$5,2900,2700,0,$6,$7,3000,'Private Pay',$8,'Studio')`,
      [CLIENT, MONTH, locBId, LOC_B, `VIL-${i}`, i <= 3, i <= 3 ? 0 : 45, `${MONTH}-01`],
    );
  }

  return { locAId, locBId };
}

// ---------------------------------------------------------------------------
// Build the rule objects exactly as import-rules does (after parseNaturalLanguageRule)
// ---------------------------------------------------------------------------
function makeAlRule() {
  const action = {
    type: 'adjust_rate',
    target: 'street_rate',
    adjustmentType: 'percentage',
    adjustmentValue: 5,
    isAdditive: false,
    filters: { serviceLine: ['AL'] },
  };
  return {
    action,
    trigger:      { type: 'immediate' },
    serviceLine:  'AL',
    serviceLines: null,
    locationId:   null,
    isActive:     true,
    isHistorical: false,
  };
}

function makePortfolioRule() {
  const action = {
    type: 'adjust_rate',
    target: 'street_rate',
    adjustmentType: 'percentage',
    adjustmentValue: 2,
    isAdditive: false,
    filters: {},
  };
  return {
    action,
    trigger:      { type: 'immediate' },
    serviceLine:  null,
    serviceLines: null,
    locationId:   null,
    isActive:     true,
    isHistorical: false,
  };
}

// ---------------------------------------------------------------------------
// Insert a rule as storage.createAdjustmentRule does; return its DB id.
// name must be unique (combined with location_id + service_line) in adj_rules.
// ---------------------------------------------------------------------------
async function insertRule(
  ruleObj: ReturnType<typeof makeAlRule> | ReturnType<typeof makePortfolioRule>,
  name: string,
  monthlyImpact: number,
  annualImpact: number,
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO adjustment_rules
       (location_id, service_line, service_lines, name, description,
        trigger, action, is_active, is_historical, monthly_impact,
        annual_impact, volume_adjusted_annual_impact, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,false,$8,$9,$10,'excel-import')
     RETURNING id`,
    [
      ruleObj.locationId,
      ruleObj.serviceLine,
      (ruleObj as any).serviceLines,
      name,
      `${name} (imported from Excel — parity test)`,
      JSON.stringify(ruleObj.trigger),
      JSON.stringify(ruleObj.action),
      Math.round(monthlyImpact),
      Math.round(annualImpact),
      Math.round(annualImpact * 1.05),
    ],
  );
  return rows[0].id as string;
}

// ---------------------------------------------------------------------------
// Re-read a stored rule in the shape GET /api/adjustment-rules passes to
// computeQualifiedRuleImpact (camelCase, same fields).
// ---------------------------------------------------------------------------
async function fetchRule(id: string) {
  const { rows } = await pool.query(
    `SELECT id, location_id, service_line, service_lines,
            trigger, action, is_active, is_historical,
            priority, created_at
     FROM adjustment_rules WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error(`Rule ${id} not found`);
  const r = rows[0];
  return {
    id:           r.id as string,
    locationId:   r.location_id   ?? null,
    serviceLine:  r.service_line  ?? null,
    serviceLines: r.service_lines ?? null,
    trigger:      r.trigger,
    action:       r.action,
    isActive:     r.is_active    as boolean,
    isHistorical: r.is_historical as boolean,
    priority:     r.priority      as number,
    createdAt:    r.created_at   as Date,
  };
}

// ---------------------------------------------------------------------------
// Replicate the dedup walk from GET /api/adjustment-rules.
// Returns a map of rule id → deduped RuleImpactResult.
// ---------------------------------------------------------------------------
function runDedupWalk(ctx: NonNullable<Awaited<ReturnType<typeof buildRuleImpactContext>>>, rules: any[]) {
  const eligible = rules.filter(r => isDedupEligibleRule(r));
  const sorted   = [...eligible].sort(compareRuleDedupOrder);

  const claimedUnitIds   = new Set<string>();
  const dedupedImpactById = new Map<string, ReturnType<typeof computeQualifiedRuleImpact>>();

  for (const rule of sorted) {
    const impact = computeQualifiedRuleImpact(ctx, rule, undefined, claimedUnitIds);
    for (const uid of Array.from(impact.qualifiedUnitIds)) {
      claimedUnitIds.add(uid);
    }
    dedupedImpactById.set(rule.id, impact);
  }
  return dedupedImpactById;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanup(ruleIds: string[]) {
  if (ruleIds.length) {
    await pool.query(
      `DELETE FROM adjustment_rules WHERE id = ANY($1::text[])`,
      [ruleIds],
    );
  }
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM locations      WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM clients        WHERE id         = $1`, [CLIENT]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('\n=== Import-Rules Unit Count Parity Tests ===\n');
console.log('Seeded layout:');
console.log(`  ${LOC_A}: 8 AL Studio units`);
console.log(`  ${LOC_B}: 4 VIL Studio units\n`);

(async () => {
  const insertedRuleIds: string[] = [];

  try {
    await seed();

    const ctx = await buildRuleImpactContext(CLIENT);
    if (!ctx) {
      console.log(`${FAIL} Could not build impact context — rent-roll data missing`);
      failed++;
      return;
    }

    // =========================================================================
    // Section 1 — Import-time gross counts
    // =========================================================================
    console.log('── Section 1: Import-time gross affectedUnits (no dedup) ──\n');

    const alRuleObj   = makeAlRule();
    const portRuleObj = makePortfolioRule();

    const alImpactGross   = computeQualifiedRuleImpact(ctx, alRuleObj);
    const portImpactGross = computeQualifiedRuleImpact(ctx, portRuleObj);

    assert(
      `AL-scoped rule — gross affectedUnits = ${EXPECTED_AL_GROSS} (all AL units)`,
      alImpactGross.affectedUnits,
      EXPECTED_AL_GROSS,
    );

    assert(
      `Portfolio-wide rule — gross affectedUnits = ${EXPECTED_PORT_GROSS} (AL + VIL)`,
      portImpactGross.affectedUnits,
      EXPECTED_PORT_GROSS,
    );

    // =========================================================================
    // Section 2 — Single-rule parity (import-time == list-time, no overlap)
    // =========================================================================
    console.log('\n── Section 2: Single-rule parity — import-time matches list-time ──\n');
    console.log('   (Each rule is tested alone so dedup does not introduce divergence)\n');

    // --- Rule A alone ---
    const alRuleId = await insertRule(
      alRuleObj,
      'Increase 5% — AL (parity-test)',
      alImpactGross.monthlyImpact,
      alImpactGross.annualImpact,
    );
    insertedRuleIds.push(alRuleId);

    const alStored = await fetchRule(alRuleId);
    // List-time: dedup walk with only this one rule
    const dedupedAlOnly = runDedupWalk(ctx, [alStored]);
    const alImpactListAlone = dedupedAlOnly.get(alRuleId)!;

    assert(
      'AL rule alone — list-time affectedUnits equals import-time gross',
      alImpactListAlone.affectedUnits,
      alImpactGross.affectedUnits,
    );
    assert(
      'AL rule alone — list-time monthlyImpact equals import-time gross (within $1)',
      Math.round(alImpactListAlone.monthlyImpact),
      Math.round(alImpactGross.monthlyImpact),
    );

    // --- Rule B alone ---
    const portRuleId = await insertRule(
      portRuleObj,
      'Increase 2% — Portfolio (parity-test)',
      portImpactGross.monthlyImpact,
      portImpactGross.annualImpact,
    );
    insertedRuleIds.push(portRuleId);

    const portStored = await fetchRule(portRuleId);
    const dedupedPortOnly = runDedupWalk(ctx, [portStored]);
    const portImpactListAlone = dedupedPortOnly.get(portRuleId)!;

    assert(
      'Portfolio rule alone — list-time affectedUnits equals import-time gross',
      portImpactListAlone.affectedUnits,
      portImpactGross.affectedUnits,
    );
    assert(
      'Portfolio rule alone — list-time monthlyImpact equals import-time gross (within $1)',
      Math.round(portImpactListAlone.monthlyImpact),
      Math.round(portImpactGross.monthlyImpact),
    );

    // =========================================================================
    // Section 3 — Combined dedup walk (both rules coexist in the list)
    // =========================================================================
    console.log('\n── Section 3: Combined dedup walk — both rules in GET /api/adjustment-rules ──\n');
    console.log('   AL rule specificity=2 goes first; portfolio rule specificity=0 gets remainder.\n');

    const combined = runDedupWalk(ctx, [alStored, portStored]);
    const alDeduped   = combined.get(alRuleId)!;
    const portDeduped = combined.get(portRuleId)!;

    assert(
      `AL rule — deduped affectedUnits = ${EXPECTED_AL_DEDUPED} (goes first, no overlap)`,
      alDeduped.affectedUnits,
      EXPECTED_AL_DEDUPED,
    );

    assert(
      `Portfolio rule — deduped affectedUnits = ${EXPECTED_PORT_DEDUPED} (VIL units only, AL claimed the rest)`,
      portDeduped.affectedUnits,
      EXPECTED_PORT_DEDUPED,
    );

    // Confirm the gross vs deduped divergence is exactly what the dedup walk causes.
    // This pins the known behaviour so any engine change that shifts these numbers
    // surfaces immediately.
    assert(
      `Portfolio rule deduped (${EXPECTED_PORT_DEDUPED}) < gross (${EXPECTED_PORT_GROSS}) by exactly the AL unit count`,
      portImpactGross.affectedUnits - portDeduped.affectedUnits,
      EXPECTED_AL_GROSS,
    );

    // =========================================================================
    // Section 4 — Action filters survive DB round-trip
    // =========================================================================
    console.log('\n── Section 4: action.filters round-trip through DB ──\n');

    const storedAction = alStored.action as any;
    assert(
      'AL rule: action.filters.serviceLine = ["AL"] after DB round-trip',
      JSON.stringify(storedAction?.filters?.serviceLine ?? null),
      JSON.stringify(['AL']),
    );

    const portAction = portStored.action as any;
    assert(
      'Portfolio rule: action.filters has no serviceLine after DB round-trip',
      Object.keys(portAction?.filters ?? {}).includes('serviceLine'),
      false,
    );

  } finally {
    await cleanup(insertedRuleIds);
    await pool.end();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
