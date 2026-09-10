/**
 * Authentication continuity regression test.
 *
 * Verifies that MFA is required at login but is never requested again after
 * login, including after the former 15-minute recent-MFA window. CSRF and
 * administrator role checks must still reject unauthorized requests.
 *
 * Requires the dev server on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/authenticationContinuity.test.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import {
  createTotpSecret,
  encryptSecret,
  totpCode,
} from "../server/security";

const { Pool } = pg;
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const CLIENT = "demo";
const SUFFIX = `${Date.now()}-${process.pid}`;
const ADMIN_USERNAME = `ptest_auth_continuity_admin_${SUFFIX}`;
const OPERATOR_USERNAME = `ptest_auth_continuity_operator_${SUFFIX}`;
const PASSWORD = "ptest-password-1";
const LOCATION_NAME = `Authentication Continuity ${SUFFIX}`;
const SERVICE_LINE = "AL";
const ROOM_TYPE = "Studio";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;
const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

type AuthContext = {
  cookie: string;
  csrfToken: string;
  userId: string;
};

function assertCheck(description: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

function cookieFromResponse(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("response did not return a session cookie");
  return setCookie.split(";")[0];
}

function sessionIdFromCookie(cookie: string): string {
  const value = decodeURIComponent(cookie.split("=")[1] || "");
  if (!value.startsWith("s:")) throw new Error("session cookie was not signed");
  const signatureStart = value.lastIndexOf(".");
  if (signatureStart <= 2) throw new Error("session cookie did not contain a session id");
  return value.slice(2, signatureStart);
}

async function loginWithMfa(
  username: string,
  secret: string,
  code = totpCode(secret).code,
): Promise<{ response: Response; cookie: string }> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const cookie = cookieFromResponse(response);
  if (!response.ok) {
    throw new Error(`password login failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json() as { mfaRequired?: boolean };
  if (!body.mfaRequired) throw new Error("password login did not require MFA");

  const mfaResponse = await fetch(`${BASE}/api/auth/mfa/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
    body: JSON.stringify({ code }),
  });
  return {
    response: mfaResponse,
    cookie: mfaResponse.headers.get("set-cookie")?.split(";")[0] || cookie,
  };
}

async function authenticatedContext(username: string, secret: string): Promise<AuthContext> {
  const login = await loginWithMfa(username, secret);
  if (!login.response.ok) {
    throw new Error(`MFA login failed: ${login.response.status} ${await login.response.text()}`);
  }
  const csrf = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { Cookie: login.cookie, Origin: BASE },
  });
  if (!csrf.ok) throw new Error(`CSRF token request failed: ${csrf.status}`);
  const user = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE username = $1 LIMIT 1`,
    [username],
  );
  if (!user.rows[0]) throw new Error(`could not find test user ${username}`);
  return {
    cookie: login.cookie,
    csrfToken: (await csrf.json() as { token: string }).token,
    userId: user.rows[0].id,
  };
}

async function expireRecentMfa(context: AuthContext): Promise<void> {
  const sessionId = sessionIdFromCookie(context.cookie);
  const result = await pool.query<{ sess: Record<string, unknown> | string }>(
    `SELECT sess FROM sessions WHERE sid = $1`,
    [sessionId],
  );
  if (!result.rows[0]) throw new Error("authenticated session was not persisted");
  const session = typeof result.rows[0].sess === "string"
    ? JSON.parse(result.rows[0].sess)
    : { ...result.rows[0].sess };
  session.mfaVerifiedAt = Date.now() - (16 * 60 * 1000);
  await pool.query(
    `UPDATE sessions SET sess = $1 WHERE sid = $2`,
    [JSON.stringify(session), sessionId],
  );
}

async function cleanup(): Promise<void> {
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    await dbClient.query("SET LOCAL app.manual_rate_override_audit_cleanup = 'test'");
    await dbClient.query(
      `DELETE FROM manual_rate_override_history
        WHERE client_id = $1 AND location_name = $2
          AND service_line = $3 AND room_type = $4`,
      [CLIENT, LOCATION_NAME, SERVICE_LINE, ROOM_TYPE],
    );
    await dbClient.query(
      `DELETE FROM manual_rate_overrides
        WHERE client_id = $1 AND location_name = $2
          AND service_line = $3 AND room_type = $4`,
      [CLIENT, LOCATION_NAME, SERVICE_LINE, ROOM_TYPE],
    );
    await dbClient.query("COMMIT");
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
  await pool.query(
    `DELETE FROM sessions
      WHERE sid IN (
        SELECT session_id FROM auth_sessions
         WHERE user_id IN (SELECT id FROM users WHERE username = ANY($1))
      )`,
    [[ADMIN_USERNAME, OPERATOR_USERNAME]],
  );
  await pool.query(
    `DELETE FROM security_audit_events
      WHERE user_id IN (SELECT id FROM users WHERE username = ANY($1))`,
    [[ADMIN_USERNAME, OPERATOR_USERNAME]],
  );
  await pool.query(`DELETE FROM users WHERE username = ANY($1)`, [
    [ADMIN_USERNAME, OPERATOR_USERNAME],
  ]);
}

async function main() {
  await cleanup();
  const adminSecret = createTotpSecret();
  const operatorSecret = createTotpSecret();
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const users = await pool.query<{ id: string; username: string }>(
      `INSERT INTO users
        (username, password_hash, client_id, role, mfa_enabled, mfa_secret_encrypted)
       VALUES
        ($1, $2, $3, 'admin', true, $4),
        ($5, $2, $3, 'operator', true, $6)
       RETURNING id, username`,
      [
        ADMIN_USERNAME,
        passwordHash,
        CLIENT,
        encryptSecret(adminSecret),
        OPERATOR_USERNAME,
        encryptSecret(operatorSecret),
      ],
    );
    assertCheck("test admin and operator accounts were created", users.rows.length === 2);

    const invalidPasswordLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: PASSWORD }),
    });
    const pendingCookie = cookieFromResponse(invalidPasswordLogin);
    const pendingBody = await invalidPasswordLogin.json() as { mfaRequired?: boolean };
    assertCheck("password verification does not complete login without MFA", pendingBody.mfaRequired === true);
    const invalidCode = await fetch(`${BASE}/api/auth/mfa/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: pendingCookie, Origin: BASE },
      body: JSON.stringify({ code: "111111" }),
    });
    assertCheck("invalid authenticator codes are rejected", invalidCode.status === 401,
      `got ${invalidCode.status}`);

    const admin = await authenticatedContext(ADMIN_USERNAME, adminSecret);
    const operator = await authenticatedContext(OPERATOR_USERNAME, operatorSecret);
    await expireRecentMfa(admin);
    await expireRecentMfa(operator);

    const csrfRejected = await fetch(`${BASE}/api/manual-rate-override`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin.cookie },
      body: JSON.stringify({
        locationName: LOCATION_NAME,
        serviceLine: SERVICE_LINE,
        roomType: ROOM_TYPE,
        overrideRate: 9999,
      }),
    });
    assertCheck("state-changing requests still require CSRF", csrfRejected.status === 403,
      `got ${csrfRejected.status}`);

    const stateChange = await fetch(`${BASE}/api/manual-rate-override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: admin.cookie,
        Origin: BASE,
        "x-csrf-token": admin.csrfToken,
      },
      body: JSON.stringify({
        locationName: LOCATION_NAME,
        serviceLine: SERVICE_LINE,
        roomType: ROOM_TYPE,
        overrideRate: 9999,
      }),
    });
    assertCheck(
      "an authenticated write succeeds after the former 15-minute MFA window",
      stateChange.ok && stateChange.status !== 428,
      `got ${stateChange.status} ${await stateChange.text()}`,
    );

    const exportResponse = await fetch(`${BASE}/api/export/rate-card`, {
      headers: { Cookie: admin.cookie },
    });
    assertCheck(
      "an authenticated export succeeds after the former 15-minute MFA window",
      exportResponse.ok && exportResponse.status !== 428,
      `got ${exportResponse.status}`,
    );

    const operatorAdminRequest = await fetch(`${BASE}/api/admin/geocoding-status`, {
      headers: { Cookie: operator.cookie },
    });
    assertCheck("operator requests remain blocked from admin routes", operatorAdminRequest.status === 403,
      `got ${operatorAdminRequest.status}`);

    const adminRequest = await fetch(`${BASE}/api/admin/geocoding-status`, {
      headers: { Cookie: admin.cookie },
    });
    assertCheck(
      "an authorized admin request succeeds after the former 15-minute MFA window",
      adminRequest.ok && adminRequest.status !== 428,
      `got ${adminRequest.status} ${await adminRequest.text()}`,
    );
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});