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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`${PASS} ${desc}`);
    passed++;
  } else {
    console.log(`${FAIL} ${desc}${detail ? `\n    ${detail}` : ""}`);
    failed++;
  }
}

async function login(username: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed for ${username}: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error(`no session cookie returned for ${username}`);
  return cookie.split(";")[0];
}

async function postOverride(cookie: string, rate: number, notes: string) {
  const response = await fetch(`${BASE}/api/manual-rate-override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      locationName,
      serviceLine,
      roomType,
      overrideRate: rate,
      notes,
    }),
  });
  if (!response.ok) throw new Error(`override save failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function cleanup() {
  await pool.query(
    `DELETE FROM manual_rate_overrides
     WHERE client_id = $1 AND location_name = $2 AND service_line = $3 AND room_type = $4`,
    [CLIENT, locationName, serviceLine, roomType],
  );
  await pool.query(
    `DELETE FROM manual_rate_override_history
      WHERE client_id = $1 AND location_name = $2 AND service_line = $3 AND room_type = $4`,
    [CLIENT, locationName, serviceLine, roomType],
  );
  await pool.query(`DELETE FROM users WHERE username = ANY($1)`, [[USER_A, USER_B]]);
}

async function main() {
  await cleanup();
  try {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const userRows = await pool.query<{ id: string; username: string }>(
      `INSERT INTO users (username, password_hash, client_id)
       VALUES ($1, $2, $3), ($4, $2, $3)
       RETURNING id, username`,
      [USER_A, hash, CLIENT, USER_B],
    );
    const userIds = new Map(userRows.rows.map((row) => [row.username, row.id]));

    const cookieA = await login(USER_A);
    const referenceResponse = await fetch(`${BASE}/api/reference-data`, {
      headers: { Cookie: cookieA },
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

    const first = await postOverride(cookieA, 4999, "set by first user");
    assert("create records the original creator", first.created_by === userIds.get(USER_A),
      `expected ${userIds.get(USER_A)}, got ${first.created_by}`);
    assert("create records the initial updater", first.updated_by === userIds.get(USER_A),
      `expected ${userIds.get(USER_A)}, got ${first.updated_by}`);
    assert("create returns audit timestamps", Boolean(first.created_at && first.updated_at));

    const createdAt = String(first.created_at);
    const cookieB = await login(USER_B);
    const second = await postOverride(cookieB, 5099, "updated by second user");
    assert("update preserves the original creator", second.created_by === userIds.get(USER_A),
      `expected ${userIds.get(USER_A)}, got ${second.created_by}`);
    assert("update records the latest updater", second.updated_by === userIds.get(USER_B),
      `expected ${userIds.get(USER_B)}, got ${second.updated_by}`);
    assert("update preserves the original timestamp", String(second.created_at) === createdAt,
      `expected ${createdAt}, got ${second.created_at}`);
    assert("update response includes both actor names",
      second.created_by_name === USER_A && second.updated_by_name === USER_B,
      `got ${second.created_by_name} / ${second.updated_by_name}`);

    const listed = await fetch(`${BASE}/api/manual-rate-overrides`, {
      headers: { Cookie: cookieB },
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
      headers: { Cookie: cookieB },
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

    const removed = await fetch(
      `${BASE}/api/manual-rate-override/${encodeURIComponent(locationName)}/${encodeURIComponent(serviceLine)}/${encodeURIComponent(roomType)}`,
      { method: "DELETE", headers: { Cookie: cookieB } },
    );
    if (!removed.ok) throw new Error(`override delete failed: ${removed.status} ${await removed.text()}`);

    const history = await fetch(`${BASE}/api/manual-rate-override-history`, {
      headers: { Cookie: cookieB },
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
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await pool.end();
  process.exitCode = 1;
});