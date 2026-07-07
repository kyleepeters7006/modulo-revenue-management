/**
 * HTTP route integration test for AI-tab rule scope persistence.
 *
 * Calls the ACTUAL `POST /api/adjustment-rules` endpoint — the same path the
 * rule-designer AI tab hits — with `serviceLines: ["AL", "HC"]` in the body
 * and verifies the returned (and DB-persisted) rule record has those service
 * lines set (not null/blank).
 *
 * This is the primary regression guard for silent blank-scope saves: any bug in
 * route wiring that drops `serviceLines` before storage will cause this test to
 * fail with a clear message.
 *
 * Run with:  npx tsx server/services/__tests__/adjustmentRules.route.test.ts
 */

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

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
      await fetch(`${BASE_URL}/api/adjustment-rules/${createdRuleId}`, {
        method: "DELETE",
      });
      console.log(`\n  (deleted test rule ${createdRuleId})`);
    } catch {
      console.warn(`\n  Warning: failed to delete test rule ${createdRuleId}`);
    }
    createdRuleId = null;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log(`\nadjustmentRules HTTP route — AI tab scope saves correctly (${BASE_URL})\n`);

await test("POST /api/adjustment-rules with serviceLines=['AL','HC'] returns rule with those SLs", async () => {
  // AI-tab POST body: description + serviceLines (same shape as rule-designer.tsx)
  const body = {
    description: "increase rate by 5%",
    preview: false,
    locationId: null,
    serviceLines: ["AL", "HC"],
  };

  const res = await fetch(`${BASE_URL}/api/adjustment-rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert(
    res.ok,
    `POST /api/adjustment-rules returned ${res.status} ${res.statusText}`
  );

  const data = await res.json() as any;
  const rule = data?.rule;

  assert(
    rule !== undefined && rule !== null,
    `Response did not contain a "rule" field. Got: ${JSON.stringify(data).slice(0, 200)}`
  );

  createdRuleId = rule.id;

  // Primary assertion: serviceLines must be the 2 selected SLs, not null/blank
  assert(
    rule.serviceLines !== null,
    `rule.serviceLines is null — blank-scope save: rule will fire for ALL service lines`
  );
  assert(
    Array.isArray(rule.serviceLines) && rule.serviceLines.length === 2,
    `Expected rule.serviceLines.length=2, got ${JSON.stringify(rule.serviceLines)}`
  );
  assert(
    JSON.stringify(rule.serviceLines) === JSON.stringify(["AL", "HC"]),
    `Expected serviceLines=["AL","HC"], got ${JSON.stringify(rule.serviceLines)}`
  );
  // serviceLine (legacy single-SL column) must be null when multi-SL path is used
  assert(
    rule.serviceLine === null,
    `Expected rule.serviceLine=null (multi-SL path), got ${JSON.stringify(rule.serviceLine)}`
  );
});

await test("GET /api/adjustment-rules returns the created rule with serviceLines intact", async () => {
  if (!createdRuleId) throw new Error("Skipped — previous test did not create a rule");

  const res = await fetch(`${BASE_URL}/api/adjustment-rules`);
  assert(res.ok, `GET /api/adjustment-rules returned ${res.status}`);

  const rules = await res.json() as any[];
  const saved = Array.isArray(rules)
    ? rules.find((r: any) => r.id === createdRuleId)
    : undefined;

  assert(
    saved !== undefined,
    `Created rule ${createdRuleId} not found in GET /api/adjustment-rules response`
  );

  assert(
    JSON.stringify(saved.serviceLines) === JSON.stringify(["AL", "HC"]),
    `DB round-trip failed: expected ["AL","HC"], got ${JSON.stringify(saved.serviceLines)}`
  );
  assert(
    saved.serviceLine === null,
    `Expected serviceLine=null, got ${JSON.stringify(saved.serviceLine)}`
  );
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

await cleanup();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(48)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} route tests passed.\n`);
  process.exit(0);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed.\n`);
  process.exit(1);
}
