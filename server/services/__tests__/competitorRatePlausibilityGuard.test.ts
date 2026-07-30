/**
 * Tests for the competitor rate plausibility guard.
 *
 * Exercises `buildCompetitorRateUpdate` from competitorRateSanitizer — the
 * actual function used by every write path — to verify:
 *
 *  - Valid rates produce the correct DB update fields
 *  - Values above MAX_PLAUSIBLE_MONTHLY_RATE return all-null fields (corrupt
 *    values are actively cleared, not just skipped)
 *  - Zero / negative rates are cleared
 *  - The $375M Romeo - 2512 scenario (corrupt careL2 value) is rejected and
 *    cleared, not left in place
 *  - HC stored-rate conversion (monthly → daily) is preserved when plausible
 *  - VIL high-end rates ($30k–$33k) that the old BETWEEN 30000 cap wrongly
 *    excluded now pass the 50k limit
 *
 * Run with:
 *   npx tsx server/services/__tests__/competitorRatePlausibilityGuard.test.ts
 */

import { buildCompetitorRateUpdate, MAX_PLAUSIBLE_MONTHLY_RATE } from "../competitorRateSanitizer.js";
import { convertToStoredRate, isDailyRateServiceLine } from "../rateNormalization.js";

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
function assertNull(val: unknown, label: string) {
  if (val !== null) throw new Error(`${label}: expected null, got ${JSON.stringify(val)}`);
}
function assertClose(actual: number, expected: number, tol: number, label: string) {
  if (Math.abs(actual - expected) > tol)
    throw new Error(`${label}: expected ~${expected}, got ${actual} (±${tol})`);
}

// ── Shared test fields ───────────────────────────────────────────────────────

const DAYS_PER_MONTH = 30.44;

function makeFields(finalRate: number | null) {
  return {
    competitorName: "Test Competitor",
    competitorBaseRate: 5100,
    competitorFinalRate: finalRate,
    competitorCareLevel2Adjustment: 1150,
    competitorMedManagementAdjustment: 350,
    competitorWeight: 0.8,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\ncompetitorRateSanitizer — buildCompetitorRateUpdate\n");

  // ── MAX_PLAUSIBLE_MONTHLY_RATE constant ──────────────────────────────────
  await test("MAX_PLAUSIBLE_MONTHLY_RATE is exported as 50 000", () => {
    assertEq(MAX_PLAUSIBLE_MONTHLY_RATE, 50_000, "MAX_PLAUSIBLE_MONTHLY_RATE");
  });

  // ── Valid AL/MC case (Romeo-2512 clean data: $5100 + $1150 + $350 = $6600) ─
  await test("Valid $6 600 → plausible=true and fields are preserved", () => {
    const result = buildCompetitorRateUpdate(6_600, makeFields(6_600));
    assert(result.plausible, "should be plausible");
    assertEq(result.update.competitorFinalRate, 6_600, "competitorFinalRate");
    assertEq(result.update.competitorName, "Test Competitor", "name");
    assertEq(result.update.competitorBaseRate, 5100, "baseRate");
    assertEq(result.update.competitorCareLevel2Adjustment, 1150, "careAdj");
    assertEq(result.update.competitorMedManagementAdjustment, 350, "medAdj");
  });

  // ── Historic $375M corrupt value ────────────────────────────────────────
  await test("$375M value → plausible=false and ALL fields are null (not skipped)", () => {
    const corruptRate = 375_531_072;
    const result = buildCompetitorRateUpdate(corruptRate, makeFields(corruptRate));
    assert(!result.plausible, "should not be plausible");
    assert(!!result.reason, "should have a reason");
    // Critical: ALL competitor fields must be null so stale corrupt rows are cleared
    assertNull(result.update.competitorFinalRate, "competitorFinalRate");
    assertNull(result.update.competitorBaseRate, "competitorBaseRate");
    assertNull(result.update.competitorName, "competitorName");
    assertNull(result.update.competitorCareLevel2Adjustment, "careAdj");
    assertNull(result.update.competitorMedManagementAdjustment, "medAdj");
    assertNull(result.update.competitorWeight, "weight");
  });

  // ── Root-cause scenario: corrupt trilogyCareL2 produces $375M ───────────
  await test("Corrupt trilogyCareL2=-375M → final rate rejected, fields null", () => {
    // Models: competitorCareL2=1150, trilogyCareL2=-375_524_472
    // careAdj = 1150 - (-375_524_472) = 375_525_622
    const corruptCareAdj = 1150 - (-375_524_472);
    const finalMonthly = 5100 + corruptCareAdj + 350;  // = 375_531_072
    const result = buildCompetitorRateUpdate(finalMonthly, makeFields(finalMonthly));
    assert(!result.plausible, `finalMonthly=${finalMonthly} should be rejected`);
    assertNull(result.update.competitorFinalRate, "competitorFinalRate cleared");
    assertNull(result.update.competitorCareLevel2Adjustment, "careAdj cleared");
  });

  // ── Boundary: exactly at the limit ──────────────────────────────────────
  await test("Rate = 50 000 (boundary) → plausible=true", () => {
    const result = buildCompetitorRateUpdate(50_000, makeFields(50_000));
    assert(result.plausible, "50000 should pass");
    assertEq(result.update.competitorFinalRate, 50_000, "finalRate");
  });

  await test("Rate = 50 001 (one above boundary) → plausible=false, fields null", () => {
    const result = buildCompetitorRateUpdate(50_001, makeFields(50_001));
    assert(!result.plausible, "50001 should fail");
    assertNull(result.update.competitorFinalRate, "finalRate should be null");
  });

  // ── Zero and negative values ─────────────────────────────────────────────
  await test("Zero rate → plausible=false, fields null", () => {
    const result = buildCompetitorRateUpdate(0, makeFields(0));
    assert(!result.plausible, "0 should fail");
    assertNull(result.update.competitorFinalRate, "finalRate null");
  });

  await test("Negative rate → plausible=false, fields null", () => {
    const result = buildCompetitorRateUpdate(-500, makeFields(-500));
    assert(!result.plausible, "-500 should fail");
    assertNull(result.update.competitorFinalRate, "finalRate null");
  });

  // ── Null input (no rate computed) ────────────────────────────────────────
  await test("null rate → plausible=false, fields null (no match for unit)", () => {
    const result = buildCompetitorRateUpdate(null, makeFields(null));
    assert(!result.plausible, "null should fail");
    assertNull(result.update.competitorFinalRate, "finalRate null");
  });

  // ── HC daily-storage scenario: $465/day → monthly → stored back as daily ─
  await test("HC: $465/day monthly = $14 155/month → plausible, stored value returned correctly", () => {
    const monthly = 465 * DAYS_PER_MONTH;  // 14154.6
    // Caller converts to daily for storage: ÷ 30.44
    const storedDaily = Math.round((monthly / DAYS_PER_MONTH) * 100) / 100; // ≈ 465
    const hcFields = {
      competitorName: "HC Competitor",
      competitorBaseRate: storedDaily,
      competitorFinalRate: storedDaily,
      competitorCareLevel2Adjustment: 0,
      competitorMedManagementAdjustment: 0,
      competitorWeight: null,
    };
    // Guard receives the monthly value; caller passes the already-converted
    // stored daily value as fields — this is the pattern in competitorRateJobService
    const result = buildCompetitorRateUpdate(monthly, hcFields);
    assert(result.plausible, `monthly=${monthly.toFixed(2)} should be plausible`);
    assertClose(result.update.competitorFinalRate!, storedDaily, 0.02, "HC stored daily rate");
  });

  // ── VIL high-end rates (wrongly excluded by old BETWEEN 100 AND 30000) ───
  await test("VIL Two-Bedroom $30 000/month passes the 50k guard", () => {
    const fields = { ...makeFields(30_000), competitorFinalRate: 30_000 };
    const result = buildCompetitorRateUpdate(30_000, fields);
    assert(result.plausible, "30000 should pass new 50k limit");
    assertEq(result.update.competitorFinalRate, 30_000, "finalRate");
  });

  await test("VIL Two-Bedroom $33 333/month passes the 50k guard", () => {
    const fields = { ...makeFields(33_333), competitorFinalRate: 33_333 };
    const result = buildCompetitorRateUpdate(33_333, fields);
    assert(result.plausible, "33333 should pass");
  });

  // ── Reason string is populated when implausible ───────────────────────────
  await test("Implausible result includes a human-readable reason", () => {
    const result = buildCompetitorRateUpdate(999_999, makeFields(999_999));
    assert(!result.plausible, "should fail");
    assert(typeof result.reason === "string" && result.reason.length > 0, "reason should be non-empty string");
    assert(result.reason!.includes("50000") || result.reason!.includes("MAX"), "reason should mention the limit");
  });

  // ── convertToStoredRate unit checks ──────────────────────────────────────
  console.log("\nconvertToStoredRate\n");

  await test("AL: monthly $6 600 stored as-is (monthly)", () => {
    assertEq(convertToStoredRate(6_600, "AL"), 6_600, "AL stored rate");
  });

  await test("HC: monthly $14 154.60 stored as daily $465.00", () => {
    const stored = convertToStoredRate(14_154.60, "HC");
    assertClose(stored, 465.00, 0.02, "HC stored daily");
  });

  await test("HC/MC: monthly $13 696 stored as daily ~$450.00", () => {
    const stored = convertToStoredRate(13_696, "HC/MC");
    assertClose(stored, 450.00, 0.10, "HC/MC stored daily");
  });

  await test("isDailyRateServiceLine: HC and HC/MC are daily; AL and SL are not", () => {
    assert(isDailyRateServiceLine("HC"),    "HC should be daily");
    assert(isDailyRateServiceLine("HC/MC"), "HC/MC should be daily");
    assert(!isDailyRateServiceLine("AL"),   "AL should NOT be daily");
    assert(!isDailyRateServiceLine("SL"),   "SL should NOT be daily");
    assert(!isDailyRateServiceLine("VIL"),  "VIL should NOT be daily");
  });

  // ── Per-path integration: competitorRateJobService write path ─────────────
  // Simulates the exact fields the job service builds then passes to sanitizer.
  console.log("\nPer-path write coverage\n");

  await test("[jobService path] corrupt rate → ALL job-service fields are null", () => {
    // Job service builds stored (converted) values, then calls buildCompetitorRateUpdate
    // with the monthly rate for the guard but the stored values as fields.
    const corruptMonthly = 375_531_072; // the Romeo scenario
    const result = buildCompetitorRateUpdate(corruptMonthly, {
      competitorName: "Corrupt Competitor",
      competitorBaseRate: 5100,           // stored base (monthly for AL)
      competitorFinalRate: corruptMonthly, // what would be stored
      competitorCareLevel2Adjustment: 375_525_622,
      competitorMedManagementAdjustment: 350,
      competitorWeight: 0.9,
    });
    assert(!result.plausible, "must be rejected");
    // Every column the job service writes must be null so the corrupt row is cleared
    assertNull(result.update.competitorName,                    "jobService: competitorName");
    assertNull(result.update.competitorBaseRate,                "jobService: competitorBaseRate");
    assertNull(result.update.competitorFinalRate,               "jobService: competitorFinalRate");
    assertNull(result.update.competitorCareLevel2Adjustment,    "jobService: careAdj");
    assertNull(result.update.competitorMedManagementAdjustment, "jobService: medAdj");
    assertNull(result.update.competitorWeight,                  "jobService: weight");
  });

  await test("[jobService path] valid rate → ALL job-service fields are populated", () => {
    const validMonthly = 6_600;
    const result = buildCompetitorRateUpdate(validMonthly, {
      competitorName: "Serene Gardens",
      competitorBaseRate: 5100,
      competitorFinalRate: 6600,
      competitorCareLevel2Adjustment: 1150,
      competitorMedManagementAdjustment: 350,
      competitorWeight: 0.9,
    });
    assert(result.plausible, "must be accepted");
    assertEq(result.update.competitorName, "Serene Gardens",     "name preserved");
    assertEq(result.update.competitorFinalRate, 6600,            "finalRate preserved");
    assertEq(result.update.competitorCareLevel2Adjustment, 1150, "careAdj preserved");
  });

  // ── Per-path integration: competitorRateMatching write path ──────────────
  // competitorRateMatching calls buildCompetitorRateUpdate with competitorAdjustedRate
  // and the result fields from calculateCompetitorRateForUnit.

  await test("[matching path] corrupt adjustedRate → ALL matching-service fields are null", () => {
    const corruptAdjusted = 375_531_072;
    const result = buildCompetitorRateUpdate(corruptAdjusted, {
      competitorName: "Any",
      competitorBaseRate: 5100,
      competitorFinalRate: corruptAdjusted,
      competitorCareLevel2Adjustment: 375_525_622,
      competitorMedManagementAdjustment: 350,
      competitorWeight: null,
    });
    assert(!result.plausible, "must be rejected");
    assertNull(result.update.competitorFinalRate,               "matching: finalRate");
    assertNull(result.update.competitorName,                    "matching: name");
    assertNull(result.update.competitorBaseRate,                "matching: baseRate");
    assertNull(result.update.competitorCareLevel2Adjustment,    "matching: careAdj");
    assertNull(result.update.competitorMedManagementAdjustment, "matching: medAdj");
  });

  // ── Per-path integration: /api/competitor-rates/test endpoint ─────────────
  // The test endpoint builds exactly the same input shape as competitorRateMatching.

  await test("[test endpoint path] corrupt rate → ALL endpoint fields are null", () => {
    const corruptRate = 375_531_072;
    // Mirrors the buildCompetitorRateUpdate call in the test endpoint
    const result = buildCompetitorRateUpdate(corruptRate, {
      competitorName: "Romeo Competitor",
      competitorBaseRate: 5100,
      competitorFinalRate: corruptRate,
      competitorCareLevel2Adjustment: 375_525_622,
      competitorMedManagementAdjustment: 350,
      competitorWeight: null,
    });
    assert(!result.plausible, "must be rejected");
    // The endpoint writes these columns — verify all are null for corrupt input
    assertNull(result.update.competitorFinalRate,               "endpoint: competitorFinalRate (→ competitorRate)");
    assertNull(result.update.competitorName,                    "endpoint: competitorName");
    assertNull(result.update.competitorBaseRate,                "endpoint: competitorBaseRate");
    assertNull(result.update.competitorWeight,                  "endpoint: competitorWeight");
    assertNull(result.update.competitorCareLevel2Adjustment,    "endpoint: careAdj");
    assertNull(result.update.competitorMedManagementAdjustment, "endpoint: medAdj");
  });

  // ── HC/HC-MC write-path: matching service converts monthly → daily ────────
  console.log("\nHC daily-storage write-path\n");

  await test("[matching path] HC $465/day: monthly computed → stored as daily, plausible", () => {
    // calculateCompetitorRateForUnit returns monthly; matching service converts
    const monthlyAdjusted = 465 * DAYS_PER_MONTH; // 14154.6
    const sl = "HC";
    const storedFinal = convertToStoredRate(monthlyAdjusted, sl);
    const storedBase  = convertToStoredRate(465 * DAYS_PER_MONTH, sl);
    const result = buildCompetitorRateUpdate(monthlyAdjusted, {
      competitorName: "HC Competitor",
      competitorBaseRate: storedBase,
      competitorFinalRate: storedFinal,
      competitorCareLevel2Adjustment: convertToStoredRate(0, sl),
      competitorMedManagementAdjustment: 0,
      competitorWeight: null,
    });
    assert(result.plausible, `monthly ${monthlyAdjusted.toFixed(2)} should pass plausibility`);
    assertClose(result.update.competitorFinalRate!, 465.00, 0.02, "stored daily final rate");
    assertClose(result.update.competitorBaseRate!,  465.00, 0.02, "stored daily base rate");
  });

  await test("[matching path] HC corrupt rate (monthly > 50k) → daily conversion never reached, all nulls", () => {
    // Simulate corrupt trilogyCareL2 producing $375M monthly
    const corruptMonthly = 375_531_072;
    const sl = "HC";
    // Matching service checks plausibility with monthly value BEFORE converting
    const result = buildCompetitorRateUpdate(corruptMonthly, {
      competitorName: "Any",
      competitorBaseRate: convertToStoredRate(5000 * DAYS_PER_MONTH, sl),
      competitorFinalRate: convertToStoredRate(corruptMonthly, sl), // would be ~12M/day
      competitorCareLevel2Adjustment: 0,
      competitorMedManagementAdjustment: 0,
      competitorWeight: null,
    });
    assert(!result.plausible, "corrupt monthly must be rejected before daily conversion");
    assertNull(result.update.competitorFinalRate, "finalRate must be null");
    assertNull(result.update.competitorBaseRate,  "baseRate must be null");
  });

  await test("[test endpoint path] HC $465/day: monthly → stored as daily, plausible", () => {
    // Test endpoint now mirrors the matching service conversion
    const monthlyAdjusted = 465 * DAYS_PER_MONTH;
    const sl = "HC";
    const storedFinal = convertToStoredRate(monthlyAdjusted, sl);
    const result = buildCompetitorRateUpdate(monthlyAdjusted, {
      competitorName: "HC Test Competitor",
      competitorBaseRate: convertToStoredRate(465 * DAYS_PER_MONTH, sl),
      competitorFinalRate: storedFinal,
      competitorCareLevel2Adjustment: convertToStoredRate(-20 * DAYS_PER_MONTH, sl),
      competitorMedManagementAdjustment: 0,
      competitorWeight: 0.7,
    });
    assert(result.plausible, "should pass");
    assertClose(result.update.competitorFinalRate!, storedFinal, 0.02, "HC stored final");
  });

  await test("[test endpoint path] valid rate → all endpoint fields populated", () => {
    const validRate = 6_600;
    const result = buildCompetitorRateUpdate(validRate, {
      competitorName: "Serene Gardens",
      competitorBaseRate: 5100,
      competitorFinalRate: validRate,
      competitorCareLevel2Adjustment: 1150,
      competitorMedManagementAdjustment: 350,
      competitorWeight: 0.8,
    });
    assert(result.plausible, "valid rate must be accepted");
    assertEq(result.update.competitorFinalRate,               validRate, "finalRate");
    assertEq(result.update.competitorName,                    "Serene Gardens", "name");
    assertEq(result.update.competitorCareLevel2Adjustment,    1150, "careAdj");
    assertEq(result.update.competitorMedManagementAdjustment, 350,  "medAdj");
    assertEq(result.update.competitorWeight,                  0.8,  "weight");
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
