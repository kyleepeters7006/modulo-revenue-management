/**
 * Endpoint-level regression coverage for the shared latest-month rent-roll
 * snapshot used by campus metrics and vacancy scatter.
 *
 * The test mounts the production route graph on an ephemeral HTTP server. A
 * test-only request middleware supplies the tenant id because the production
 * tenant middleware normally gets it from an authenticated browser session.
 *
 * Run with:
 *   npx tsx tests/analyticsLatestRentRollCache.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type http from "node:http";
import { pool } from "../server/db";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { analyticsCache } from "../server/commentaryCache";
import { invalidateLatestRentRollCache } from "../server/latestRentRollCache";

const MONTH = "2026-09";
const CLIENT_A = `analytics-cache-a-${Date.now()}`;
const CLIENT_B = `analytics-cache-b-${Date.now()}`;
const LOCATION_A = "Analytics Cache Tenant A";
const LOCATION_B = "Analytics Cache Tenant B";

type AnalyticsResponse = {
  status: number;
  body: any;
};

function assertResponseShape(
  response: AnalyticsResponse,
  expectedTopLevel: string[],
): void {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  for (const key of expectedTopLevel) {
    assert.ok(Object.prototype.hasOwnProperty.call(response.body, key), `missing ${key}`);
  }
}

async function request(
  base: string,
  path: string,
  clientId: string,
): Promise<AnalyticsResponse> {
  const response = await fetch(`${base}${path}`, {
    headers: { "x-test-client-id": clientId },
  });
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function seedClient(clientId: string, location: string, rate: number): Promise<void> {
  await pool.query(
    `INSERT INTO clients (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [clientId, clientId],
  );
  await pool.query(
    `INSERT INTO rent_roll_data
       (upload_month, date, location, room_number, room_type, service_line,
        occupied_yn, size, street_rate, in_house_rate, days_vacant, client_id)
     VALUES
       ($1, $2, $3, 'A-101', 'Studio', 'AL', TRUE, 'Studio', $4, $4, 0, $5),
       ($1, $2, $3, 'A-102', 'Studio', 'AL', FALSE, 'Studio', $4, $4, 12, $5)`,
    [MONTH, `${MONTH}-01`, location, rate, clientId],
  );
}

async function replaceClientRows(
  clientId: string,
  location: string,
  rate: number,
  daysVacant: number,
): Promise<void> {
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id = $1`, [clientId]);
  await pool.query(
    `INSERT INTO rent_roll_data
       (upload_month, date, location, room_number, room_type, service_line,
        occupied_yn, size, street_rate, in_house_rate, days_vacant, client_id)
     VALUES
       ($1, $2, $3, 'B-201', 'Studio', 'AL', TRUE, 'Studio', $4, $4, 0, $5),
       ($1, $2, $3, 'B-202', 'Studio', 'AL', FALSE, 'Studio', $4, $4, $6, $5)`,
    [MONTH, `${MONTH}-01`, location, rate, clientId, daysVacant],
  );
}

async function cleanup(): Promise<void> {
  invalidateLatestRentRollCache();
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id IN ($1, $2)`, [CLIENT_A, CLIENT_B]);
  await pool.query(`DELETE FROM locations WHERE client_id IN ($1, $2)`, [CLIENT_A, CLIENT_B]);
  await pool.query(`DELETE FROM clients WHERE id IN ($1, $2)`, [CLIENT_A, CLIENT_B]);
}

async function main(): Promise<void> {
  let httpServer: http.Server | undefined;
  const originalMonthLoader = storage.getRentRollDataByMonth.bind(storage);
  let monthLoadCountA = 0;

  await cleanup();
  await seedClient(CLIENT_A, LOCATION_A, 4100);
  await seedClient(CLIENT_B, LOCATION_B, 7200);

  // Keep tenant selection test-only. The production route graph still handles
  // the request, including its tenant-qualified storage and analytics caches.
  const app = express();
  app.use((req: any, _res, next) => {
    if (!req.path.startsWith("/api/analytics/")) return next();
    const requestedClientId = String(req.headers["x-test-client-id"] || "demo");
    let assignedClientId = "";
    Object.defineProperty(req, "clientId", {
      configurable: true,
      get: () => assignedClientId || requestedClientId,
      set: (value: string) => {
        // The production middleware writes the anonymous fallback "demo".
        // Preserve the test tenant while still accepting a real assignment.
        if (value && value !== "demo") assignedClientId = value;
      },
    });
    next();
  });

  storage.getRentRollDataByMonth = async (month, clientId) => {
    if (clientId === CLIENT_A) {
      monthLoadCountA++;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return originalMonthLoader(month, clientId);
  };

  try {
    let routesReady!: Promise<void>;
    httpServer = await registerRoutes(app, {
      databaseReady: Promise.resolve(),
      fullReady: Promise.resolve(),
      onReady: ready => {
        routesReady = ready;
      },
    });
    await routesReady;
    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(0, "127.0.0.1", () => resolve());
      httpServer!.once("error", reject);
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const base = `http://127.0.0.1:${address.port}`;

    invalidateLatestRentRollCache();
    analyticsCache.clear();
    monthLoadCountA = 0;

    const [campusACold, vacancyACold] = await Promise.all([
      request(base, "/api/analytics/campus-metrics", CLIENT_A),
      request(base, "/api/analytics/vacancy-scatter", CLIENT_A),
    ]);
    assertResponseShape(campusACold, ["campuses", "summary"]);
    assertResponseShape(vacancyACold, ["units", "summary"]);
    assert.equal(monthLoadCountA, 1, "concurrent cold analytics requests share one source load");
    assert.deepEqual(
      campusACold.body.campuses.map((campus: any) => campus.campusName),
      [LOCATION_A],
    );
    assert.deepEqual(
      vacancyACold.body.units.map((unit: any) => unit.location),
      [LOCATION_A],
    );

    const [campusB, vacancyB] = await Promise.all([
      request(base, "/api/analytics/campus-metrics", CLIENT_B),
      request(base, "/api/analytics/vacancy-scatter", CLIENT_B),
    ]);
    assertResponseShape(campusB, ["campuses", "summary"]);
    assertResponseShape(vacancyB, ["units", "summary"]);
    assert.deepEqual(
      campusB.body.campuses.map((campus: any) => campus.campusName),
      [LOCATION_B],
    );
    assert.deepEqual(
      vacancyB.body.units.map((unit: any) => unit.location),
      [LOCATION_B],
    );
    assert.notDeepEqual(campusB.body, campusACold.body, "tenant B does not receive tenant A's cached campus response");
    assert.notDeepEqual(vacancyB.body, vacancyACold.body, "tenant B does not receive tenant A's cached vacancy response");

    await replaceClientRows(CLIENT_A, "Analytics Cache Tenant A Replacement", 5300, 27);
    storage.invalidateLatestRentRollCache(CLIENT_A);

    const [campusAFresh, vacancyAFresh] = await Promise.all([
      request(base, "/api/analytics/campus-metrics", CLIENT_A),
      request(base, "/api/analytics/vacancy-scatter", CLIENT_A),
    ]);
    assertResponseShape(campusAFresh, ["campuses", "summary"]);
    assertResponseShape(vacancyAFresh, ["units", "summary"]);
    assert.equal(monthLoadCountA, 2, "tenant-scoped invalidation forces a replacement source load");
    assert.deepEqual(
      campusAFresh.body.campuses.map((campus: any) => campus.campusName),
      ["Analytics Cache Tenant A Replacement"],
    );
    assert.equal(campusAFresh.body.campuses[0].avgRate, 5300);
    assert.deepEqual(
      vacancyAFresh.body.units.map((unit: any) => unit.location),
      ["Analytics Cache Tenant A Replacement"],
    );
    assert.equal(vacancyAFresh.body.units[0].daysVacant, 27);
    assert.equal(typeof campusAFresh.body.summary, "object");
    assert.equal(typeof vacancyAFresh.body.summary, "object");

    console.log("analytics latest rent-roll cache endpoint isolation: passed");
  } finally {
    storage.getRentRollDataByMonth = originalMonthLoader;
    invalidateLatestRentRollCache();
    await cleanup();
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close(error => error ? reject(error) : resolve());
      });
    }
  }
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});