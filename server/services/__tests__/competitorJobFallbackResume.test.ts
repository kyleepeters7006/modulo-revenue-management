/**
 * DB integration tests for the care-rate fallback accumulator resume safety.
 *
 * Verifies that `careRateFallbackCampuses` is persisted to and read from the
 * real `competitor_rate_jobs` table correctly — including the resume scenario
 * where a server restart occurs after one or more batches have been committed.
 *
 * This exercises the actual DB column (JSONB round-trip), the per-batch atomic
 * write, and the seed-from-DB logic that `processJob` uses on resume.
 *
 * Run with:
 *   npx tsx server/services/__tests__/competitorJobFallbackResume.test.ts
 */

import { db } from "../../db.js";
import { competitorRateJobs } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";

// ── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const createdJobIds: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓  ${name}`); passed++; })
    .catch((e: any) => {
      console.error(`  ✗  ${name}`);
      console.error(`       ${e?.message ?? e}`);
      failed++;
    });
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDeepEq(actual: Record<string, number>, expected: Record<string, number>, label: string) {
  const aKeys = Object.keys(actual).sort();
  const eKeys = Object.keys(expected).sort();
  if (JSON.stringify(aKeys) !== JSON.stringify(eKeys))
    throw new Error(`${label} keys: expected ${JSON.stringify(eKeys)}, got ${JSON.stringify(aKeys)}`);
  for (const k of eKeys) {
    if (actual[k] !== expected[k])
      throw new Error(`${label}["${k}"]: expected ${expected[k]}, got ${actual[k]}`);
  }
}

function assertNull(val: unknown, label: string) {
  if (val !== null && val !== undefined)
    throw new Error(`${label}: expected null, got ${JSON.stringify(val)}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal test job row and track it for cleanup. */
async function createTestJob(overrides: Partial<typeof competitorRateJobs.$inferInsert> = {}) {
  const [row] = await db.insert(competitorRateJobs).values({
    uploadMonth: "2099-01", // far-future month avoids collisions with real jobs
    clientId: "__test__",
    status: "running",
    totalUnits: 10,
    processedUnits: 0,
    updatedUnits: 0,
    skippedUnits: 0,
    errorCount: 0,
    ...overrides,
  }).returning();
  createdJobIds.push(row.id);
  return row;
}

/**
 * Mirror the accumulator-seeding logic from processJob.
 * In production this runs at the top of processJob when a resumed job row
 * already has careRateFallbackCampuses populated from earlier batches.
 */
function seedAccumulatorFromRow(
  row: typeof competitorRateJobs.$inferSelect
): Map<string, number> {
  const acc = new Map<string, number>();
  const existing = row.careRateFallbackCampuses as Record<string, number> | null;
  if (existing) {
    Object.entries(existing).forEach(([campus, count]) => acc.set(campus, count));
  }
  return acc;
}

/**
 * Mirror the per-batch atomic write from processBatch.
 * Merges batchFallbacks into the accumulator and writes cursor + fallback JSON
 * in a single UPDATE — the atomic guarantee prevents cursor advancing without
 * the matching fallback snapshot being committed.
 */
async function applyBatchToDb(
  jobId: string,
  lastProcessedId: string,
  batchFallbacks: Map<string, number>,
  acc: Map<string, number>
) {
  batchFallbacks.forEach((count, campus) => {
    acc.set(campus, (acc.get(campus) ?? 0) + count);
  });
  const merged = acc.size > 0 ? Object.fromEntries(acc) : null;
  await db.update(competitorRateJobs)
    .set({ careRateFallbackCampuses: merged, lastProcessedId, updatedAt: new Date() })
    .where(eq(competitorRateJobs.id, jobId));
}

/** Read the job row back from the DB. */
async function fetchJob(jobId: string) {
  const [row] = await db.select().from(competitorRateJobs).where(eq(competitorRateJobs.id, jobId)).limit(1);
  return row;
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("\ncompetitorJobFallbackResume — DB integration tests\n");

// ── 1. JSONB round-trip: null when no fallbacks ───────────────────────────

await test("New job row has null careRateFallbackCampuses (no batches yet)", async () => {
  const job = await createTestJob();
  const fetched = await fetchJob(job.id);
  assertNull(fetched.careRateFallbackCampuses, "careRateFallbackCampuses");
});

// ── 2. Batch 1 write: JSONB is persisted correctly ────────────────────────

await test("Batch write persists careRateFallbackCampuses to the DB", async () => {
  const job = await createTestJob();
  const acc = new Map<string, number>();

  await applyBatchToDb(job.id, "unit-001", new Map([["Campus A", 3]]), acc);

  const fetched = await fetchJob(job.id);
  const persisted = fetched.careRateFallbackCampuses as Record<string, number>;
  assertDeepEq(persisted, { "Campus A": 3 }, "after batch 1");
  // Cursor also advanced atomically
  assertEq(fetched.lastProcessedId, "unit-001", "lastProcessedId after batch 1");
});

// ── 3. Resume: seeding from DB gives the correct accumulator ─────────────

await test("Resume: seedAccumulatorFromRow correctly seeds counts from DB", async () => {
  // Simulate: batch 1 committed {"Campus A": 3} to the DB, then server restarted
  const job = await createTestJob({ careRateFallbackCampuses: { "Campus A": 3 } as any });
  const fetched = await fetchJob(job.id);

  // processJob does this on resume
  const acc = seedAccumulatorFromRow(fetched);
  assertEq(acc.size, 1, "accumulator size after seed");
  assertEq(acc.get("Campus A"), 3, "Campus A seeded count");
});

// ── 4. Resume + batch 2: counts are merged correctly end-to-end ───────────

await test("Resume + batch 2: complete fallback report after interruption", async () => {
  // Simulate: batch 1 ran and committed {"Campus A": 3}, server restarted
  const job = await createTestJob({ careRateFallbackCampuses: { "Campus A": 3 } as any, lastProcessedId: "unit-003" });
  const fetched = await fetchJob(job.id);

  // On resume, processJob seeds the accumulator from the DB
  const acc = seedAccumulatorFromRow(fetched);
  assertEq(acc.get("Campus A"), 3, "seeded Campus A");

  // Batch 2 runs on the resumed process: Campus A has 2 more, Campus B has 1
  await applyBatchToDb(job.id, "unit-005", new Map([["Campus A", 2], ["Campus B", 1]]), acc);

  const finalRow = await fetchJob(job.id);
  const finalFallbacks = finalRow.careRateFallbackCampuses as Record<string, number>;
  assertDeepEq(finalFallbacks, { "Campus A": 5, "Campus B": 1 }, "final merged fallbacks");
  assertEq(finalRow.lastProcessedId, "unit-005", "cursor after batch 2");
});

// ── 5. Batch with no fallbacks keeps null ─────────────────────────────────

await test("Batch where all campuses have care rates keeps careRateFallbackCampuses null", async () => {
  const job = await createTestJob();
  const acc = new Map<string, number>();

  // No fallback campuses in this batch
  await applyBatchToDb(job.id, "unit-010", new Map(), acc);

  const fetched = await fetchJob(job.id);
  assertNull(fetched.careRateFallbackCampuses, "careRateFallbackCampuses stays null");
});

// ── 6. Three batches, counts accumulate across all ────────────────────────

await test("Three consecutive batches: all fallback counts present in final DB value", async () => {
  const job = await createTestJob();
  const acc = new Map<string, number>();

  await applyBatchToDb(job.id, "unit-100", new Map([["Campus X", 10]]), acc);
  await applyBatchToDb(job.id, "unit-200", new Map([["Campus X", 5], ["Campus Y", 2]]), acc);
  await applyBatchToDb(job.id, "unit-300", new Map([["Campus X", 3]]), acc);

  const finalRow = await fetchJob(job.id);
  const finalFallbacks = finalRow.careRateFallbackCampuses as Record<string, number>;
  assertDeepEq(finalFallbacks, { "Campus X": 18, "Campus Y": 2 }, "three-batch totals");
  assertEq(finalRow.lastProcessedId, "unit-300", "cursor after batch 3");
});

// ── Cleanup ───────────────────────────────────────────────────────────────

if (createdJobIds.length > 0) {
  try {
    for (const id of createdJobIds) {
      await db.delete(competitorRateJobs).where(eq(competitorRateJobs.id, id));
    }
    console.log(`\n  (cleaned up ${createdJobIds.length} test job row(s))`);
  } catch (e: any) {
    console.warn(`  Warning: cleanup failed — ${e.message}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
