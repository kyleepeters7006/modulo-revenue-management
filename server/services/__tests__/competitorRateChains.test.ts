/**
 * Focused tests for competitor rate matching guarantees:
 *  - room-type fallback chains are deterministic and never cross to an
 *    unrelated room type (Studio Dlx → Studio only; AL Companion never
 *    falls back to a private-room rate)
 *  - survey rate basis (daily vs monthly) is decided by the MATCHED record's
 *    competitor type, so HC/MC units falling back to legacy SMC rows convert
 *    daily rates correctly
 *
 * Run with:
 *   npx tsx server/services/__tests__/competitorRateChains.test.ts
 */

import { roomTypeFallbackChain, isDailySurveyType } from "../competitorRateJobService.js";
import { DAYS_PER_MONTH } from "@shared/careRates";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e?.message ?? e}`);
    failed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ?? "assertEqual"}: expected ${b}, got ${a}`);
}

// ── roomTypeFallbackChain ────────────────────────────────────────────────────

test("Studio Dlx prefers its own survey rows, then Studio only", () => {
  assertEqual(roomTypeFallbackChain("Studio Dlx", "AL"), ["Studio Dlx", "Studio"]);
  assertEqual(roomTypeFallbackChain("Studio Dlx", "HC/MC"), ["Studio Dlx", "Studio"]);
});

test("Studio never falls back to another room type", () => {
  assertEqual(roomTypeFallbackChain("Studio", "AL"), ["Studio"]);
});

test("AL / AL-MC Companion never falls back to a private-room rate", () => {
  assertEqual(roomTypeFallbackChain("Companion", "AL"), ["Companion"]);
  assertEqual(roomTypeFallbackChain("Companion", "AL/MC"), ["Companion"]);
});

test("non-AL Companion may fall back to studio-family rates deterministically", () => {
  assertEqual(roomTypeFallbackChain("Companion", "HC"), ["Companion", "Studio Dlx", "Studio"]);
});

test("bedroom room types fall back to Studio only (never an arbitrary row)", () => {
  assertEqual(roomTypeFallbackChain("One Bedroom", "AL"), ["One Bedroom", "Studio"]);
  assertEqual(roomTypeFallbackChain("Two Bedroom", "SL"), ["Two Bedroom", "Studio"]);
});

// ── isDailySurveyType (rate basis from the MATCHED record) ──────────────────

test("HC, HC/MC and legacy SMC survey rows are daily-basis", () => {
  assertEqual(isDailySurveyType("HC"), true);
  assertEqual(isDailySurveyType("HC/MC"), true);
  assertEqual(isDailySurveyType("SMC"), true);
});

test("AL / AL-MC / IL survey rows are monthly-basis", () => {
  assertEqual(isDailySurveyType("AL"), false);
  assertEqual(isDailySurveyType("AL/MC"), false);
  assertEqual(isDailySurveyType("IL_IL"), false);
  assertEqual(isDailySurveyType("IL_Villa"), false);
});

test("HC/MC unit matched to a legacy SMC row converts daily → monthly", () => {
  // Simulates the processBatch conversion for a fallback match: the basis must
  // come from the matched record's type (SMC → daily), not the unit's primary
  // candidate type.
  const matched = { competitorType: "SMC", monthlyRateAvg: 250 }; // $250/day
  let base = matched.monthlyRateAvg;
  if (isDailySurveyType(matched.competitorType) && base > 0 && base < 1000) {
    base = base * DAYS_PER_MONTH;
  }
  assertEqual(Math.round(base * 100) / 100, 7604.17, "SMC daily $250 should become $7,604.17/mo");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
