/**
 * Live-route regression coverage for self-service MFA password reset.
 * Requires the dev server on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/mfaPasswordReset.test.ts
 */
import crypto from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import { createTotpSecret, encryptSecret, totpCode } from "../server/security";

const { Pool } = pg;
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const SUFFIX = `${Date.now()}-${process.pid}`;
const USERNAME = `ptest_mfa_reset_${SUFFIX}`;
const OLD_PASSWORD = "OldPassword12345";
const FIRST_PASSWORD = "FirstPassword23456";
const CONCURRENT_A = "ConcurrentPassword34567";
const CONCURRENT_B = "ConcurrentPassword45678";
const USER_AGENT = `mfa-password-reset-test/${SUFFIX}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const startedAt = new Date();
let userId = "";
let passed = 0;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  passed++;
}

function accountKeyHash(): string {
  return crypto.createHash("sha256")
    .update(`mfa-reset-account\0${USERNAME.toLowerCase()}`)
    .digest("hex");
}

async function reset(username: string, code: string, password: string, origin = BASE): Promise<Response> {
  return fetch(`${BASE}/api/auth/password-reset/mfa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ username, code, password }),
  });
}

async function cleanup(): Promise<void> {
  if (userId) {
    await pool.query(`DELETE FROM security_audit_events WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
  await pool.query(
    `DELETE FROM security_audit_events
      WHERE event_type = 'password_reset_mfa'
        AND user_agent = $1`,
    [USER_AGENT],
  );
  await pool.query(
    `DELETE FROM auth_rate_limits
      WHERE (scope = 'mfa-reset-account' AND key_hash = $1)
         OR (scope = 'mfa-reset-ip' AND updated_at >= $2)`,
    [accountKeyHash(), startedAt],
  );
}

async function main(): Promise<void> {
  await cleanup();
  const secret = createTotpSecret();
  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO users
        (username, password_hash, client_id, role, account_status,
         mfa_enabled, mfa_secret_encrypted)
       VALUES ($1, $2, 'demo', 'admin', 'active', true, $3)
       RETURNING id`,
      [USERNAME, await bcrypt.hash(OLD_PASSWORD, 4), encryptSecret(secret)],
    );
    userId = inserted.rows[0].id;
    await pool.query(
      `INSERT INTO auth_sessions (user_id, session_id, client_id)
       VALUES ($1, $2, 'demo')`,
      [userId, `ptest-session-${SUFFIX}`],
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [userId, crypto.createHash("sha256").update(`token-${SUFFIX}`).digest("hex")],
    );

    const priorStepCode = totpCode(secret, Date.now() - 30_000).code;
    const first = await reset(USERNAME, priorStepCode, FIRST_PASSWORD);
    const firstBody = await first.json() as { message?: string };
    check(first.ok && firstBody.message === "If the account and verification code are valid, the password has been reset.",
      "valid MFA reset did not return the generic success response");

    const persisted = await pool.query<{
      password_hash: string;
      mfa_last_used_step: number;
      revoked_at: Date | null;
      consumed_at: Date | null;
    }>(
      `SELECT u.password_hash, u.mfa_last_used_step,
              a.revoked_at, p.consumed_at
         FROM users u
         LEFT JOIN auth_sessions a ON a.user_id = u.id
         LEFT JOIN password_reset_tokens p ON p.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    check(await bcrypt.compare(FIRST_PASSWORD, persisted.rows[0].password_hash),
      "new password was not persisted");
    check(Boolean(persisted.rows[0].revoked_at) && Boolean(persisted.rows[0].consumed_at),
      "existing sessions or password-reset tokens were not revoked");

    const successAudit = await pool.query(
      `SELECT client_id, user_id FROM security_audit_events
        WHERE event_type = 'password_reset_mfa' AND success = true AND user_id = $1`,
      [userId],
    );
    check(successAudit.rows.length === 1 && successAudit.rows[0].client_id === "demo",
      "successful reset audit was not attributed to the target account");

    const replay = await reset(USERNAME, priorStepCode, CONCURRENT_A);
    check(replay.ok && (await replay.json()).message === firstBody.message,
      "replayed TOTP did not receive the generic response");
    const afterReplay = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    );
    check(await bcrypt.compare(FIRST_PASSWORD, afterReplay.rows[0].password_hash),
      "replayed TOTP changed the password");

    const currentCode = totpCode(secret).code;
    const concurrent = await Promise.all([
      reset(USERNAME, currentCode, CONCURRENT_A),
      reset(USERNAME, currentCode, CONCURRENT_B),
    ]);
    check(concurrent.every((response) => response.ok),
      "concurrent requests did not preserve enumeration-safe responses");
    const finalUser = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    );
    const winners = Number(await bcrypt.compare(CONCURRENT_A, finalUser.rows[0].password_hash))
      + Number(await bcrypt.compare(CONCURRENT_B, finalUser.rows[0].password_hash));
    check(winners === 1, "the same TOTP step changed the password more than once");

    const wrong = await reset(USERNAME, "000000", FIRST_PASSWORD);
    const unknown = await reset(`${USERNAME}_missing`, "000000", FIRST_PASSWORD);
    check(
      wrong.status === unknown.status &&
      (await wrong.json()).message === (await unknown.json()).message,
      "wrong-code and unknown-account responses differ",
    );
    const rateLimit = await pool.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM auth_rate_limits
        WHERE scope = 'mfa-reset-account' AND key_hash = $1`,
      [accountKeyHash()],
    );
    check(Number(rateLimit.rows[0]?.attempt_count || 0) > 0,
      "account reset attempts were not recorded in the shared limiter");

    const foreign = await reset(USERNAME, "000000", FIRST_PASSWORD, "https://attacker.invalid");
    check(foreign.status === 403, "foreign-origin reset was not rejected");
  } finally {
    await cleanup();
    await pool.end();
  }
  console.log(`${passed} passed`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});