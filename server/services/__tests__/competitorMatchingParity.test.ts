/**
 * DB integration tests for the shared competitor matching policy applied to
 * BOTH write paths' lookup semantics, exercised via
 * `competitorRateMatching.getBestCompetitorRate` against synthetic survey rows:
 *
 *  - AL/MC unit falls back to a legacy AL row when no AL/MC row exists
 *  - HC/MC unit prefers its dedicated HC/MC row over legacy SMC
 *  - HC/MC unit falling back to a legacy SMC row converts DAILY rates correctly
 *  - Studio Dlx falls back to Studio within the same survey type
 *  - AL Companion with no Companion row returns null (never a private-room rate)
 *
 * Run with:
 *   npx tsx server/services/__tests__/competitorMatchingParity.test.ts
 */

import { db } from "../../db.js";
import { competitiveSurveyData } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";
import { getBestCompetitorRate } from "../competitorRateMatching.js";

const LOC = "ZZTEST Parity Campus";
const MONTH = "2026-07";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e?.message ?? e}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function seed() {
  const rows = [
    // AL: Studio exists, no Studio Dlx → Studio Dlx unit must fall back to Studio
    { competitorType: "AL", roomType: "Studio", monthlyRateAvg: 4000, competitorName: "Alpha AL" },
    // AL: One Bedroom exists too (must NOT be used for Companion)
    { competitorType: "AL", roomType: "One Bedroom", monthlyRateAvg: 5000, competitorName: "Alpha AL" },
    // No AL/MC rows at all → AL/MC unit must fall back to the legacy AL row
    // HC/MC dedicated row (daily basis)
    { competitorType: "HC/MC", roomType: "Studio", monthlyRateAvg: 300, competitorName: "Bravo HCMC" },
    // Legacy SMC row for a room type the HC/MC type lacks (daily basis)
    { competitorType: "SMC", roomType: "Companion", monthlyRateAvg: 250, competitorName: "Charlie SMC" },
  ];
  // Competing tenant at the SAME location — must never be selected
  await db.insert(competitiveSurveyData).values({
    keyStatsLocation: LOC, surveyMonth: MONTH, clientId: "zztest-other-tenant",
    competitorName: "Evil Other Tenant", competitorType: "AL", roomType: "Studio",
    monthlyRateAvg: 1, distanceMiles: 1, notes: null,
  } as any);
  // Stale-month row for our tenant — latest-month policy must ignore it
  await db.insert(competitiveSurveyData).values({
    keyStatsLocation: LOC, surveyMonth: "2025-01", clientId: "zztest-match",
    competitorName: "Stale Month AL", competitorType: "AL", roomType: "Studio",
    monthlyRateAvg: 1234, distanceMiles: 1, notes: null,
  } as any);
  for (const r of rows) {
    await db.insert(competitiveSurveyData).values({
      keyStatsLocation: LOC,
      surveyMonth: MONTH,
      clientId: "zztest-match",
      competitorName: r.competitorName,
      competitorType: r.competitorType,
      roomType: r.roomType,
      monthlyRateAvg: r.monthlyRateAvg,
      careLevel2Rate: null,
      medicationManagementFee: null,
      distanceMiles: 5,
      notes: null,
    } as any);
  }
}

async function cleanup() {
  await db.delete(competitiveSurveyData).where(eq(competitiveSurveyData.keyStatsLocation, LOC));
  await db.delete(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, "zztest-other-tenant"));
}

async function main() {
  await cleanup();
  await seed();

  await test("AL/MC unit falls back to legacy AL row when no AL/MC rows exist", async () => {
    const r = await getBestCompetitorRate(LOC, "AL/MC", "Studio", "zztest-match");
    assert(!!r, "expected a match via legacy AL fallback");
    assert(r!.competitorName === "Alpha AL", `expected Alpha AL, got ${r!.competitorName}`);
    assert(r!.baseRate === 4000, `AL rates are monthly — expected 4000, got ${r!.baseRate}`);
  });

  await test("HC/MC unit prefers dedicated HC/MC row over legacy SMC (daily → monthly)", async () => {
    const r = await getBestCompetitorRate(LOC, "HC/MC", "Studio", "zztest-match");
    assert(!!r, "expected a match");
    assert(r!.competitorName === "Bravo HCMC", `expected Bravo HCMC, got ${r!.competitorName}`);
    assert(Math.abs(r!.baseRate - 300 * 30.44) < 0.01, `expected 9132, got ${r!.baseRate}`);
  });

  await test("HC/MC unit falls back to legacy SMC row with correct DAILY conversion", async () => {
    // HC/MC has no Companion row; SMC does. Basis must come from the matched
    // (SMC) record, converting $250/day → $7,610/mo.
    const r = await getBestCompetitorRate(LOC, "HC/MC", "Companion", "zztest-match");
    assert(!!r, "expected a match via legacy SMC fallback");
    assert(r!.competitorName === "Charlie SMC", `expected Charlie SMC, got ${r!.competitorName}`);
    assert(Math.abs(r!.baseRate - 250 * 30.44) < 0.01, `expected 7610, got ${r!.baseRate}`);
  });

  await test("Studio Dlx falls back to Studio within the same survey type", async () => {
    const r = await getBestCompetitorRate(LOC, "AL", "Studio Dlx", "zztest-match");
    assert(!!r, "expected a match via Studio fallback");
    assert(r!.baseRate === 4000, `expected the Studio rate 4000, got ${r!.baseRate}`);
  });

  await test("AL Companion with no Companion row returns null (no private-room fallback)", async () => {
    const r = await getBestCompetitorRate(LOC, "AL", "Companion", "zztest-match");
    assert(r === null, `expected null, got ${JSON.stringify(r)}`);
  });

  await test("tenant isolation: another client's survey row at the same location is never selected", async () => {
    const r = await getBestCompetitorRate(LOC, "AL", "Studio", "zztest-match");
    assert(!!r && r.competitorName === "Alpha AL", `expected Alpha AL, got ${r?.competitorName}`);
    assert(r!.baseRate === 4000, `expected 4000, got ${r!.baseRate}`);
  });

  await test("survey-month policy: only the client's latest month is matched (stale rows ignored)", async () => {
    const r = await getBestCompetitorRate(LOC, "AL", "Studio", "zztest-match");
    assert(!!r && r.competitorName !== "Stale Month AL" && r.baseRate === 4000,
      `stale-month row leaked in: ${r?.competitorName} @ ${r?.baseRate}`);
  });

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
