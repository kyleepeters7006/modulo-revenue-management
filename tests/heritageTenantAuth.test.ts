/**
 * Heritage tenant authentication and isolation regression test.
 *
 * Requires the dev server on port 5000, DATABASE_URL, and HERITAGE_PASSWORD.
 * Run with: npx tsx tests/heritageTenantAuth.test.ts
 */

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
const PASSWORD = process.env.HERITAGE_PASSWORD;
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

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not return a session cookie");
  return setCookie.split(";")[0];
}

async function login(username: string, password: string) {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function main() {
  if (!PASSWORD) throw new Error("HERITAGE_PASSWORD must be configured for this test");

  const invalid = await login("heritage_admin", `${PASSWORD}-invalid`);
  assert("invalid Heritage credentials are rejected with 401", invalid.status === 401);

  const loginResponse = await login("heritage_admin", PASSWORD);
  const loginBody = await loginResponse.json() as Record<string, unknown>;
  assert("valid Heritage credentials are accepted", loginResponse.ok);
  assert("login identifies the Heritage tenant", loginBody.clientId === "heritage");
  assert("login returns the Heritage display name", loginBody.clientName === "Heritage Communities");

  const cookie = sessionCookie(loginResponse);
  const sessionResponse = await fetch(`${BASE}/api/auth/user`, {
    headers: { Cookie: cookie },
  });
  const sessionBody = await sessionResponse.json() as Record<string, unknown>;
  assert("session refresh remains authenticated", sessionBody.isAuthenticated === true);
  assert("session refresh preserves the Heritage tenant", sessionBody.clientId === "heritage");
  assert("session refresh preserves the Heritage display name", sessionBody.clientName === "Heritage Communities");

  const locationsResponse = await fetch(`${BASE}/api/locations`, {
    headers: { Cookie: cookie },
  });
  const locationsBody = await locationsResponse.json() as { locations?: unknown[] };
  assert(
    "Heritage location data is empty before its first import",
    Array.isArray(locationsBody.locations) && locationsBody.locations.length === 0,
  );

  const tamperedLocationsResponse = await fetch(`${BASE}/api/locations?clientId=demo`, {
    headers: { Cookie: cookie },
  });
  const tamperedLocationsBody = await tamperedLocationsResponse.json() as { locations?: unknown[] };
  assert(
    "a browser clientId cannot expose Demo locations to Heritage",
    Array.isArray(tamperedLocationsBody.locations) && tamperedLocationsBody.locations.length === 0,
  );

  const referenceResponse = await fetch(`${BASE}/api/reference-data?clientId=demo`, {
    headers: { Cookie: cookie },
  });
  const referenceBody = await referenceResponse.json() as { rows?: unknown[] };
  assert(
    "a browser clientId cannot expose Demo reference data to Heritage",
    Array.isArray(referenceBody.rows) && referenceBody.rows.length === 0,
  );

  const logoutResponse = await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert("logout succeeds", logoutResponse.ok);

  const afterLogoutResponse = await fetch(`${BASE}/api/auth/user`, {
    headers: { Cookie: cookie },
  });
  const afterLogoutBody = await afterLogoutResponse.json() as Record<string, unknown>;
  assert("logout invalidates the Heritage session", afterLogoutBody.isAuthenticated === false);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});