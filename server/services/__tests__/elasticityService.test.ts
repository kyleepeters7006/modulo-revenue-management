/**
 * Unit tests for elasticity blending and trend snapshot logic.
 *
 * Covers:
 *   1. computeRawElasticity — pure window math
 *   2. blendElasticityObservation — period-advance idempotency contract
 *
 * Run with:  npx tsx server/services/__tests__/elasticityService.test.ts
 */

import { computeRawElasticity, blendElasticityObservation } from "../elasticityService";
import type { PriorElasticityState } from "../elasticityService";

// ── Minimal test harness (matches pattern used elsewhere in the project) ──────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toBeCloseTo(expected: number, places = 5) {
      const delta = Math.abs(actual - expected);
      if (delta > Math.pow(10, -places)) {
        throw new Error(`Expected ~${expected} (±1e-${places}), got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (!(actual > expected)) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (!(actual < expected)) {
        throw new Error(`Expected ${actual} < ${expected}`);
      }
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMonthlyAgg(avgStreet: number, avgDaysToSell: number, month: string) {
  return { month, avgStreet, avgDaysToSell };
}

// Build 6 monthly agg rows (newest-first) where the rate rose 10% and DTS rose 20%
// across the before→after window, giving elasticity = 0.20 / 0.10 = 2.0.
function sixMonthsWith2xElasticity() {
  // after window (months 0-2): rate = 1100, DTS = 30
  // before window (months 3-5): rate = 1000, DTS = 25
  const afterMonths = [0, 1, 2].map(i => makeMonthlyAgg(1100, 30, `2026-0${6 - i}`));
  const beforeMonths = [3, 4, 5].map(i => makeMonthlyAgg(1000, 25, `2026-0${6 - i}`));
  return [...afterMonths, ...beforeMonths];
}

// ── 1. computeRawElasticity ───────────────────────────────────────────────────

console.log("\ncomputeRawElasticity\n");

test("returns null when only after window is available (< 4 months)", () => {
  const rows = [0, 1, 2].map(i => makeMonthlyAgg(1100, 30, `2026-0${6 - i}`));
  const result = computeRawElasticity(rows);
  expect(result.rawElasticity).toBeNull();
});

test("returns null when rate change is below the 0.5% threshold", () => {
  const after = [0, 1, 2].map(i => makeMonthlyAgg(1000.5, 30, `2026-0${6 - i}`));
  const before = [3, 4, 5].map(i => makeMonthlyAgg(1000, 25, `2026-0${6 - i}`));
  const result = computeRawElasticity([...after, ...before]);
  // rate change = 0.05% < 0.5% threshold
  expect(result.rawElasticity).toBeNull();
});

test("computes elasticity ~2.0 for 10% rate rise / 20% DTS rise", () => {
  const result = computeRawElasticity(sixMonthsWith2xElasticity());
  expect(result.rawElasticity!).toBeCloseTo(2.0);
});

test("populates DTS before/after and rate before/after", () => {
  const result = computeRawElasticity(sixMonthsWith2xElasticity());
  expect(result.daysToSellBefore!).toBeCloseTo(25);
  expect(result.daysToSellAfter!).toBeCloseTo(30);
  expect(result.rateBefore!).toBeCloseTo(1000);
  expect(result.rateAfter!).toBeCloseTo(1100);
  expect(result.daysToSellChange!).toBeCloseTo(5);
});

// ── 2. blendElasticityObservation — initial calculation ──────────────────────

console.log("\nblendElasticityObservation — initial calculation\n");

test("first observation: elasticity = raw, prev = null, sampleSize = 1", () => {
  const result = blendElasticityObservation(2.0, null, "2026-06");
  expect(result.elasticity!).toBeCloseTo(2.0);
  expect(result.prevElasticity).toBeNull();
  expect(result.sampleSize).toBe(1);
});

test("first observation with null raw: all outputs are null / 0", () => {
  const result = blendElasticityObservation(null, null, "2026-06");
  expect(result.elasticity).toBeNull();
  expect(result.prevElasticity).toBeNull();
  expect(result.sampleSize).toBe(0);
});

// ── 3. blendElasticityObservation — period advances ──────────────────────────

console.log("\nblendElasticityObservation — period advances\n");

test("new period: prevElasticity snapshots the old EMA before blending", () => {
  const prior: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: null,
    sampleSize: 1,
    latestSourceMonth: "2026-06",
  };
  const result = blendElasticityObservation(3.0, prior, "2026-07");
  // prev should be the old EMA (2.0), not the new raw
  expect(result.prevElasticity!).toBeCloseTo(2.0);
  // blended: alpha = 1/min(2,12) = 0.5 → 0.5*3 + 0.5*2 = 2.5
  expect(result.elasticity!).toBeCloseTo(2.5);
  expect(result.sampleSize).toBe(2);
});

// Sign convention: trend = prevElasticity − elasticity (positive = improving).
// "Improving" means elasticity fell — demand is less price-sensitive.
test("trend (prev − current) is positive when demand sensitivity decreases (improving)", () => {
  const prior: PriorElasticityState = {
    elasticity: 3.0,
    prevElasticity: null,
    sampleSize: 1,
    latestSourceMonth: "2026-06",
  };
  // raw = 1.0 < prior 3.0 → blended < 3.0 → trend = prev(3.0) − blended > 0
  const result = blendElasticityObservation(1.0, prior, "2026-07");
  const trend = result.prevElasticity! - result.elasticity!;
  expect(trend).toBeGreaterThan(0);
});

test("trend (prev − current) is negative when demand sensitivity increases (worsening)", () => {
  const prior: PriorElasticityState = {
    elasticity: 1.0,
    prevElasticity: null,
    sampleSize: 1,
    latestSourceMonth: "2026-06",
  };
  // raw = 3.0 > prior 1.0 → blended > 1.0 → trend = prev(1.0) − blended < 0
  const result = blendElasticityObservation(3.0, prior, "2026-07");
  const trend = result.prevElasticity! - result.elasticity!;
  expect(trend).toBeLessThan(0);
});

test("new period with null raw: prevElasticity still advances, EMA unchanged", () => {
  const prior: PriorElasticityState = {
    elasticity: 2.5,
    prevElasticity: 2.0,
    sampleSize: 2,
    latestSourceMonth: "2026-06",
  };
  const result = blendElasticityObservation(null, prior, "2026-07");
  // No new observation → EMA stays, but prev is updated to prior EMA
  expect(result.elasticity!).toBeCloseTo(2.5);
  expect(result.prevElasticity!).toBeCloseTo(2.5);
  expect(result.sampleSize).toBe(2);
});

// ── 4. blendElasticityObservation — same period (idempotency) ─────────────────

console.log("\nblendElasticityObservation — same-period rerun idempotency\n");

test("same period: elasticity unchanged on rerun", () => {
  const prior: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: 1.5,
    sampleSize: 3,
    latestSourceMonth: "2026-07",
  };
  const result = blendElasticityObservation(5.0, prior, "2026-07"); // raw differs but same month
  expect(result.elasticity!).toBeCloseTo(2.0);
});

test("same period: prevElasticity unchanged on rerun", () => {
  const prior: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: 1.5,
    sampleSize: 3,
    latestSourceMonth: "2026-07",
  };
  const result = blendElasticityObservation(5.0, prior, "2026-07");
  expect(result.prevElasticity!).toBeCloseTo(1.5);
});

test("same period: sampleSize unchanged on rerun", () => {
  const prior: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: 1.5,
    sampleSize: 3,
    latestSourceMonth: "2026-07",
  };
  const result = blendElasticityObservation(5.0, prior, "2026-07");
  expect(result.sampleSize).toBe(3);
});

test("multiple reruns on same period produce identical outputs", () => {
  const prior: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: 1.5,
    sampleSize: 3,
    latestSourceMonth: "2026-07",
  };
  const r1 = blendElasticityObservation(4.0, prior, "2026-07");
  // Feed r1 back as new prior (simulates what the DB upsert then re-reads)
  const priorAfterRun1: PriorElasticityState = {
    elasticity: r1.elasticity,
    prevElasticity: r1.prevElasticity,
    sampleSize: r1.sampleSize,
    latestSourceMonth: "2026-07",
  };
  const r2 = blendElasticityObservation(4.0, priorAfterRun1, "2026-07");
  expect(r2.elasticity!).toBeCloseTo(r1.elasticity!);
  expect(r2.prevElasticity!).toBeCloseTo(r1.prevElasticity!);
  expect(r2.sampleSize).toBe(r1.sampleSize);
});

// ── 5. blendElasticityObservation — partial-upload / backfill cases ───────────

console.log("\nblendElasticityObservation — partial-upload / backfill\n");

test("segment absent from newest client upload uses its own newest month — no false stamp", () => {
  // Simulate: client newest month is "2026-08" but this segment only has data up to "2026-07".
  // The segment-level source month should be "2026-07", not "2026-08".
  // If we had used "2026-08", the segment would get stamped with a month it doesn't have
  // data for, blocking future blends when "2026-08" data arrives.
  const prior: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: 1.8,
    sampleSize: 3,
    latestSourceMonth: "2026-06", // segment was last blended at June
  };
  // Segment's own newest month is "2026-07" (it is absent from "2026-08")
  const result = blendElasticityObservation(2.5, prior, "2026-07");
  // Period advanced (2026-07 != 2026-06) → should blend
  expect(result.prevElasticity!).toBeCloseTo(2.0); // snapshotted from prior EMA
  expect(result.sampleSize).toBe(4);
});

test("backfill: segment absent from upload N then present in same month later still blends", () => {
  // After a run where segment was absent: stored latest_source_month = "2026-07"
  // (from its own data, not the global "2026-08"). Later a backfill adds this
  // segment's "2026-08" data. That run sees "2026-08" != stored "2026-07" → blends.
  const priorAfterMissedRun: PriorElasticityState = {
    elasticity: 2.0,
    prevElasticity: 1.8,
    sampleSize: 3,
    latestSourceMonth: "2026-07", // correct per-segment stamp from previous run
  };
  // Backfill run: segment now has "2026-08" as its newest month
  const result = blendElasticityObservation(3.0, priorAfterMissedRun, "2026-08");
  // Period advanced → blend should occur
  expect(result.sampleSize).toBe(4);
  expect(result.prevElasticity!).toBeCloseTo(2.0);
});

test("segment with global newest month present: same idempotency contract holds", () => {
  // Normal case: segment has the global newest month — should behave identically
  // to the standard same-period test.
  const prior: PriorElasticityState = {
    elasticity: 2.5,
    prevElasticity: 2.0,
    sampleSize: 4,
    latestSourceMonth: "2026-08",
  };
  const result = blendElasticityObservation(5.0, prior, "2026-08"); // same period
  expect(result.elasticity!).toBeCloseTo(2.5);
  expect(result.prevElasticity!).toBeCloseTo(2.0);
  expect(result.sampleSize).toBe(4);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
