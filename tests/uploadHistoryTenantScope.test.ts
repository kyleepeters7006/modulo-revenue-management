/**
 * Upload-history tenant isolation regression test.
 *
 * Requires the dev server on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/uploadHistoryTenantScope.test.ts
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const PASSWORD = "upload-history-test-password";
const SUFFIX = `${Date.now()}-${process.pid}`;
const CLIENT_A = `upload_history_a_${SUFFIX}`;
const CLIENT_B = `upload_history_b_${SUFFIX}`;
const USER_A = `upload_history_user_a_${SUFFIX}`;
const USER_B = `upload_history_user_b_${SUFFIX}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("login did not return a session cookie");
  return value.split(";")[0];
}

async function login(username: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  return cookieFrom(response);
}

async function setup() {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO clients (id, name)
     VALUES ($1, $2), ($3, $4)`,
    [CLIENT_A, "Upload History Test A", CLIENT_B, "Upload History Test B"],
  );
  await pool.query(
    `INSERT INTO users (id, username, password_hash, client_id, first_name, last_name)
     VALUES (gen_random_uuid(), $1, $2, $3, 'Upload', 'Test A'),
            (gen_random_uuid(), $4, $2, $5, 'Upload', 'Test B')`,
    [USER_A, passwordHash, CLIENT_A, USER_B, CLIENT_B],
  );

  await pool.query(
    `INSERT INTO rent_roll_data
       (id, upload_month, date, location, room_number, room_type, service_line,
        occupied_yn, size, street_rate, in_house_rate, client_id)
     VALUES
       (gen_random_uuid(), '2026-01', '2026-01-31', 'Upload Test A',
        'A-1', 'Studio', 'AL', false, 'Studio', 100, 100, $1),
       (gen_random_uuid(), '2026-02', '2026-02-28', 'Upload Test B',
        'B-1', 'Studio', 'AL', false, 'Studio', 100, 100, $2)`,
    [CLIENT_A, CLIENT_B],
  );

  await pool.query(
    `INSERT INTO upload_history
       (id, upload_month, file_name, upload_type, total_records, processed_at, client_id)
     VALUES
       (gen_random_uuid(), '2026-01', 'tenant-a-rent-roll.csv', 'rent_roll', 1, '2026-01-31T10:00:00Z', $1),
       (gen_random_uuid(), '2026-03', 'tenant-a-inquiry.csv', 'inquiry_metrics', 3, '2026-03-31T10:00:00Z', $1),
       (gen_random_uuid(), '2026-02', 'tenant-b-rent-roll.csv', 'rent_roll', 1, '2026-02-28T10:00:00Z', $2),
       (gen_random_uuid(), '2026-04', 'tenant-b-inquiry.csv', 'inquiry_metrics', 4, '2026-04-30T10:00:00Z', $2),
       (gen_random_uuid(), '2026-12', 'ambiguous-legacy.csv', 'inquiry_metrics', 9, '2026-12-31T10:00:00Z', NULL)`,
    [CLIENT_A, CLIENT_B],
  );
}

async function cleanup() {
  await pool.query(`DELETE FROM upload_history WHERE client_id IN ($1, $2) OR file_name = 'ambiguous-legacy.csv'`, [CLIENT_A, CLIENT_B]);
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id IN ($1, $2)`, [CLIENT_A, CLIENT_B]);
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2)`, [USER_A, USER_B]);
  await pool.query(`DELETE FROM clients WHERE id IN ($1, $2)`, [CLIENT_A, CLIENT_B]);
}

async function main() {
  await setup();
  try {
    const summaryResponse = await fetch(`${BASE}/api/upload-summary`, {
      headers: { Cookie: await login(USER_A) },
    });
    const summary = await summaryResponse.json() as {
      rent_roll: { periods: string[]; lastFileName: string | null; lastUploadAt: string | null };
      inquiry_metrics: { periods: string[]; lastFileName: string | null; lastUploadAt: string | null };
    };
    const serialized = JSON.stringify(summary);

    assert("authenticated tenant can read its rent-roll period", summary.rent_roll.periods.includes("2026-01"));
    assert("authenticated tenant cannot read another tenant's rent-roll period", !summary.rent_roll.periods.includes("2026-02"));
    assert("authenticated tenant can read its inquiry period", summary.inquiry_metrics.periods.includes("2026-03"));
    assert("authenticated tenant cannot read another tenant's inquiry period", !summary.inquiry_metrics.periods.includes("2026-04"));
    assert("rent-roll filename belongs to the authenticated tenant", summary.rent_roll.lastFileName === "tenant-a-rent-roll.csv");
    assert("inquiry filename belongs to the authenticated tenant", summary.inquiry_metrics.lastFileName === "tenant-a-inquiry.csv");
    assert("rent-roll timestamp belongs to the authenticated tenant", summary.rent_roll.lastUploadAt?.startsWith("2026-01-31") === true);
    assert("inquiry timestamp belongs to the authenticated tenant", summary.inquiry_metrics.lastUploadAt?.startsWith("2026-03-31") === true);
    assert("another tenant's filename and timestamp are not present", !serialized.includes("tenant-b-") && !serialized.includes("2026-04-30"));
    assert("ambiguous legacy history is not attributed to a tenant", !serialized.includes("ambiguous-legacy.csv") && !serialized.includes("2026-12-31"));
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});