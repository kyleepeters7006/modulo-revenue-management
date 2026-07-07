/**
 * Persistence integration test for AI-tab rule scope.
 *
 * Verifies that when the AI tab sends `serviceLines: ["AL", "HC"]` in the POST
 * body, the scope actually reaches the database — catching silent blank-scope
 * saves where serviceLines is silently dropped before storage.
 *
 * Mirrors the exact flow in POST /api/adjustment-rules:
 *   1. resolvePostServiceLineScope maps the body fields to storeServiceLine /
 *      storeServiceLines
 *   2. storage.createAdjustmentRule is called with those values
 *   3. The returned (and stored) record is read back and asserted
 *
 * Run with:  npx tsx server/services/__tests__/adjustmentRules.persistence.test.ts
 */
import { storage } from "../../storage";
import { resolvePostServiceLineScope } from "../adjustmentRulesService";

const TEST_RULE_NAME = `__test_ai_tab_scope_${Date.now()}`;

let passed = 0;
let failed = 0;
let createdRuleId: string | null = null;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

async function cleanup() {
  if (createdRuleId) {
    try {
      await storage.deleteAdjustmentRule(createdRuleId);
      console.log(`\n  (cleaned up test rule ${createdRuleId})`);
    } catch {
      console.warn(`\n  Warning: failed to delete test rule ${createdRuleId}`);
    }
    createdRuleId = null;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\nadjustmentRules persistence — AI tab scope saves correctly\n");

await test("AI tab POST body with 2 SLs: createAdjustmentRule persists serviceLines=['AL','HC']", async () => {
  // Step 1 — mirrors route handler: resolve the AI-tab POST body
  const aiTabBody = { serviceLines: ["AL", "HC"] };
  const { storeServiceLine, storeServiceLines } = resolvePostServiceLineScope(aiTabBody);

  // Step 2 — mirrors route handler: call storage.createAdjustmentRule with resolved args
  const createdRule = await storage.createAdjustmentRule({
    name: TEST_RULE_NAME,
    description: "AI-tab integration test rule — safe to delete",
    serviceLine: storeServiceLine,
    serviceLines: storeServiceLines,
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
    isActive: false, // inactive so it never affects real pricing
    priority: 0,
    createdBy: "test",
    monthlyImpact: 0,
    annualImpact: 0,
    volumeAdjustedAnnualImpact: 0,
  } as any);

  createdRuleId = createdRule.id;

  // Step 3 — verify the returned record has serviceLines populated
  assert(
    createdRule.serviceLines !== null,
    `serviceLines is null on the created rule — blank-scope save detected`
  );
  assert(
    Array.isArray(createdRule.serviceLines) && createdRule.serviceLines.length === 2,
    `Expected serviceLines.length=2, got ${JSON.stringify(createdRule.serviceLines)}`
  );
  assert(
    JSON.stringify(createdRule.serviceLines) === JSON.stringify(["AL", "HC"]),
    `Expected serviceLines=["AL","HC"], got ${JSON.stringify(createdRule.serviceLines)}`
  );
  assert(
    createdRule.serviceLine === null,
    `Expected serviceLine=null (multi-SL path), got ${JSON.stringify(createdRule.serviceLine)}`
  );
});

await test("stored rule is readable from DB and serviceLines survives the round-trip", async () => {
  // Re-fetch all rules and find the test record to confirm DB round-trip
  const allRules = await storage.getAdjustmentRules();
  const savedRule = allRules.find(r => r.name === TEST_RULE_NAME);

  assert(
    savedRule !== undefined,
    `Test rule "${TEST_RULE_NAME}" not found in DB — createAdjustmentRule may not have committed`
  );

  assert(
    savedRule!.serviceLines !== null,
    `serviceLines is null on the DB-fetched record — blank-scope save confirmed`
  );

  assert(
    JSON.stringify(savedRule!.serviceLines) === JSON.stringify(["AL", "HC"]),
    `DB round-trip failed: expected ["AL","HC"], got ${JSON.stringify(savedRule!.serviceLines)}`
  );

  assert(
    savedRule!.serviceLine === null,
    `serviceLine should be null on multi-SL rule, got ${JSON.stringify(savedRule!.serviceLine)}`
  );
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

await cleanup();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(48)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} persistence tests passed.\n`);
  process.exit(0);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed.\n`);
  process.exit(1);
}
