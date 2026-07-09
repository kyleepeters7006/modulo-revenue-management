/**
 * Unit tests for the competitive-survey SFTP import trigger path.
 *
 * Specifically verifies that `triggerPostImportActions` calls
 * `startCompetitorRateJob` with the correct `clientId` and `targetMonth`
 * when `datasetType === "competitive_survey"`, and that it does NOT call
 * the job starter for other dataset types.
 *
 * Run with:
 *   npx tsx server/services/__tests__/scheduledImportCompetitorTrigger.test.ts
 */

import { triggerPostImportActions } from "../scheduledImportService.js";

// ── Minimal test helpers ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓  ${name}`);
      passed++;
    })
    .catch((e: any) => {
      console.error(`  ✗  ${name}`);
      console.error(`       ${e?.message ?? e}`);
      failed++;
    });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a spy that records every call made to it. */
function makeSpy() {
  const calls: Array<{ targetMonth: string; clientId: string }> = [];
  const fn = async (targetMonth: string, clientId: string) => {
    calls.push({ targetMonth, clientId });
    return { jobId: "test-job-id", status: "started" };
  };
  return { fn, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\ncompetitive-survey SFTP trigger — triggerPostImportActions\n");

// T1: competitive_survey import → startCompetitorRateJob called with correct args
await test("competitive_survey import calls startCompetitorRateJob(targetMonth, clientId)", async () => {
  const spy = makeSpy();

  await triggerPostImportActions("trilogy", "competitive_survey", "2025-11", {
    startCompetitorRateJob: spy.fn,
  });

  assert(spy.calls.length === 1, `Expected exactly 1 call, got ${spy.calls.length}`);
  assertEqual(spy.calls[0].targetMonth, "2025-11", "targetMonth");
  assertEqual(spy.calls[0].clientId, "trilogy", "clientId");
});

// T2: Different clientId & targetMonth are forwarded faithfully
await test("competitive_survey forwards different clientId and targetMonth correctly", async () => {
  const spy = makeSpy();

  await triggerPostImportActions("glm", "competitive_survey", "2026-03", {
    startCompetitorRateJob: spy.fn,
  });

  assert(spy.calls.length === 1, `Expected exactly 1 call, got ${spy.calls.length}`);
  assertEqual(spy.calls[0].targetMonth, "2026-03", "targetMonth");
  assertEqual(spy.calls[0].clientId, "glm", "clientId");
});

// T3: rent_roll import → startCompetitorRateJob must NOT be called.
//     Inject a startPricingJob stub so the rent-roll path stays fully isolated
//     (no real DB work, no background job, deterministic exit).
await test("rent_roll import does NOT call startCompetitorRateJob", async () => {
  const competitorSpy = makeSpy();
  const pricingJobCalls: Array<{ targetMonth: string; clientId: string }> = [];

  await triggerPostImportActions("trilogy", "rent_roll", "2025-11", {
    startCompetitorRateJob: competitorSpy.fn,
    startPricingJob: async (targetMonth, clientId) => {
      pricingJobCalls.push({ targetMonth, clientId });
      return "mock-pricing-job-id";
    },
  });

  assert(competitorSpy.calls.length === 0, `startCompetitorRateJob must NOT be called for rent_roll; got ${competitorSpy.calls.length} call(s)`);
  // Bonus: verify the pricing job stub WAS invoked (confirms rent-roll branch ran)
  assert(pricingJobCalls.length === 1, `startPricingJob should be called once for rent_roll; got ${pricingJobCalls.length}`);
  assertEqual(pricingJobCalls[0].targetMonth, "2025-11", "pricing job targetMonth");
  assertEqual(pricingJobCalls[0].clientId, "trilogy", "pricing job clientId");
});

// T4: unknown dataset type → startCompetitorRateJob must NOT be called
await test("unknown dataset type does NOT call startCompetitorRateJob", async () => {
  const spy = makeSpy();

  await triggerPostImportActions("demo", "keystats", "2025-11", {
    startCompetitorRateJob: spy.fn,
  });

  assert(spy.calls.length === 0, `startCompetitorRateJob must NOT be called for keystats; got ${spy.calls.length} call(s)`);
});

// T5: error thrown by startCompetitorRateJob is non-fatal (function resolves)
await test("error in startCompetitorRateJob is caught and does not propagate", async () => {
  const throwingFn = async (_targetMonth: string, _clientId: string): Promise<{ jobId: string; status: string }> => {
    throw new Error("simulated job service failure");
  };

  // Should resolve without throwing even though the job starter threw.
  await triggerPostImportActions("ssmg", "competitive_survey", "2025-12", {
    startCompetitorRateJob: throwingFn,
  });
  // If we reach here the error was correctly swallowed.
});

// T6: multiple sequential calls each produce their own invocation
await test("two sequential competitive_survey imports each trigger one job", async () => {
  const spy = makeSpy();

  await triggerPostImportActions("trilogy", "competitive_survey", "2025-10", {
    startCompetitorRateJob: spy.fn,
  });
  await triggerPostImportActions("trilogy", "competitive_survey", "2025-11", {
    startCompetitorRateJob: spy.fn,
  });

  assert(spy.calls.length === 2, `Expected 2 calls, got ${spy.calls.length}`);
  assertEqual(spy.calls[0].targetMonth, "2025-10", "first call targetMonth");
  assertEqual(spy.calls[1].targetMonth, "2025-11", "second call targetMonth");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed.\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed.\n`);
  process.exit(1);
}
