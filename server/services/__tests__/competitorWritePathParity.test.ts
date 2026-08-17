/**
 * End-to-end parity test: runs BOTH actual write paths of the stored per-unit
 * competitor columns against the same synthetic client and asserts they store
 * identical fields:
 *
 *   1. Batch job path — startCompetitorRateJob / processJob
 *   2. Recalculation path — processAllUnitsForCompetitorRates
 *
 * Scenarios:
 *   - "Private" room type unit (must resolve to the Studio survey rate via the
 *     shared normalizeUnitRoomType in BOTH paths)
 *   - Unit with NO survey coverage but stale prefilled competitor values
 *     (BOTH paths must clear the fields to NULL)
 *
 * Run with:
 *   npx tsx server/services/__tests__/competitorWritePathParity.test.ts
 */

import { db } from "../../db.js";
import { competitiveSurveyData, rentRollData, competitorRateJobs, locations, careLevelRates } from "../../../shared/schema.js";
import { eq, sql as sqlRaw } from "drizzle-orm";
import { startCompetitorRateJob, getJobStatus } from "../competitorRateJobService.js";
import { processAllUnitsForCompetitorRates, invalidateLatestSurveyMonthCache } from "../competitorRateMatching.js";

const CLIENT = "zztest-parity";
const LOC = "ZZTEST Parity Campus";
const LOC_NOMATCH = "ZZTEST Nomatch Campus";
const LOC_AL_DIRECT = "ZZTEST AL Direct Care";     // direct AL care row → +580
const LOC_AL_FALLBACK = "ZZTEST AL Missing Care";  // no care row → $55/day fallback
const LOC_ALMC_INHERIT = "ZZTEST ALMC Inherit";    // AL/MC inherits AL care row
const LOC_HCMC = "ZZTEST HCMC Daily";              // HC/MC via legacy SMC, daily basis
const ALL_LOCS = [LOC, LOC_NOMATCH, LOC_AL_DIRECT, LOC_AL_FALLBACK, LOC_ALMC_INHERIT, LOC_HCMC];
const MONTH = "2026-07";
const DPM = 30.44;
const near = (a: any, b: number, tol = 0.05) => typeof a === "number" && Math.abs(a - b) <= tol;

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else { console.error(`  ✗  ${msg}`); failed++; }
}

const COLS = {
  competitorName: rentRollData.competitorName,
  competitorBaseRate: rentRollData.competitorBaseRate,
  competitorFinalRate: rentRollData.competitorFinalRate,
  competitorCareLevel2Adjustment: rentRollData.competitorCareLevel2Adjustment,
  competitorMedManagementAdjustment: rentRollData.competitorMedManagementAdjustment,
  competitorWeight: rentRollData.competitorWeight,
  competitorRate: rentRollData.competitorRate,
  competitorAdjustmentExplanation: rentRollData.competitorAdjustmentExplanation,
  location: rentRollData.location,
};

async function cleanup() {
  await db.delete(rentRollData).where(eq(rentRollData.clientId, CLIENT));
  await db.delete(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, CLIENT));
  await db.delete(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, "zztest-parity-other"));
  await db.delete(competitorRateJobs).where(eq(competitorRateJobs.clientId, CLIENT));
  await db.delete(careLevelRates).where(eq(careLevelRates.clientId, CLIENT));
  await db.delete(locations).where(eq(locations.clientId, CLIENT));
  await db.execute(sqlRaw`DELETE FROM clients WHERE id = ${CLIENT}`);
}

async function ensureClient() {
  await db.execute(
    sqlRaw`INSERT INTO clients (id, name) VALUES (${CLIENT}, 'ZZTEST Parity Client') ON CONFLICT (id) DO NOTHING`
  );
}

async function seedUnits() {
  await db.delete(rentRollData).where(eq(rentRollData.clientId, CLIENT));
  const base = { clientId: CLIENT, uploadMonth: MONTH, date: "2026-07-01", occupiedYN: false, size: "300", streetRate: 3000, inHouseRate: 2900 };
  await db.insert(rentRollData).values([
    { ...base, location: LOC, roomNumber: "P-1", roomType: "Private", serviceLine: "SL" },
    {
      ...base, location: LOC_NOMATCH, roomNumber: "P-2", roomType: "Private", serviceLine: "SL",
      // Stale competitor values that must be CLEARED on no match
      competitorName: "Stale Comp", competitorBaseRate: 9999,
      competitorFinalRate: 9999, competitorWeight: 3, competitorRate: 9999,
      competitorAdjustmentExplanation: "stale explanation",
      competitorCareLevel2Adjustment: 111, competitorMedManagementAdjustment: 22,
    },
    { ...base, location: LOC_AL_DIRECT, roomNumber: "A-1", roomType: "Studio", serviceLine: "AL" },
    { ...base, location: LOC_AL_FALLBACK, roomNumber: "A-2", roomType: "Studio", serviceLine: "AL" },
    { ...base, location: LOC_ALMC_INHERIT, roomNumber: "M-1", roomType: "Studio", serviceLine: "AL/MC" },
    { ...base, location: LOC_HCMC, roomNumber: "H-1", roomType: "Companion", serviceLine: "HC/MC" },
  ] as any);
}

async function snapshot() {
  const rows = await db.select(COLS).from(rentRollData).where(eq(rentRollData.clientId, CLIENT));
  const byLoc: Record<string, any> = {};
  for (const r of rows) { const { location, ...rest } = r as any; byLoc[location] = rest; }
  return byLoc;
}

async function main() {
  await cleanup();
  await ensureClient();

  // Locations + our care rates:
  //  - AL Direct: explicit AL care $620/mo
  //  - AL Fallback: NO care row at all → $55/day fallback
  //  - ALMC Inherit: only an AL row ($620) → AL/MC must inherit it
  //  - HCMC: explicit HC care $30/day → HC/MC must inherit it
  const locRows = await db.insert(locations).values(
    ALL_LOCS.map(name => ({ name, clientId: CLIENT }))
  ).returning({ id: locations.id, name: locations.name });
  const locId = (name: string) => locRows.find(l => l.name === name)!.id;
  await db.insert(careLevelRates).values([
    { clientId: CLIENT, locationId: locId(LOC_AL_DIRECT), serviceLine: "AL", level2Rate: 620 },
    { clientId: CLIENT, locationId: locId(LOC_ALMC_INHERIT), serviceLine: "AL", level2Rate: 620 },
    { clientId: CLIENT, locationId: locId(LOC_HCMC), serviceLine: "HC", level2Rate: 30 },
  ] as any);

  // Survey coverage. LOC: only IL_IL Studio (SL maps to IL_IL; "Private" must
  // normalize to Studio). LOC_NOMATCH: no rows at all.
  await db.insert(competitiveSurveyData).values([
    {
      keyStatsLocation: LOC, surveyMonth: MONTH, clientId: CLIENT,
      competitorName: "Delta IL", competitorType: "IL_IL", roomType: "Studio",
      monthlyRateAvg: 3800, distanceMiles: 2,
    },
    // AL competitor with care $1200/mo and med mgmt $100/mo
    {
      keyStatsLocation: LOC_AL_DIRECT, surveyMonth: MONTH, clientId: CLIENT,
      competitorName: "Echo AL", competitorType: "AL", roomType: "Studio",
      monthlyRateAvg: 4373, careLevel2Rate: 1200, medicationManagementFee: 100, distanceMiles: 2,
    },
    {
      keyStatsLocation: LOC_AL_FALLBACK, surveyMonth: MONTH, clientId: CLIENT,
      competitorName: "Foxtrot AL", competitorType: "AL", roomType: "Studio",
      monthlyRateAvg: 4000, careLevel2Rate: 1200, distanceMiles: 2,
    },
    // AL/MC unit matched via LEGACY AL survey row (no AL/MC rows here)
    {
      keyStatsLocation: LOC_ALMC_INHERIT, surveyMonth: MONTH, clientId: CLIENT,
      competitorName: "Golf Legacy AL", competitorType: "AL", roomType: "Studio",
      monthlyRateAvg: 5000, careLevel2Rate: 1200, distanceMiles: 2,
    },
    // HC/MC unit matched via LEGACY SMC row (daily basis): base $250/d, care $40/d
    {
      keyStatsLocation: LOC_HCMC, surveyMonth: MONTH, clientId: CLIENT,
      competitorName: "Hotel SMC", competitorType: "SMC", roomType: "Companion",
      monthlyRateAvg: 250, careLevel2Rate: 40, distanceMiles: 2,
    },
  ] as any);

  // Competing tenant rows at the SAME locations — must never be selected
  await db.insert(competitiveSurveyData).values({
    keyStatsLocation: LOC_AL_DIRECT, surveyMonth: MONTH, clientId: "zztest-parity-other",
    competitorName: "Evil Tenant AL", competitorType: "AL", roomType: "Studio",
    monthlyRateAvg: 1, careLevel2Rate: 1, distanceMiles: 1,
  } as any);
  // Stale-month row for our tenant — latest-month policy must ignore it
  await db.insert(competitiveSurveyData).values({
    keyStatsLocation: LOC_AL_DIRECT, surveyMonth: "2025-01", clientId: CLIENT,
    competitorName: "Stale Month AL", competitorType: "AL", roomType: "Studio",
    monthlyRateAvg: 999, careLevel2Rate: 999, distanceMiles: 1,
  } as any);

  // ---- Path 1: batch job ----
  await seedUnits();
  const { jobId } = await startCompetitorRateJob(MONTH, CLIENT);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s: any = await getJobStatus(jobId);
    if (s.status !== "running" && s.status !== "pending") break;
  }
  const jobSnap = await snapshot();

  // ---- Path 2: recalculation ----
  await seedUnits();
  await processAllUnitsForCompetitorRates(MONTH, CLIENT);
  const recalcSnap = await snapshot();

  console.log("Job path:", JSON.stringify(jobSnap));
  console.log("Recalc path:", JSON.stringify(recalcSnap));

  for (const [label, snap] of [["job", jobSnap], ["recalc", recalcSnap]] as const) {
    const m = snap[LOC];
    check(!!m && m.competitorName === "Delta IL", `${label}: Private unit matched the Studio survey row (Delta IL)`);
    check(!!m && m.competitorBaseRate === 3800, `${label}: Private unit base rate is the Studio rate 3800 (got ${m?.competitorBaseRate})`);
    check(!!m && m.competitorFinalRate === 3800, `${label}: Private unit final rate 3800 with no SL adjustments (got ${m?.competitorFinalRate})`);
    const n = snap[LOC_NOMATCH];
    check(!!n && n.competitorName === null && n.competitorBaseRate === null && n.competitorFinalRate === null
      && n.competitorWeight === null && n.competitorCareLevel2Adjustment === null
      && n.competitorMedManagementAdjustment === null
      && n.competitorRate === null && n.competitorAdjustmentExplanation === null,
      `${label}: no-match unit had ALL stale competitor fields cleared to NULL (incl. legacy competitorRate + explanation)`);
    const mm: any = snap[LOC];
    check(!!mm && mm.competitorRate === mm.competitorFinalRate,
      `${label}: legacy competitorRate mirrors competitorFinalRate on match`);
    const dd: any = snap[LOC_AL_DIRECT];
    check(!!dd && typeof dd.competitorAdjustmentExplanation === "string" && dd.competitorAdjustmentExplanation.includes("Care Level 2"),
      `${label}: adjustment explanation stored on match`);

    // AL direct care: 1200 − 620 = +580; med mgmt +100; final = 4373+580+100
    const d = snap[LOC_AL_DIRECT];
    check(!!d && d.competitorName === "Echo AL", `${label}: AL direct-care unit picked current-tenant/current-month row (got ${d?.competitorName})`);
    check(!!d && near(d.competitorCareLevel2Adjustment, 580), `${label}: AL direct care adjustment +580 (got ${d?.competitorCareLevel2Adjustment})`);
    check(!!d && near(d.competitorFinalRate, 4373 + 580 + 100), `${label}: AL direct final 5053 (got ${d?.competitorFinalRate})`);

    // AL missing care: fallback $55/day → 1200 − 1674.20 = −474.20
    const f = snap[LOC_AL_FALLBACK];
    check(!!f && near(f.competitorCareLevel2Adjustment, 1200 - 55 * DPM), `${label}: AL missing-care unit used $55/day fallback (−474.20) (got ${f?.competitorCareLevel2Adjustment})`);

    // AL/MC inherits the AL care row: 1200 − 620 = +580, via legacy AL survey row
    const i = snap[LOC_ALMC_INHERIT];
    check(!!i && i.competitorName === "Golf Legacy AL", `${label}: AL/MC unit fell back to legacy AL survey row (got ${i?.competitorName})`);
    check(!!i && near(i.competitorCareLevel2Adjustment, 580), `${label}: AL/MC inherited AL care → +580 (got ${i?.competitorCareLevel2Adjustment})`);

    // HC/MC via legacy SMC, daily basis: comp care 40×30.44 − our HC 30×30.44 = 304.40/mo
    // stored daily: base 250, care 10, final 260
    const h = snap[LOC_HCMC];
    check(!!h && h.competitorName === "Hotel SMC", `${label}: HC/MC unit matched legacy SMC row (got ${h?.competitorName})`);
    check(!!h && near(h.competitorBaseRate, 250), `${label}: HC/MC stored base is daily 250 (got ${h?.competitorBaseRate})`);
    check(!!h && near(h.competitorCareLevel2Adjustment, 10), `${label}: HC/MC care adj stored daily +10 (inherited HC care) (got ${h?.competitorCareLevel2Adjustment})`);
    check(!!h && near(h.competitorFinalRate, 260), `${label}: HC/MC stored final is daily 260 (got ${h?.competitorFinalRate})`);
  }

  // Field-for-field parity between the two paths
  for (const loc of ALL_LOCS) {
    const a = jobSnap[loc] ?? {};
    const b = recalcSnap[loc] ?? {};
    const keys = Object.keys(COLS).filter(k => k !== "location");
    const diffs = keys.filter(k => JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k]));
    check(diffs.length === 0, `parity at ${loc}: identical stored fields across both write paths${diffs.length ? ` (diff: ${diffs.join(", ")})` : ""}`);
  }

  // ---- Regression: UNSCOPED ("all clients") batch job with COLLIDING tenant
  // locations must keep each tenant's survey rows isolated. Uses a month with
  // no real client data so the unscoped run only touches zztest rows.
  const XMONTH = "2027-01";
  const CLIENT_B = "zztest-parity-b";
  const COLLIDE = "ZZTEST Colliding Campus";
  await db.execute(sqlRaw`INSERT INTO clients (id, name) VALUES (${CLIENT_B}, 'ZZTEST Parity Client B') ON CONFLICT (id) DO NOTHING`);
  const xbase = { uploadMonth: XMONTH, date: "2027-01-01", occupiedYN: false, size: "300", streetRate: 3000, inHouseRate: 2900, location: COLLIDE, roomNumber: "C-1", roomType: "Studio", serviceLine: "SL" };
  await db.insert(rentRollData).values([
    { ...xbase, clientId: CLIENT },
    { ...xbase, clientId: CLIENT_B },
  ] as any);
  await db.insert(competitiveSurveyData).values([
    { keyStatsLocation: COLLIDE, surveyMonth: XMONTH, clientId: CLIENT, competitorName: "Tenant A Comp", competitorType: "IL_IL", roomType: "Studio", monthlyRateAvg: 3100, distanceMiles: 2 },
    { keyStatsLocation: COLLIDE, surveyMonth: XMONTH, clientId: CLIENT_B, competitorName: "Tenant B Comp", competitorType: "IL_IL", roomType: "Studio", monthlyRateAvg: 3900, distanceMiles: 2 },
  ] as any);
  const { jobId: xJobId } = await startCompetitorRateJob(XMONTH); // UNSCOPED
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s: any = await getJobStatus(xJobId);
    if (s.status !== "running" && s.status !== "pending") break;
  }
  const xRows = await db.select({ clientId: rentRollData.clientId, name: rentRollData.competitorName, base: rentRollData.competitorBaseRate })
    .from(rentRollData).where(eq(rentRollData.uploadMonth, XMONTH));
  const xa = xRows.find(r => r.clientId === CLIENT);
  const xb = xRows.find(r => r.clientId === CLIENT_B);
  check(!!xa && xa.name === "Tenant A Comp" && xa.base === 3100,
    `unscoped job: tenant A kept its own survey row at colliding campus (got ${xa?.name} @ ${xa?.base})`);
  check(!!xb && xb.name === "Tenant B Comp" && xb.base === 3900,
    `unscoped job: tenant B kept its own survey row at colliding campus (got ${xb?.name} @ ${xb?.base})`);
  await db.delete(rentRollData).where(eq(rentRollData.clientId, CLIENT_B));
  await db.delete(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, CLIENT_B));
  await db.execute(sqlRaw`DELETE FROM clients WHERE id = ${CLIENT_B}`);
  // Remove the colliding-campus rows for tenant A too, so the later
  // latest-month regression is not skewed by the 2027-01 survey month.
  await db.delete(rentRollData).where(eq(rentRollData.uploadMonth, XMONTH));
  await db.delete(competitiveSurveyData).where(eq(competitiveSurveyData.surveyMonth, XMONTH));
  invalidateLatestSurveyMonthCache(CLIENT);

  // ---- Regression: survey import followed by immediate recalculation must
  // use the NEW latest month (latest-month memo must not serve the old month).
  const NEW_MONTH = "2026-08";
  await db.insert(competitiveSurveyData).values({
    keyStatsLocation: LOC_AL_DIRECT, surveyMonth: NEW_MONTH, clientId: CLIENT,
    competitorName: "India New Month", competitorType: "AL", roomType: "Studio",
    monthlyRateAvg: 4600, careLevel2Rate: 1200, distanceMiles: 2,
  } as any);
  invalidateLatestSurveyMonthCache(CLIENT); // what the import path does
  await processAllUnitsForCompetitorRates(MONTH, CLIENT);
  const afterImport = await snapshot();
  const ni: any = afterImport[LOC_AL_DIRECT];
  check(!!ni && ni.competitorName === "India New Month" && near(ni.competitorBaseRate, 4600),
    `import-then-recalc: newly imported month wins immediately (got ${ni?.competitorName} @ ${ni?.competitorBaseRate})`);

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
