/**
 * Manual overrides apply immediately, while every create/update/remove is
 * appended to an immutable audit trail.
 *
 * Requires the dev server on port 5000 and DATABASE_URL.
 * Run with: npx tsx tests/manualOverrideAudit.test.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const CLIENT = "ptest-manual-override-audit";
const USERNAME = "ptest_manual_override_audit";
const PASSWORD = "ptest-password-1";
const LOCATION = "Audit Trail Campus";
const SERVICE_LINE = "AL";
const ROOM_TYPE = "Studio";

let passed = 0;
let failed = 0;
const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

function ok(description: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`${PASS} ${description}`);
  } else {
    failed++;
    console.log(`${FAIL} ${description}${detail ? `\n    ${detail}` : ""}`);
  }
}

async function cleanup() {
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    await dbClient.query("SET LOCAL app.manual_rate_override_audit_cleanup = 'test'");
    await dbClient.query(`DELETE FROM manual_rate_override_history WHERE client_id = $1`, [CLIENT]);
    await dbClient.query(`DELETE FROM manual_rate_overrides WHERE client_id = $1`, [CLIENT]);
    await dbClient.query("COMMIT");
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
  await pool.query(`DELETE FROM locations WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM clients WHERE id = $1`, [CLIENT]);
}

async function seed() {
  await cleanup();
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, 'Manual Override Audit Test')`,
    [CLIENT],
  );
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, client_id) VALUES ($1, $2, $3)`,
    [USERNAME, passwordHash, CLIENT],
  );
  const location = await pool.query(
    `INSERT INTO locations (client_id, name) VALUES ($1, $2) RETURNING id`,
    [CLIENT, LOCATION],
  );
  return location.rows[0].id as string;
}

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Login did not return a session cookie");
  return cookie.split(";")[0];
}

async function save(cookie: string, locationId: string, overrideRate: number, notes: string) {
  return fetch(`${BASE}/api/manual-rate-override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      locationId,
      locationName: LOCATION,
      serviceLine: SERVICE_LINE,
      roomType: ROOM_TYPE,
      overrideRate,
      notes,
    }),
  });
}

async function run() {
  const locationId = await seed();
  const cookie = await login();

  console.log("\n── create applies immediately and records its actor ──");
  const createResponse = await save(cookie, locationId, 4250, "Initial operator override");
  ok("create succeeds", createResponse.ok, `HTTP ${createResponse.status}: ${await createResponse.text()}`);
  const currentAfterCreate = (await pool.query(
    `SELECT override_rate, notes, created_by FROM manual_rate_overrides
      WHERE client_id = $1 AND location_name = $2 AND service_line = $3 AND room_type = $4`,
    [CLIENT, LOCATION, SERVICE_LINE, ROOM_TYPE],
  )).rows[0];
  const creator = (await pool.query(
    `SELECT id FROM users WHERE username = $1 LIMIT 1`,
    [USERNAME],
  )).rows[0];
  ok("the live override changes immediately", Number(currentAfterCreate?.override_rate) === 4250);
  ok("the live row retains its creator", currentAfterCreate?.created_by === creator?.id);
  const createdEvent = (await pool.query(
    `SELECT event_type, previous_rate, new_rate, notes, changed_by, changed_at
       FROM manual_rate_override_history WHERE client_id = $1 ORDER BY changed_at DESC LIMIT 1`,
    [CLIENT],
  )).rows[0];
  ok("create event has before/after, actor, note and timestamp",
    createdEvent?.event_type === "create" &&
      createdEvent?.previous_rate == null &&
      Number(createdEvent?.new_rate) === 4250 &&
      createdEvent?.notes === "Initial operator override" &&
      createdEvent?.changed_by === USERNAME &&
      createdEvent?.changed_at != null,
    JSON.stringify(createdEvent));

  console.log("\n── update preserves the previous rate ──");
  const updateResponse = await save(cookie, locationId, 4500, "Market review");
  ok("update succeeds", updateResponse.ok, `HTTP ${updateResponse.status}: ${await updateResponse.text()}`);
  const updatedEvent = (await pool.query(
    `SELECT event_type, previous_rate, new_rate, notes, changed_by
       FROM manual_rate_override_history WHERE client_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1`,
    [CLIENT],
  )).rows[0];
  ok("update event records the old and new rates",
    updatedEvent?.event_type === "update" &&
      Number(updatedEvent?.previous_rate) === 4250 &&
      Number(updatedEvent?.new_rate) === 4500 &&
      updatedEvent?.notes === "Market review" &&
      updatedEvent?.changed_by === USERNAME,
    JSON.stringify(updatedEvent));

  const historyResponse = await fetch(
    `${BASE}/api/manual-rate-override-history/${encodeURIComponent(LOCATION)}/${SERVICE_LINE}/${ROOM_TYPE}`,
    { headers: { Cookie: cookie } },
  );
  const history = historyResponse.ok ? await historyResponse.json() : [];
  ok("history endpoint returns the segment's events newest first",
    historyResponse.ok &&
      history.length === 2 &&
      history[0].event_type === "update" &&
      history[1].event_type === "create",
    `HTTP ${historyResponse.status}, body=${JSON.stringify(history)}`);

  console.log("\n── removal is audited before the live override disappears ──");
  const removeResponse = await fetch(
    `${BASE}/api/manual-rate-override/${encodeURIComponent(LOCATION)}/${SERVICE_LINE}/${ROOM_TYPE}`,
    { method: "DELETE", headers: { Cookie: cookie } },
  );
  ok("remove succeeds", removeResponse.ok, `HTTP ${removeResponse.status}: ${await removeResponse.text()}`);
  const currentCount = Number((await pool.query(
    `SELECT COUNT(*) AS count FROM manual_rate_overrides WHERE client_id = $1`,
    [CLIENT],
  )).rows[0].count);
  ok("the live override is removed immediately", currentCount === 0);
  const removedEvent = (await pool.query(
    `SELECT event_type, previous_rate, new_rate, notes, changed_by
       FROM manual_rate_override_history WHERE client_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1`,
    [CLIENT],
  )).rows[0];
  ok("remove event preserves the final rate and note",
    removedEvent?.event_type === "remove" &&
      Number(removedEvent?.previous_rate) === 4500 &&
      removedEvent?.new_rate == null &&
      removedEvent?.notes === "Market review" &&
      removedEvent?.changed_by === USERNAME,
    JSON.stringify(removedEvent));
}

run()
  .catch((error) => {
    failed++;
    console.error(error);
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await pool.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  });