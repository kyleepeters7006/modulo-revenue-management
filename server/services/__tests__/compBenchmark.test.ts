/**
 * Tests for the shared care-adjusted competitor benchmark service
 * (compBenchmark.ts) — the single methodology used by the Competitive
 * Position scatter and the AI rule-suggest endpoint.
 *
 * Covers:
 *  - HC/HC-MC/SMC daily normalization (base >800 → /30, care/med >200 → /30,
 *    implausible values discarded)
 *  - Care-L2 differential gated to HC/HC-MC/AL/AL-MC (never SL/VIL)
 *  - SL→IL_IL / VIL→IL_Villa / HC-MC→SMC legacy mapping
 *  - Partial survey coverage: per-location fallback to stored
 *    competitor_final_rate averages in the unit-weighted benchmark
 *
 * Run with:
 *   npx tsx server/services/__tests__/compBenchmark.test.ts
 */

import { DAYS_PER_MONTH } from "@shared/careRates";
import {
  CompBenchmark,
  aggregateSurveyRows,
  normalizeBaseRate,
  normalizeCareL2,
  normalizeMedMgmt,
  unitWeightedBenchmark,
  SL_TO_COMP,
  CARE_L2_APPLIES,
  type SurveyRow,
} from "../compBenchmark.js";

// ── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓  ${name}`); passed++; })
    .catch((e: any) => {
      console.error(`  ✗  ${name}`);
      console.error(`       ${e?.message ?? e}`);
      failed++;
    });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertClose(actual: number, expected: number, tol: number, label: string) {
  if (Math.abs(actual - expected) > tol)
    throw new Error(`${label}: expected ~${expected}, got ${actual} (±${tol})`);
}
function assertNull(val: unknown, label: string) {
  if (val !== null) throw new Error(`${label}: expected null, got ${JSON.stringify(val)}`);
}

const row = (loc: string, type: string, base: number | null, care: number | null = null, med: number | null = null): SurveyRow => ({
  keystats_location: loc,
  competitor_type: type,
  monthly_rate_avg: base,
  care_level_2_rate: care,
  medication_management_fee: med,
});

(async () => {
  console.log("\ncompBenchmark — normalization\n");

  await test("HC base >800 treated as monthly mistake → daily", () => {
    assertClose(normalizeBaseRate("HC", 9000)!, 9000 / DAYS_PER_MONTH, 0.01, "9000 / DAYS_PER_MONTH");
  });
  await test("HC base 465 (plausible daily) kept as-is", () => {
    assertEq(normalizeBaseRate("HC", 465), 465, "daily 465");
  });
  await test("HC base <50 discarded", () => {
    assertNull(normalizeBaseRate("HC", 20), "daily 20");
  });
  await test("Monthly base outside 500..25000 discarded", () => {
    assertNull(normalizeBaseRate("AL", 400), "AL 400");
    assertNull(normalizeBaseRate("AL", 26000), "AL 26000");
    assertEq(normalizeBaseRate("AL", 5100), 5100, "AL 5100");
  });
  await test("HC care L2 >200 normalized to daily (shared days-per-month)", () => {
    assertClose(normalizeCareL2("HC", 1500)!, 1500 / DAYS_PER_MONTH, 0.01, "1500 / DAYS_PER_MONTH");
    assertEq(normalizeCareL2("HC", 55), 55, "daily 55 kept");
  });
  await test("Monthly care L2 gated 1..5000", () => {
    assertEq(normalizeCareL2("AL", 1150), 1150, "AL 1150");
    assertNull(normalizeCareL2("AL", 6000), "AL 6000");
  });
  await test("HC med mgmt >200 normalized to daily (shared days-per-month)", () => {
    assertClose(normalizeMedMgmt("HC/MC", 300)!, 300 / DAYS_PER_MONTH, 0.01, "300 / DAYS_PER_MONTH");
    assertEq(normalizeMedMgmt("HC/MC", 12), 12, "daily 12 kept");
  });
  await test("Monthly med mgmt gated 1..2000", () => {
    assertEq(normalizeMedMgmt("AL", 350), 350, "AL 350");
    assertNull(normalizeMedMgmt("AL", 2500), "AL 2500");
  });

  console.log("\ncompBenchmark — aggregation\n");

  await test("Averages per location+type, rounded to whole dollars", () => {
    const map = aggregateSurveyRows([
      row("Campus A", "AL", 5000, 1000, 300),
      row("Campus A", "AL", 5201, 1201, 401),
    ]);
    const e = map.get("Campus A|||AL")!;
    assertEq(e.baseRate, 5101, "avg base rounded");   // (5000+5201)/2 = 5100.5 → 5101
    assertEq(e.careL2, 1101, "avg care rounded");
    assertEq(e.medMgmt, 351, "avg med rounded");
  });
  await test("Group with no usable base rate is dropped", () => {
    const map = aggregateSurveyRows([row("Campus A", "AL", 100)]); // <500 discarded
    assert(!map.has("Campus A|||AL"), "should be dropped");
  });
  await test("Implausible rows excluded from average, plausible retained", () => {
    const map = aggregateSurveyRows([
      row("Campus A", "AL", 5000),
      row("Campus A", "AL", 999999), // >25000 → discarded
    ]);
    assertEq(map.get("Campus A|||AL")!.baseRate, 5000, "only plausible row averaged");
  });
  await test("HC mixed daily/monthly-mistake rows normalized before averaging", () => {
    const map = aggregateSurveyRows([
      row("Campus A", "HC", 450),                  // daily
      row("Campus A", "HC", 450 * DAYS_PER_MONTH), // monthly mistake → 450
    ]);
    assertEq(map.get("Campus A|||HC")!.baseRate, 450, "both normalize to 450");
  });

  console.log("\ncompBenchmark — care adjustment & mapping\n");

  const bench = new CompBenchmark(
    aggregateSurveyRows([
      row("Campus A", "AL", 5100, 1150, 350),
      row("Campus A", "IL_IL", 3000, 1000, 200),    // SL comp — care should NOT apply
      row("Campus A", "IL_Villa", 4000, 900, 100),  // VIL comp — care should NOT apply
      row("Campus A", "SMC", 400, 60, 10),          // legacy SMC for HC/MC
      row("Campus B", "HC", 465, 55, 12),
    ]),
    new Map([
      ["Campus A|||AL", 900],
      ["Campus A|||SL", 500],   // must be ignored (SL not care-bearing)
      ["Campus B|||HC", 40],
    ]),
  );

  await test("AL: adjusted = base + (their careL2 − ours) + med mgmt", () => {
    const b = bench.benchmarkFor("Campus A", "AL")!;
    assertEq(b.adjusted, 5100 + (1150 - 900) + 350, "AL adjusted");
    assertEq(b.base, 5100, "raw base");
    assertEq(b.careAdj, (1150 - 900) + 350, "careAdj");
  });
  await test("SL maps to IL_IL and gets NO care-L2 differential (med mgmt only)", () => {
    const b = bench.benchmarkFor("Campus A", "SL")!;
    assertEq(b.compType, "IL_IL", "mapped type");
    assertEq(b.adjusted, 3000 + 200, "no care diff, med mgmt added");
  });
  await test("VIL maps to IL_Villa and gets NO care-L2 differential", () => {
    const b = bench.benchmarkFor("Campus A", "VIL")!;
    assertEq(b.compType, "IL_Villa", "mapped type");
    assertEq(b.adjusted, 4000 + 100, "no care diff");
  });
  await test("HC/MC falls back to legacy SMC when no HC/MC survey rows", () => {
    const b = bench.benchmarkFor("Campus A", "HC/MC")!;
    assertEq(b.compType, "SMC", "SMC fallback");
    // No our-care entry for Campus A HC/MC → theirs − 0
    assertEq(b.adjusted, 400 + 60 + 10, "SMC daily adjusted");
  });
  await test("HC daily: adjusted stays on daily basis", () => {
    const b = bench.benchmarkFor("Campus B", "HC")!;
    assertEq(b.adjusted, 465 + (55 - 40) + 12, "HC daily adjusted");
  });
  await test("No survey coverage → null", () => {
    assertNull(bench.benchmarkFor("Campus C", "AL"), "uncovered location");
  });
  await test("Mapping and gating constants match spec", () => {
    assertEq(JSON.stringify(SL_TO_COMP["HC/MC"]), JSON.stringify(["HC/MC", "SMC"]), "HC/MC map");
    assertEq(SL_TO_COMP["SL"][0], "IL_IL", "SL map");
    assertEq(SL_TO_COMP["VIL"][0], "IL_Villa", "VIL map");
    assert(CARE_L2_APPLIES["AL"] && CARE_L2_APPLIES["AL/MC"] && CARE_L2_APPLIES["HC"] && CARE_L2_APPLIES["HC/MC"], "care SLs gated in");
    assert(!CARE_L2_APPLIES["SL"] && !CARE_L2_APPLIES["VIL"], "SL/VIL gated out");
  });

  console.log("\ncompBenchmark — unit-weighted multi-location fallback\n");

  await test("Unit-weighted average across survey-covered locations", () => {
    const b2 = new CompBenchmark(
      aggregateSurveyRows([
        row("Loc1", "AL", 5000),
        row("Loc2", "AL", 6000),
      ]),
      new Map(),
    );
    const v = unitWeightedBenchmark(b2, "AL", [
      { location: "Loc1", unitCount: 10, competitorFinalRates: [] },
      { location: "Loc2", unitCount: 30, competitorFinalRates: [] },
    ])!;
    assertClose(v, (5000 * 10 + 6000 * 30) / 40, 0.01, "unit-weighted");
  });
  await test("Partial coverage: uncovered location falls back to competitor_final_rate avg PER LOCATION", () => {
    const b2 = new CompBenchmark(
      aggregateSurveyRows([row("Covered", "AL", 5000)]),
      new Map(),
    );
    const v = unitWeightedBenchmark(b2, "AL", [
      { location: "Covered", unitCount: 10, competitorFinalRates: [9999] }, // survey wins, fallback ignored
      { location: "Uncovered", unitCount: 10, competitorFinalRates: [4000, 4400, 0, -5] }, // avg of positives = 4200
    ])!;
    assertClose(v, (5000 * 10 + 4200 * 10) / 20, 0.01, "mixed coverage");
  });
  await test("Location with neither survey nor stored rates contributes no weight", () => {
    const b2 = new CompBenchmark(aggregateSurveyRows([row("Covered", "AL", 5000)]), new Map());
    const v = unitWeightedBenchmark(b2, "AL", [
      { location: "Covered", unitCount: 5, competitorFinalRates: [] },
      { location: "Empty", unitCount: 100, competitorFinalRates: [] },
    ])!;
    assertEq(v, 5000, "only covered location counts");
  });
  await test("No coverage anywhere → null", () => {
    const b2 = new CompBenchmark(new Map(), new Map());
    assertNull(
      unitWeightedBenchmark(b2, "AL", [{ location: "X", unitCount: 5, competitorFinalRates: [] }]),
      "all-uncovered scope",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
