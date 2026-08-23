/**
 * Reference Data — Annual Increase columns.
 *
 * Applying an in-house increase plan adds per-group columns to the Reference
 * Data grid and takes over the Final rate for the occupied rooms it covers.
 * This drives the real endpoints end to end (calculate → apply → read the
 * grid) rather than re-implementing their SQL, because a test that embeds a
 * hand-copied query guards nothing.
 *
 * The four things most likely to break, and why each is checked:
 *
 *  1. BASIS. HC/HC-MC bill daily; senior housing bills monthly. The plan
 *     stores both, and picking `newRateMonthly` for an HC resident puts the
 *     column ~30x above the in-house rate sitting next to it. Both a monthly
 *     and a daily service line are exercised.
 *  2. COVERAGE. A plan only touches occupied rooms, so the group average must
 *     be over covered residents — never over the group's unit count.
 *  3. PARITY. The detail (per-unit) endpoint must sum back to the grouped one.
 *  4. NO IMPACT CONTAMINATION. Revenue Impact models new move-ins at a street
 *     rate. An annual increase reprices sitting residents and must leave those
 *     columns untouched, or the grid invents revenue.
 *
 * Requires the dev server on port 5000 and DATABASE_URL.
 */
import pkg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pkg;

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const CLIENT = "demo";
const USERNAME = "ptest_refdata_increase";
const PASSWORD = "ptest-password-1";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function ok(desc: string, cond: boolean, detail = "") {
  if (cond) { console.log(`${PASS} ${desc}`); passed++; }
  else { console.log(`${FAIL} ${desc}${detail ? `\n    ${detail}` : ""}`); failed++; }
}
function near(desc: string, actual: number | null, expected: number | null, tol: number) {
  if (actual === null || expected === null) {
    ok(desc, false, `expected ${expected}, got ${actual}`);
    return;
  }
  ok(desc, Math.abs(actual - expected) <= tol,
    `expected ${expected.toFixed(4)} ± ${tol}, got ${actual.toFixed(4)}`);
}

async function login(): Promise<string> {
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, client_id) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, client_id = $3`,
    [USERNAME, hash, CLIENT],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no session cookie returned");
  return cookie.split(";")[0];
}

async function getJson(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
async function postJson(path: string, cookie: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/** Pick a campus with enough occupied, in-house-rated rooms to be meaningful. */
async function pickScope(serviceLine: string) {
  const spot = (await pool.query(
    `SELECT MAX(upload_month) m FROM rent_roll_data WHERE client_id = $1`, [CLIENT],
  )).rows[0].m;
  const r = await pool.query(
    `SELECT rr.location, loc.id AS location_id,
            count(*) FILTER (WHERE rr.occupied_yn AND rr.in_house_rate > 0) AS occ
       FROM rent_roll_data rr
       JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
      WHERE rr.client_id = $1 AND rr.upload_month = $2 AND rr.service_line = $3
      GROUP BY 1, 2
      HAVING count(*) FILTER (WHERE rr.occupied_yn AND rr.in_house_rate > 0) > 8
      ORDER BY 3 DESC LIMIT 1`,
    [CLIENT, spot, serviceLine],
  );
  if (!r.rows.length) return null;
  return { location: r.rows[0].location, locationId: r.rows[0].location_id, serviceLine };
}

async function cleanup() {
  await pool.query(`DELETE FROM inhouse_rate_plans WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
}

/** Grouped + detail rows for one scope. */
async function readGrid(cookie: string, scope: { location: string; serviceLine: string }) {
  const qs = `locations=${encodeURIComponent(scope.location)}&serviceLine=${encodeURIComponent(scope.serviceLine)}`;
  const grouped = await getJson(`/api/reference-data?${qs}`, cookie);
  const detail = await getJson(`/api/reference-data/units?${qs}`, cookie);
  return { grouped: grouped.rows as any[], detail: detail.rows as any[] };
}

async function runScope(cookie: string, scope: { location: string; locationId: string; serviceLine: string }, isDaily: boolean) {
  const label = `${scope.location} / ${scope.serviceLine}`;
  console.log(`\n── ${label} (${isDaily ? "daily-billed" : "monthly-billed"}) ──`);

  // Snapshot the move-in-based impact BEFORE any plan exists. This is the
  // baseline for the contamination check further down.
  const before = await readGrid(cookie, scope);
  const beforeImpact = new Map<string, number | null>();
  const beforeUnits = new Map<string, number>();
  for (const r of before.grouped) {
    beforeImpact.set(r.roomType, r.revMonthlyImpact ?? null);
    beforeUnits.set(r.roomType, Number(r.totalUnits) || 0);
  }
  ok(`${label}: grid has rows before applying`, before.grouped.length > 0);
  ok(`${label}: no increase columns before applying`,
    before.grouped.every((r) => r.ihPlanNewRate === null && r.ihPlanResidents === null));

  // Calculate, then apply through the real endpoint so cache invalidation is
  // exercised too — a stale cache would serve pre-plan numbers for 10 minutes.
  const assumpRes = await getJson(
    `/api/inhouse-planning/assumptions?locationId=${scope.locationId}&serviceLine=${encodeURIComponent(scope.serviceLine)}`,
    cookie,
  );
  const assumptions = assumpRes.assumptions ?? assumpRes;
  const calc = await postJson("/api/inhouse-planning/calculate", cookie, {
    locationId: scope.locationId, serviceLine: scope.serviceLine, assumptions,
  });
  const plan = calc.plan ?? calc;
  const residents: any[] = plan.residents ?? [];
  ok(`${label}: plan produced residents`, residents.length > 0, `got ${residents.length}`);
  if (!residents.length) return;

  await postJson("/api/inhouse-planning/apply", cookie, {
    locationId: scope.locationId, serviceLine: scope.serviceLine, assumptions,
  });

  const after = await readGrid(cookie, scope);
  const covered = after.grouped.filter((r) => r.ihPlanResidents);
  ok(`${label}: increase columns populated after applying`, covered.length > 0);
  if (!covered.length) return;

  // ── 1. Basis ────────────────────────────────────────────────────────────
  // The new in-house rate must sit in the same basis as the in-house rate
  // beside it. A monthly figure on a daily line lands ~30x too high.
  for (const r of covered) {
    if (r.ihSpot && r.ihSpot > 0) {
      const ratio = r.ihPlanNewRate / r.ihSpot;
      ok(`${label} / ${r.roomType}: new rate is in the rent roll's basis (ratio ${ratio.toFixed(2)})`,
        ratio > 0.8 && ratio < 1.6,
        `ihPlanNewRate=${r.ihPlanNewRate?.toFixed(2)} vs ihSpot=${r.ihSpot?.toFixed(2)} — a ~30x ratio means monthly/daily were mixed`);
    }
  }

  // ── 2. Coverage ─────────────────────────────────────────────────────────
  for (const r of covered) {
    ok(`${label} / ${r.roomType}: residents covered ≤ units in group`,
      r.ihPlanResidents <= (Number(r.totalUnits) || 0),
      `${r.ihPlanResidents} residents vs ${r.totalUnits} units`);
    // Averaging over units instead of residents would drag the rate down
    // toward zero for any group with vacancy.
    const occupied = (Number(r.totalUnits) || 0) - (Number(r.vacantSpot) || 0);
    ok(`${label} / ${r.roomType}: coverage does not exceed occupied rooms`,
      r.ihPlanResidents <= occupied + 0.5,
      `${r.ihPlanResidents} covered vs ${occupied} occupied`);
  }

  // Δ% must come from summed components, not an average of percentages.
  for (const r of covered) {
    if (r.ihPlanCurrentRate > 0) {
      // Both sides of the ratio must be in the DISPLAY basis. Using the monthly
      // impact here would silently pass for monthly-billed lines and be ~30x
      // off for daily-billed ones.
      near(`${label} / ${r.roomType}: Δ% derived from summed components`,
        r.ihPlanDeltaPct,
        r.ihPlanDeltaDollar / r.ihPlanCurrentRate,
        1e-6);
    }
  }

  // Monthly Impact must be MONTHLY on every service line, while Δ$ stays in the
  // rent roll's own basis. For a daily-billed line the two therefore differ by
  // DAYS_PER_MONTH; for a monthly-billed line they coincide. Asserting the ratio
  // catches the regression where the daily delta is summed and labelled monthly.
  const DAYS_PER_MONTH = 365 / 12;
  const expectedRatio = isDaily ? DAYS_PER_MONTH : 1;
  for (const r of covered) {
    const perResidentDelta = r.ihPlanDeltaDollar * r.ihPlanResidents;
    if (Math.abs(perResidentDelta) > 0.01) {
      near(`${label} / ${r.roomType}: monthly impact is monthly, not ${isDaily ? "daily" : "mis-scaled"}`,
        r.ihPlanMonthlyImpact / perResidentDelta, expectedRatio, 0.02);
    }
  }

  // ── 3. Detail → grouped parity ──────────────────────────────────────────
  const byGroup = new Map<string, any[]>();
  for (const d of after.detail) {
    const k = d.roomType;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(d);
  }
  for (const r of covered) {
    const units = byGroup.get(r.roomType) ?? [];
    const dResidents = units.reduce((s, u) => s + (Number(u.ihPlanResidents) || 0), 0);
    const dImpact = units.reduce((s, u) => s + (Number(u.ihPlanMonthlyImpact) || 0), 0);
    const dRateSum = units.reduce(
      (s, u) => s + (u.ihPlanNewRate !== null ? Number(u.ihPlanNewRate) * (Number(u.ihPlanResidents) || 0) : 0), 0);

    ok(`${label} / ${r.roomType}: detail residents sum to grouped`,
      dResidents === r.ihPlanResidents, `detail ${dResidents} vs grouped ${r.ihPlanResidents}`);
    near(`${label} / ${r.roomType}: detail monthly impact sums to grouped`,
      dImpact, r.ihPlanMonthlyImpact, 0.51);
    if (dResidents > 0) {
      near(`${label} / ${r.roomType}: residents-weighted detail rate matches grouped`,
        dRateSum / dResidents, r.ihPlanNewRate, 0.51);
    }
    // Uncovered rooms must carry null, not 0 — a 0 would drag the average down.
    ok(`${label} / ${r.roomType}: uncovered rooms carry null, not 0`,
      units.every((u) => u.ihPlanNewRate === null || Number(u.ihPlanNewRate) > 0));
  }

  // ── 4. Final take-over, and no impact contamination ─────────────────────
  for (const r of covered) {
    if (!r.hasManualOverride) {
      near(`${label} / ${r.roomType}: Final shows the increase`,
        r.proposedRule, r.ihPlanNewRate, 0.51);
      ok(`${label} / ${r.roomType}: flagged as plan-driven`, r.finalFromPlan === true);
    }
  }
  for (const r of after.grouped) {
    const b = beforeImpact.get(r.roomType) ?? null;
    const a = r.revMonthlyImpact ?? null;
    if (b === null && a === null) {
      ok(`${label} / ${r.roomType}: move-in revenue impact still absent`, true);
    } else {
      near(`${label} / ${r.roomType}: move-in revenue impact unchanged by the increase`,
        a, b, 0.51);
    }
  }
}

async function main() {
  await cleanup();
  const cookie = await login();
  try {
    const al = await pickScope("AL");
    const hc = await pickScope("HC");
    if (!al && !hc) {
      console.log("No demo scope with enough occupied in-house-rated rooms; nothing to test.");
      return;
    }
    if (al) await runScope(cookie, al, false);
    if (hc) await runScope(cookie, hc, true);
  } finally {
    await cleanup();
    console.log(
      "\nNote: plans were deleted, but the dev server's reference-data cache may hold " +
      "plan values for up to 10 minutes. Restart the app for a clean grid.",
    );
  }

  console.log(`\n=== Summary ===\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
