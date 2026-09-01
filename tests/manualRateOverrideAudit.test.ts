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

const importLocationName = `Import Audit ${SUFFIX}`;
const legacyActor = `legacy-importer-${SUFFIX}`;
const legacyLocationName = `Legacy Audit ${SUFFIX}`;
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

async function postOverride(cookie: string | null, rate: number, notes: string, segment = {
  locationName,
  serviceLine,
  roomType,
}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
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
    assert("create starts with matching created and updated timestamps",
      String(first.created_at) === String(first.updated_at),
      `got ${first.created_at} / ${first.updated_at}`);

    const createdAt = String(first.created_at);
    const initialUpdatedAt = String(first.updated_at);
    const cookieB = await login(USER_B);
    const second = await postOverride(cookieB, 5099, "updated by second user");
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

    await pool.query(
      `INSERT INTO manual_rate_overrides
         (client_id, location_name, service_line, room_type, override_rate, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [CLIENT, legacyLocationName, serviceLine, roomType, 4899, "legacy row", legacyActor],
    );
    const legacy = await postOverride(null, 4999, "updated without a session", {
      locationName: legacyLocationName,
      serviceLine,
      roomType,
    });
    assert("unauthenticated update preserves a legacy creator", legacy.created_by === legacyActor,
      `expected ${legacyActor}, got ${legacy.created_by}`);
    assert("unauthenticated update preserves a legacy updater", legacy.updated_by === legacyActor,
      `expected ${legacyActor}, got ${legacy.updated_by}`);
    assert("legacy creator uses a safe display fallback", legacy.created_by_name === legacyActor,
      `got ${legacy.created_by_name}`);
    assert("legacy updater uses a safe display fallback", legacy.updated_by_name === legacyActor,
      `got ${legacy.updated_by_name}`);

    const importResponse = await fetch(`${BASE}/api/reference-data/import-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
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
