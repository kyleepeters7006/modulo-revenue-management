/**
 * Focused Reference Data regression for annual-plan street targets.
 *
 * This keeps the resident recommendation and the street recommendation
 * deliberately asymmetric: the plan covers one room-type group, while its
 * street target must appear on every room-type row in the campus/service-line
 * scope. The test then edits the proposal, verifies the linked rule and the
 * post-invalidation response, and confirms an applied plan is read-only.
 *
 * Requires a running dev server on port 5000 and DATABASE_URL.
 */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import pg from "pg";
import {
  createTotpSecret,
  encryptSecret,
  totpCode,
} from "../server/security";

const { Pool } = pg;
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const CLIENT = "demo";
const SUFFIX = `${Date.now()}-${process.pid}`;
const USERNAME = `ptest_refdata_street_${SUFFIX}`;
const PASSWORD = "ptest-password-1";
const MFA_SECRET = createTotpSecret();
const CACHE_VARIANT = 1 + (Number(SUFFIX.split("-")[0]) % 997);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type AuthContext = { cookie: string; csrfToken: string };
type ScopeRow = {
  location: string;
  location_id: string;
  service_line: string;
  display_room_types: number;
};
type RentRollRow = {
  location: string;
  room_type: string;
  display_room_type: string;
  room_number: string;
  move_in_date: string | null;
  street_rate: number;
  in_house_rate: number;
};

let proposedPlanId = "";

async function cleanup() {
  if (proposedPlanId) {
    await pool.query(
      `DELETE FROM adjustment_rules
        WHERE client_id = $1 AND action->>'annualPlanId' = $2`,
      [CLIENT, proposedPlanId],
    );
    await pool.query(
      `DELETE FROM inhouse_rate_plans WHERE client_id = $1 AND id = $2`,
      [CLIENT, proposedPlanId],
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM sessions
        WHERE sid IN (
          SELECT session_id
            FROM auth_sessions
           WHERE user_id IN (SELECT id FROM users WHERE username = $1)
        )`,
      [USERNAME],
    );
    await client.query(
      `DELETE FROM security_audit_events
        WHERE user_id IN (SELECT id FROM users WHERE username = $1)`,
      [USERNAME],
    );
    await client.query(
      `DELETE FROM mfa_recovery_codes
        WHERE user_id IN (SELECT id FROM users WHERE username = $1)`,
      [USERNAME],
    );
    await client.query(
      `DELETE FROM password_reset_tokens
        WHERE user_id IN (SELECT id FROM users WHERE username = $1)`,
      [USERNAME],
    );
    await client.query(
      `DELETE FROM auth_sessions
        WHERE user_id IN (SELECT id FROM users WHERE username = $1)`,
      [USERNAME],
    );
    await client.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function login(): Promise<AuthContext> {
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users
       (username, password_hash, client_id, role, account_status,
        mfa_enabled, mfa_secret_encrypted, mfa_last_used_step)
     VALUES ($1, $2, $3, 'admin', 'active', true, $4, NULL)`,
    [USERNAME, hash, CLIENT, encryptSecret(MFA_SECRET)],
  );

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const loginText = await res.text();
  assert.equal(res.ok, true, `login failed: ${res.status} ${loginText}`);
  const firstCookie = res.headers.get("set-cookie");
  assert.ok(firstCookie, "password login returned a session cookie");
  let cookie = firstCookie!.split(";")[0];
  const loginResult = JSON.parse(loginText) as { mfaRequired?: boolean };
  assert.equal(loginResult.mfaRequired, true, "password login requires MFA");

  const challenge = await fetch(`${BASE}/api/auth/mfa/challenge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: BASE,
    },
    body: JSON.stringify({ code: totpCode(MFA_SECRET).code }),
  });
  assert.equal(challenge.ok, true, `MFA challenge failed: ${await challenge.text()}`);
  const challengeCookie = challenge.headers.get("set-cookie");
  if (challengeCookie) cookie = challengeCookie.split(";")[0];

  const csrf = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { Cookie: cookie, Origin: BASE },
  });
  const csrfText = await csrf.text();
  assert.equal(csrf.ok, true, `CSRF request failed: ${csrfText}`);
  const csrfToken = (JSON.parse(csrfText) as { token: string }).token;
  return { cookie, csrfToken };
}

async function getReferenceData(
  auth: AuthContext,
  location: string,
  serviceLine?: string,
) {
  // The fixture writes directly to the database, so it cannot call the
  // server's cache invalidator. Repeating the same location is SQL-equivalent
  // but gives each run a fresh cache key, including after an interrupted run.
  const locations = Array.from({ length: CACHE_VARIANT }, () => location).join(",");
  const params = new URLSearchParams({ locations });
  if (serviceLine) params.set("serviceLine", serviceLine);
  const res = await fetch(`${BASE}/api/reference-data?${params}`, {
    headers: { Cookie: auth.cookie, Origin: BASE },
  });
  const text = await res.text();
  assert.equal(res.ok, true, `Reference Data failed: ${res.status} ${text}`);
  return JSON.parse(text) as { rows: Record<string, any>[] };
}

async function patchStreetRate(
  auth: AuthContext,
  planId: string,
  streetRate: number,
) {
  const res = await fetch(
    `${BASE}/api/inhouse-planning/plans/${encodeURIComponent(planId)}/street-rate`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: auth.cookie,
        Origin: BASE,
        "x-csrf-token": auth.csrfToken,
      },
      body: JSON.stringify({ streetRate }),
    },
  );
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function pickScope(): Promise<{ scope: ScopeRow; rows: RentRollRow[] }> {
  const spot = (await pool.query<{ month: string | null }>(
    `SELECT MAX(upload_month) AS month
       FROM rent_roll_data
      WHERE client_id = $1`,
    [CLIENT],
  )).rows[0]?.month;
  assert.ok(spot, "demo rent-roll fixture has a current month");

  const scopes = await pool.query<ScopeRow>(
    `SELECT rr.location, loc.id AS location_id, rr.service_line,
            COUNT(DISTINCT COALESCE(rtg.group_name, rr.room_type))::int AS display_room_types
       FROM rent_roll_data rr
       JOIN locations loc
         ON loc.client_id = rr.client_id AND loc.name = rr.location
       LEFT JOIN room_type_groupings rtg
         ON rtg.client_id = rr.client_id AND rtg.location = rr.location
        AND rtg.service_line = rr.service_line
        AND rtg.source_room_type = rr.source_room_type
      WHERE rr.client_id = $1
        AND rr.upload_month = $2
        AND rr.street_rate > 0
      GROUP BY rr.location, loc.id, rr.service_line
     HAVING COUNT(DISTINCT COALESCE(rtg.group_name, rr.room_type)) >= 2
      ORDER BY COUNT(DISTINCT COALESCE(rtg.group_name, rr.room_type)) DESC,
               rr.location, rr.service_line
      LIMIT 1`,
    [CLIENT, spot],
  );
  assert.ok(scopes.rows[0], "demo fixture has a campus/service-line with two room-type groups");

  const rows = await pool.query<RentRollRow>(
    `SELECT rr.location, rr.room_type,
            COALESCE(rtg.group_name, rr.room_type) AS display_room_type,
            rr.room_number, rr.move_in_date::text AS move_in_date,
            rr.street_rate, rr.in_house_rate
       FROM rent_roll_data rr
       LEFT JOIN room_type_groupings rtg
         ON rtg.client_id = rr.client_id AND rtg.location = rr.location
        AND rtg.service_line = rr.service_line
        AND rtg.source_room_type = rr.source_room_type
      WHERE rr.client_id = $1
        AND rr.upload_month = $2
        AND rr.location = $3
        AND rr.service_line = $4
        AND rr.street_rate > 0
        AND rr.room_number IS NOT NULL
      ORDER BY COALESCE(rtg.group_name, rr.room_type), rr.room_number`,
    [CLIENT, spot, scopes.rows[0].location, scopes.rows[0].service_line],
  );
  const usableGroups = new Set(
    rows.rows
      .filter((row) => Number(row.in_house_rate) > 0)
      .map((row) => row.display_room_type),
  );
  assert.ok(usableGroups.size >= 2, "scope has two street groups and a usable in-house resident");
  return { scope: scopes.rows[0], rows: rows.rows };
}

async function insertProposedPlan(scope: ScopeRow, resident: RentRollRow) {
  const baseline = await pool.query<{ current_rate: string }>(
    `SELECT AVG(street_rate)::text AS current_rate
       FROM rent_roll_data
      WHERE client_id = $1 AND upload_month = (
        SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1
      ) AND location = $2 AND service_line = $3 AND street_rate > 0`,
    [CLIENT, scope.location, scope.service_line],
  );
  const currentStreetRateMonthly = Number(baseline.rows[0]?.current_rate);
  assert.ok(currentStreetRateMonthly > 0, "fixture has an immutable street-rate baseline");
  const versionRow = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM inhouse_rate_plans
      WHERE client_id = $1 AND location = $2 AND service_line = $3`,
    [CLIENT, scope.location, scope.service_line],
  );
  const version = Number(versionRow.rows[0]?.next) || 1;
  const residentCurrentRate = Number(resident.in_house_rate);
  const residentNewRate = residentCurrentRate + 100;
  const residents = [{
    location: resident.location,
    roomNumber: String(resident.room_number),
    roomType: resident.room_type,
    moveInDate: resident.move_in_date,
    currentRateDisplay: residentCurrentRate,
    newRateDisplay: residentNewRate,
    increaseDollarsDisplay: 100,
    increaseDollarsMonthly: 100,
    increasePct: 100 / residentCurrentRate,
    isCompanionBed: false,
  }];
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO inhouse_rate_plans
       (client_id, location_id, location, service_line, version, status,
        assumptions, summary, quarters, residents,
        street_rate_effective_date, inhouse_effective_date, recommended_street_rate)
     VALUES ($1, $2, $3, $4, $5, 'proposed', $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      CLIENT,
      scope.location_id,
      scope.location,
      scope.service_line,
      version,
      JSON.stringify({}),
      JSON.stringify({ currentStreetRateDisplay: currentStreetRateMonthly }),
      JSON.stringify([]),
      JSON.stringify(residents),
      "2027-01-01",
      "2027-01-01",
      Number(resident.street_rate) + 250,
    ],
  );
  proposedPlanId = plan.rows[0]?.id ?? "";
  assert.ok(proposedPlanId, "test plan was created");

  await pool.query(
    `INSERT INTO adjustment_rules
       (client_id, location_id, service_line, service_lines, name, description,
        trigger, action, is_active, lifecycle_status, effective_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'proposed', $9)`,
    [
      CLIENT,
      scope.location_id,
      scope.service_line,
      [scope.service_line],
      `Annual street regression ${SUFFIX}`,
      "Initial annual street target",
      JSON.stringify({ type: "immediate" }),
      JSON.stringify({
        type: "adjust_rate",
        target: "street_rate",
        adjustmentType: "percentage",
        adjustmentValue: 1,
        filters: { serviceLine: [scope.service_line], location: [scope.location] },
        annualPlanId: proposedPlanId,
        proposalType: "annual_plan_street_rate",
      }),
      "2027-01-01",
    ],
  );
  await pool.query(
    `INSERT INTO adjustment_rules
       (client_id, location_id, service_line, service_lines, name, description,
        trigger, action, is_active, lifecycle_status, effective_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'proposed', $9)`,
    [
      CLIENT,
      scope.location_id,
      scope.service_line,
      [scope.service_line],
      `Annual in-house regression ${SUFFIX}`,
      "Initial annual in-house proposal",
      JSON.stringify({ type: "immediate" }),
      JSON.stringify({
        type: "annual_inhouse_plan",
        adjustmentValue: 1,
        filters: { serviceLine: [scope.service_line], location: [scope.location] },
        annualPlanId: proposedPlanId,
        proposalType: "inhouse_rate_plan",
      }),
      "2027-01-01",
    ],
  );
}

async function main() {
  await cleanup();
  const auth = await login();
  const { scope, rows } = await pickScope();
  const resident = rows.find((row) => Number(row.in_house_rate) > 0);
  assert.ok(resident, "scope has a resident with an in-house rate");
  await insertProposedPlan(scope, resident!);

  try {
    const initial = await getReferenceData(auth, scope.location, scope.service_line);
    const targetBefore = Number(resident!.street_rate) + 250;
    const coveredGroup = initial.rows.find(
      (row) => row.ihRecommendationPlanId === proposedPlanId &&
        row.ihRecommendationResidents !== null,
    );
    const uncoveredGroup = initial.rows.find(
      (row) => row.ihRecommendationPlanId === proposedPlanId &&
        row.ihRecommendationResidents === null,
    );
    assert.ok(coveredGroup, "the resident recommendation is visible in its covered group");
    assert.ok(uncoveredGroup, "the street target is visible in a group with no resident recommendation");
    assert.equal(Number(uncoveredGroup!.ihRecommendationStreetRate), targetBefore);
    assert.equal(uncoveredGroup!.ihRecommendationStreetStatus, "proposed");

    await pool.query(
      `UPDATE adjustment_rules SET lifecycle_status = 'implemented'
        WHERE client_id = $1 AND action->>'annualPlanId' = $2`,
      [CLIENT, proposedPlanId],
    );
    const approvedEdit = await patchStreetRate(auth, proposedPlanId, targetBefore + 10);
    assert.equal(approvedEdit.status, 409, "implemented linked rules lock annual edits");
    await pool.query(
      `UPDATE adjustment_rules SET lifecycle_status = 'proposed'
        WHERE client_id = $1 AND action->>'annualPlanId' = $2`,
      [CLIENT, proposedPlanId],
    );

    const currentRateRow = await pool.query<{ current_rate: string }>(
      `SELECT AVG(street_rate)::text AS current_rate
         FROM rent_roll_data
        WHERE client_id = $1 AND upload_month = (
          SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1
        ) AND location = $2 AND service_line = $3 AND street_rate > 0`,
      [CLIENT, scope.location, scope.service_line],
    );
    const currentRate = Number(currentRateRow.rows[0]?.current_rate);
    const targetAfter = targetBefore + 125;
    const edited = await patchStreetRate(auth, proposedPlanId, targetAfter);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(Number(edited.body?.streetRate), targetAfter);

    const stored = await pool.query<{ recommended_street_rate: string }>(
      `SELECT recommended_street_rate::text
         FROM inhouse_rate_plans WHERE id = $1 AND client_id = $2`,
      [proposedPlanId, CLIENT],
    );
    assert.equal(Number(stored.rows[0]?.recommended_street_rate), targetAfter);

    const linkedRule = await pool.query<{ adjustment_value: string }>(
      `SELECT action->>'adjustmentValue' AS adjustment_value
         FROM adjustment_rules
        WHERE client_id = $1 AND action->>'annualPlanId' = $2
          AND action->>'proposalType' = 'annual_plan_street_rate'`,
      [CLIENT, proposedPlanId],
    );
    assert.equal(linkedRule.rows.length, 1, "the plan has one linked street proposal");
    assert.ok(
      Math.abs(Number(linkedRule.rows[0]?.adjustment_value) -
        ((targetAfter - currentRate) / currentRate) * 100) < 1e-9,
      "the linked rule stores the edited target's percentage",
    );

    // Same query key as the warmed response: this proves the edit invalidated
    // the server cache instead of waiting for its ten-minute TTL.
    const afterEdit = await getReferenceData(auth, scope.location, scope.service_line);
    const editedUncovered = afterEdit.rows.find(
      (row) => row.ihRecommendationPlanId === proposedPlanId &&
        row.ihRecommendationResidents === null,
    );
    assert.ok(editedUncovered, "the uncovered group remains in Reference Data after editing");
    assert.equal(Number(editedUncovered!.ihRecommendationStreetRate), targetAfter);

    await pool.query(
      `UPDATE inhouse_rate_plans SET status = 'applied' WHERE id = $1 AND client_id = $2`,
      [proposedPlanId, CLIENT],
    );
    // A different cache key forces a fresh read after the direct fixture
    // transition, while preserving the same campus filter.
    const applied = await getReferenceData(auth, scope.location);
    const appliedRow = applied.rows.find(
      (row) => row.campus === scope.location && row.serviceLine === scope.service_line,
    );
    assert.ok(appliedRow, "the applied plan remains visible");
    assert.equal(appliedRow!.ihPlanStreetStatus, "applied");
    assert.equal(Number(appliedRow!.ihPlanStreetRate), targetAfter);

    const locked = await patchStreetRate(auth, proposedPlanId, targetAfter + 50);
    assert.equal(locked.status, 409, "applied plans cannot be edited");
    console.log("Reference Data annual street-plan regression passed");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});