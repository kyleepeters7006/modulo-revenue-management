/**
 * Endpoint regression test for manual rate override attribution.
 *
 * Verifies that the original creator remains attached to an override after a
 * second user edits it, while the latest editor is recorded separately.
 *
 * Requires the dev server on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/manualRateOverrideAudit.test.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import {
  createRecoveryCodes,
  createTotpSecret,
  encryptSecret,
  hashRecoveryCode,
  totpCode,
} from "../server/security";

const { Pool } = pg;
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const CLIENT = "demo";
const SUFFIX = `${Date.now()}-${process.pid}`;
const USER_A = `ptest_override_a_${SUFFIX}`;
const USER_B = `ptest_override_b_${SUFFIX}`;
const PASSWORD = "ptest-password-1";
let locationName = `Audit Test ${SUFFIX}`;
let serviceLine = "AL";
let roomType = "Studio";

const importLocationName = `Import Audit ${SUFFIX}`;
const legacyActor = `legacy-importer-${SUFFIX}`;
const legacyLocationName = `Legacy Audit ${SUFFIX}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;
type AuthContext = { cookie: string; csrfToken: string };
const testSecrets = new Map<string, string>();

function sessionIdFromCookie(cookie: string): string {
  const value = decodeURIComponent(cookie.split("=")[1] || "");
  if (!value.startsWith("s:")) throw new Error("session cookie was not signed");
  const signatureStart = value.lastIndexOf(".");
  if (signatureStart <= 2) throw new Error("session cookie did not contain a session id");
  return value.slice(2, signatureStart);
}

function assert(desc: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`${PASS} ${desc}`);
    passed++;
  } else {
    console.log(`${FAIL} ${desc}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

async function login(username: string): Promise<AuthContext> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed for ${username}: ${response.status} ${await response.text()}`);
  const firstCookie = response.headers.get("set-cookie");
  if (!firstCookie) throw new Error(`no session cookie returned for ${username}`);
  let cookie = firstCookie.split(";")[0];
  const loginResult = await response.json() as { mfaRequired?: boolean };
  if (loginResult.mfaRequired) {
    const challenge = await fetch(`${BASE}/api/auth/mfa/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
      body: JSON.stringify({ code: totpCode(testSecrets.get(username)!).code }),
    });
    if (!challenge.ok) throw new Error(`MFA challenge failed for ${username}: ${challenge.status} ${await challenge.text()}`);
    const challengeCookie = challenge.headers.get("set-cookie");
    if (challengeCookie) cookie = challengeCookie.split(";")[0];
  }
  const csrf = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: cookie, Origin: BASE } });
  if (!csrf.ok) throw new Error(`CSRF token failed for ${username}: ${csrf.status}`);
  const csrfToken = (await csrf.json() as { token: string }).token;
  return { cookie, csrfToken };
}

async function postOverride(auth: AuthContext | null, rate: number, notes: string, segment = {
  locationName,
  serviceLine,
  roomType,
}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: BASE };
  if (auth) {
    headers.Cookie = auth.cookie;
    headers["x-csrf-token"] = auth.csrfToken;
  }
  const response = await fetch(`${BASE}/api/manual-rate-override`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...segment,
      overrideRate: rate,
      notes,
    }),
  });
  if (!response.ok) throw new Error(`override save failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function cleanup() {
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    await dbClient.query("SET LOCAL app.manual_rate_override_audit_cleanup = 'test'");
    await dbClient.query(
      `DELETE FROM manual_rate_override_history
        WHERE client_id = $1
          AND (location_name, service_line, room_type) IN
              (($2, $3, $4), ($5, $6, $7), ($8, $9, $10))`,
      [
        CLIENT,
        locationName, serviceLine, roomType,
        importLocationName, serviceLine, roomType,
        legacyLocationName, serviceLine, roomType,
      ],
    );
    await dbClient.query(
      `DELETE FROM manual_rate_overrides
        WHERE client_id = $1
          AND (location_name, service_line, room_type) IN
              (($2, $3, $4), ($5, $6, $7), ($8, $9, $10))`,
      [
        CLIENT,
        locationName, serviceLine, roomType,
        importLocationName, serviceLine, roomType,
        legacyLocationName, serviceLine, roomType,
      ],
    );
    await dbClient.query("COMMIT");
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
  await pool.query(
    `DELETE FROM security_audit_events
      WHERE user_id IN (SELECT id FROM users WHERE username = ANY($1))`,
    [[USER_A, USER_B]],
  );
  await pool.query(`DELETE FROM users WHERE username = ANY($1)`, [[USER_A, USER_B]]);
}

async function main() {
  await cleanup();
  try {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const secretA = createTotpSecret();
    const secretB = createTotpSecret();
    testSecrets.set(USER_A, secretA);
    testSecrets.set(USER_B, secretB);
    const userRows = await pool.query<{ id: string; username: string }>(
      `INSERT INTO users (username, password_hash, client_id, mfa_enabled,
                          mfa_secret_encrypted)
       VALUES ($1, $2, $3, true, $4), ($5, $2, $3, true, $6)
       RETURNING id, username`,
      [USER_A, hash, CLIENT, encryptSecret(secretA), USER_B, encryptSecret(secretB)],
    );
    const userIds = new Map(userRows.rows.map((row) => [row.username, row.id]));
    const [seedRecoveryCode] = createRecoveryCodes(1);
    await pool.query(
      `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
      [userIds.get(USER_A), await hashRecoveryCode(seedRecoveryCode)],
    );

    const authA = await login(USER_A);
    const beforeEnrollmentAttempt = (await pool.query(
      `SELECT mfa_secret_encrypted,
              (SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id = users.id) AS recovery_count
         FROM users WHERE id = $1`,
      [userIds.get(USER_A)],
    )).rows[0];
    const passwordOnlyLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ username: USER_A, password: PASSWORD }),
    });
    const pendingCookie = passwordOnlyLogin.headers.get("set-cookie")?.split(";")[0];
    const setupBypass = await fetch(`${BASE}/api/auth/mfa/setup`, {
      method: "POST",
      headers: { Cookie: pendingCookie || "", Origin: BASE },
    });
    const confirmBypass = await fetch(`${BASE}/api/auth/mfa/setup/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: pendingCookie || "",
        Origin: BASE,
      },
      body: JSON.stringify({ code: totpCode(secretA).code }),
    });
    const afterEnrollmentAttempt = (await pool.query(
      `SELECT mfa_secret_encrypted,
              (SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id = users.id) AS recovery_count
         FROM users WHERE id = $1`,
      [userIds.get(USER_A)],
    )).rows[0];
    assert(
      "MFA-enabled users cannot start enrollment from a password-only session",
      setupBypass.status === 400,
      `got ${setupBypass.status}`,
    );
    assert(
      "MFA-enabled users cannot confirm enrollment from a password-only session",
      confirmBypass.status === 400,
      `got ${confirmBypass.status}`,
    );
    assert(
      "blocked enrollment leaves the existing factor and recovery codes unchanged",
      afterEnrollmentAttempt?.mfa_secret_encrypted === beforeEnrollmentAttempt?.mfa_secret_encrypted &&
        Number(afterEnrollmentAttempt?.recovery_count) === Number(beforeEnrollmentAttempt?.recovery_count),
    );
    const referenceResponse = await fetch(`${BASE}/api/reference-data`, {
      headers: { Cookie: authA.cookie },
    });
    if (!referenceResponse.ok) {
      throw new Error(`reference data failed: ${referenceResponse.status} ${await referenceResponse.text()}`);
    }
    const referenceData = await referenceResponse.json() as { rows?: Array<Record<string, unknown>> };
    const target = referenceData.rows?.find((row) =>
      row.campus && row.serviceLine && row.roomType,
    );
    if (!target) throw new Error("could not find a grouped Reference Data row for the audit test");
    locationName = String(target.campus);
    serviceLine = String(target.serviceLine);
    roomType = String(target.roomType);

    const first = await postOverride(authA, 4999, "set by first user");
    assert("create records the original creator", first.created_by === userIds.get(USER_A),
      `expected ${userIds.get(USER_A)}, got ${first.created_by}`);
    assert("create records the initial updater", first.updated_by === userIds.get(USER_A),
      `expected ${userIds.get(USER_A)}, got ${first.updated_by}`);
    assert("create returns audit timestamps", Boolean(first.created_at && first.updated_at));
    assert("create starts with matching created and updated timestamps",
      String(first.created_at) === String(first.updated_at),
      `got ${first.created_at} / ${first.updated_at}`);

    const createdAt = String(first.created_at);
    const initialUpdatedAt = String(first.updated_at);
    const authB = await login(USER_B);
    const invalidSeed = await fetch(`${BASE}/api/admin/seed-clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": "not-the-seed" },
      body: JSON.stringify({}),
    });
    assert("invalid seed headers cannot bypass authentication", invalidSeed.status === 401,
      `got ${invalidSeed.status}`);
    const stepUp = await fetch(`${BASE}/api/auth/mfa/step-up`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authB.cookie,
        Origin: BASE,
        "x-csrf-token": authB.csrfToken,
      },
      body: JSON.stringify({
        code: totpCode(testSecrets.get(USER_B)!, (Math.floor(Date.now() / 30_000) + 1) * 30_000).code,
      }),
    });
    assert("authenticated users can refresh recent MFA with a new TOTP step", stepUp.status === 200,
      `got ${stepUp.status} ${await stepUp.text()}`);

    const mfaState = (await pool.query(
      `SELECT mfa_last_used_step FROM users WHERE id = $1`,
      [userIds.get(USER_A)],
    )).rows[0];
    const nextStep = Math.max(
      Number(mfaState?.mfa_last_used_step || 0) + 1,
      Math.floor(Date.now() / 30_000),
    );
    const regenerateRecovery = () => fetch(`${BASE}/api/auth/mfa/recovery/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authA.cookie,
        Origin: BASE,
        "x-csrf-token": authA.csrfToken,
      },
      body: JSON.stringify({
        password: PASSWORD,
        code: totpCode(testSecrets.get(USER_A)!, nextStep * 30_000).code,
      }),
    });
    const [regenOne, regenTwo] = await Promise.all([regenerateRecovery(), regenerateRecovery()]);
    const regenStatuses = [regenOne.status, regenTwo.status];
    assert(
      "concurrent recovery regeneration accepts only one TOTP step",
      regenStatuses.filter((status) => status === 200).length === 1 &&
        regenStatuses.filter((status) => status === 401).length === 1,
      `got ${regenStatuses.join(", ")}`,
    );

    const second = await postOverride(authB, 5099, "updated by second user");
    assert("update preserves the original creator", second.created_by === userIds.get(USER_A),
      `expected ${userIds.get(USER_A)}, got ${second.created_by}`);
    assert("update records the latest updater", second.updated_by === userIds.get(USER_B),
      `expected ${userIds.get(USER_B)}, got ${second.updated_by}`);
    assert("update preserves the original timestamp", String(second.created_at) === createdAt,
      `expected ${createdAt}, got ${second.created_at}`);
    assert("update advances updated_at", new Date(String(second.updated_at)).getTime() > new Date(initialUpdatedAt).getTime(),
      `expected ${second.updated_at} after ${initialUpdatedAt}`);
    assert("update response includes both actor names",
      second.created_by_name === USER_A && second.updated_by_name === USER_B,
      `got ${second.created_by_name} / ${second.updated_by_name}`);
    const persistedUpdate = (await pool.query(
      `SELECT created_by, updated_by, created_at, updated_at
         FROM manual_rate_overrides
        WHERE client_id = $1 AND location_name = $2 AND service_line = $3 AND room_type = $4`,
      [CLIENT, locationName, serviceLine, roomType],
    )).rows[0];
    assert("database update preserves creator and records updater",
      persistedUpdate?.created_by === userIds.get(USER_A) &&
        persistedUpdate?.updated_by === userIds.get(USER_B));
    assert("database update timestamp is newer than creation",
      persistedUpdate?.updated_at > persistedUpdate?.created_at,
      `got ${persistedUpdate?.created_at} / ${persistedUpdate?.updated_at}`);

    const listed = await fetch(`${BASE}/api/manual-rate-overrides`, {
      headers: { Cookie: authB.cookie },
    });
    if (!listed.ok) throw new Error(`override list failed: ${listed.status} ${await listed.text()}`);
    const rows = await listed.json() as Array<Record<string, unknown>>;
    const listedOverride = rows.find((row) =>
      row.location_name === locationName &&
      row.service_line === serviceLine &&
      row.room_type === roomType,
    );
    assert("GET returns original and latest actor names",
      listedOverride?.created_by_name === USER_A && listedOverride?.updated_by_name === USER_B,
      `got ${listedOverride?.created_by_name} / ${listedOverride?.updated_by_name}`);

    const grouped = await fetch(`${BASE}/api/reference-data`, {
      headers: { Cookie: authB.cookie },
    });
    if (!grouped.ok) throw new Error(`grouped Reference Data failed: ${grouped.status} ${await grouped.text()}`);
    const groupedData = await grouped.json() as { rows?: Array<Record<string, unknown>> };
    const groupedOverride = groupedData.rows?.find((row) =>
      row.campus === locationName &&
      row.serviceLine === serviceLine &&
      row.manualOverrideNote === "updated by second user",
    );
    assert("grouped Reference Data returns the original creator",
      groupedOverride?.manualOverrideCreatedByName === USER_A,
      `got ${groupedOverride?.manualOverrideCreatedByName}`);
    assert("grouped Reference Data returns the latest updater",
      groupedOverride?.manualOverrideUpdatedByName === USER_B,
      `got ${groupedOverride?.manualOverrideUpdatedByName}`);
    assert("grouped Reference Data returns both audit timestamps",
      Boolean(groupedOverride?.manualOverrideCreatedAt && groupedOverride?.manualOverrideUpdatedAt));

    await pool.query(
      `INSERT INTO manual_rate_overrides
         (client_id, location_name, service_line, room_type, override_rate, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [CLIENT, legacyLocationName, serviceLine, roomType, 4899, "legacy row", legacyActor],
    );
    const legacyResponse = await fetch(`${BASE}/api/manual-rate-override`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({
        locationName: legacyLocationName,
        serviceLine,
        roomType,
        overrideRate: 4999,
        notes: "updated without a session",
      }),
    });
    assert("unauthenticated override update is rejected", legacyResponse.status === 401,
      `got ${legacyResponse.status}`);
    const csrfRejected = await fetch(`${BASE}/api/manual-rate-override`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authB.cookie },
      body: JSON.stringify({
        locationName: legacyLocationName,
        serviceLine,
        roomType,
        overrideRate: 4999,
        notes: "missing csrf",
      }),
    });
    assert("state-changing cookie requests require CSRF validation", csrfRejected.status === 403,
      `got ${csrfRejected.status}`);

    const importResponse = await fetch(`${BASE}/api/reference-data/import-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authA.cookie, Origin: BASE, "x-csrf-token": authA.csrfToken },
      body: JSON.stringify({
        rows: [{
          campus: importLocationName,
          serviceLine,
          roomType,
          importRate: 6199,
        }],
      }),
    });
    if (!importResponse.ok) {
      throw new Error(`override import failed: ${importResponse.status} ${await importResponse.text()}`);
    }
    const importResult = await importResponse.json() as { overridesApplied?: number };
    assert("import applies an exact-rate override", importResult.overridesApplied === 1,
      `got ${importResult.overridesApplied}`);
    const importedOverride = (await pool.query(
      `SELECT override_rate, created_by, updated_by, created_at, updated_at
         FROM manual_rate_overrides
        WHERE client_id = $1 AND location_name = $2 AND service_line = $3 AND room_type = $4`,
      [CLIENT, importLocationName, serviceLine, roomType],
    )).rows[0];
    assert("import records its authenticated creator and updater",
      Number(importedOverride?.override_rate) === 6199 &&
        importedOverride?.created_by === userIds.get(USER_A) &&
        importedOverride?.updated_by === userIds.get(USER_A),
      JSON.stringify(importedOverride));
    assert("import-created override has audit timestamps",
      importedOverride?.created_at != null &&
        importedOverride?.updated_at != null &&
        importedOverride?.updated_at >= importedOverride?.created_at,
      JSON.stringify(importedOverride));
    const importedEvent = (await pool.query(
      `SELECT event_type, changed_by, new_rate
         FROM manual_rate_override_history
        WHERE client_id = $1 AND location_name = $2 AND service_line = $3 AND room_type = $4
        ORDER BY changed_at DESC, id DESC LIMIT 1`,
      [CLIENT, importLocationName, serviceLine, roomType],
    )).rows[0];
    assert("import appends an attributed create event",
      importedEvent?.event_type === "create" &&
        importedEvent?.changed_by === USER_A &&
        Number(importedEvent?.new_rate) === 6199,
      JSON.stringify(importedEvent));

    const removed = await fetch(
      `${BASE}/api/manual-rate-override/${encodeURIComponent(locationName)}/${encodeURIComponent(serviceLine)}/${encodeURIComponent(roomType)}`,
      { method: "DELETE", headers: { Cookie: authB.cookie, Origin: BASE, "x-csrf-token": authB.csrfToken } },
    );
    if (!removed.ok) throw new Error(`override delete failed: ${removed.status} ${await removed.text()}`);

    const history = await fetch(`${BASE}/api/manual-rate-override-history`, {
      headers: { Cookie: authB.cookie },
    });
    if (!history.ok) throw new Error(`all-history list failed: ${history.status} ${await history.text()}`);
    const historyRows = await history.json() as Array<Record<string, unknown>>;
    const removedEntry = historyRows.find((row) =>
      row.location_name === locationName &&
      row.service_line === serviceLine &&
      row.room_type === roomType &&
      row.event_type === "remove",
    );
    assert("all-history list retains removed overrides",
      Boolean(removedEntry),
      `could not find remove event for ${locationName} / ${serviceLine} / ${roomType}`);

    let updateRejected = false;
    let deleteRejected = false;
    if (removedEntry?.id) {
      try {
        await pool.query(
          `UPDATE manual_rate_override_history SET notes = 'tampered' WHERE id = $1`,
          [removedEntry.id],
        );
      } catch {
        updateRejected = true;
      }
      try {
        await pool.query(
          `DELETE FROM manual_rate_override_history WHERE id = $1`,
          [removedEntry.id],
        );
      } catch {
        deleteRejected = true;
      }
    }
    assert("direct history updates are rejected", updateRejected);
    assert("direct history deletes are rejected", deleteRejected);

    const legacySessionId = sessionIdFromCookie(authA.cookie);
    const legacyRow = (await pool.query(
      `SELECT sess FROM sessions WHERE sid = $1`,
      [legacySessionId],
    )).rows[0];
    const legacySession = typeof legacyRow?.sess === "string"
      ? JSON.parse(legacyRow.sess)
      : { ...(legacyRow?.sess || {}) };
    delete legacySession.authenticatedAt;
    await pool.query(
      `UPDATE sessions SET sess = $1 WHERE sid = $2`,
      [JSON.stringify(legacySession), legacySessionId],
    );
    const legacyAuthUser = await fetch(`${BASE}/api/auth/user`, {
      headers: { Cookie: authA.cookie },
    });
    assert(
      "legacy pre-MFA sessions cannot remain authenticated on a GET",
      legacyAuthUser.status === 200 &&
        (await legacyAuthUser.json() as { isAuthenticated?: boolean }).isAuthenticated === false,
    );
    const legacyReference = await fetch(`${BASE}/api/reference-data`, {
      headers: { Cookie: authA.cookie },
    });
    assert("legacy session reads fall back to the demo tenant", legacyReference.status === 200);
    const legacyAuthUserAgain = await fetch(`${BASE}/api/auth/user`, {
      headers: { Cookie: authA.cookie },
    });
    assert(
      "legacy session remains invalidated on the next request",
      legacyAuthUserAgain.status === 200 &&
        (await legacyAuthUserAgain.json() as { isAuthenticated?: boolean }).isAuthenticated === false,
    );

    const revokedSessionId = sessionIdFromCookie(authB.cookie);
    await pool.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE session_id = $1`,
      [revokedSessionId],
    );
    const revokedAuthUser = await fetch(`${BASE}/api/auth/user`, {
      headers: { Cookie: authB.cookie },
    });
    assert(
      "revoked sessions cannot read as authenticated",
      revokedAuthUser.status === 200 &&
        (await revokedAuthUser.json() as { isAuthenticated?: boolean }).isAuthenticated === false,
    );
    const revokedReference = await fetch(`${BASE}/api/reference-data`, {
      headers: { Cookie: authB.cookie },
    });
    assert("revoked session reads fall back to the demo tenant", revokedReference.status === 200);
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
