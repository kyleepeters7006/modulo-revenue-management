import assert from "node:assert/strict";
import {
  loadPersistedRecommendationSnapshots,
  recommendationSnapshotFromPlan,
  recommendationSnapshotKey,
  registerInhousePlanningRoutes,
} from "../server/routes/inhousePlanningRoutes";
import { pool } from "../server/db";

const recommendations = [{
  id: "rec-1",
  location: "Campus A",
  locationId: "campus-a",
  serviceLine: "AL",
  product: "Studio",
  currentStreetRate: 4200,
  suggestedRate: 4300,
  hardCeiling: 4500,
  topCompetitorRate: 4400,
  units: 2,
  suggestedIncreasePct: 2.38,
  growthContribution: 200,
  locked: false,
}] as any;

const persistedPlan = {
  location_id: "campus-a",
  created_at: "2026-09-09T10:00:00.000Z",
  summary: {
    streetRateRecommendationSnapshot: {
      createdAt: "2026-09-09T09:45:00.000Z",
      maximumPremiumAboveTopCompetitorPct: 3,
      assumptionsFingerprint: "{\"growthTargetPct\":4}",
      recommendations,
    },
  },
};

const restoredAfterRestart = recommendationSnapshotFromPlan(persistedPlan);
assert.ok(restoredAfterRestart, "a proposed plan should restore its persisted snapshot");
assert.equal(restoredAfterRestart.createdAt, "2026-09-09T09:45:00.000Z");
assert.equal(restoredAfterRestart.maximumPremiumAboveTopCompetitorPct, 3);
assert.equal(restoredAfterRestart.assumptionsFingerprint, "{\"growthTargetPct\":4}");
assert.deepEqual(restoredAfterRestart.recommendations, recommendations);

// The in-memory map is intentionally disposable. Scope identity must still
// keep the same tenant/user/campus/service-line isolated after reload.
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-b", "user-a", "campus-a", "AL"),
);
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-a", "user-b", "campus-a", "AL"),
);
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-a", "user-a", "campus-b", "AL"),
);
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "HC"),
);

const legacyPlan = {
  ...persistedPlan,
  summary: { streetRateRecommendations: recommendations },
};
const legacyRestored = recommendationSnapshotFromPlan(legacyPlan);
assert.ok(legacyRestored, "legacy recommendation rows remain displayable after restart");
assert.equal(legacyRestored.maximumPremiumAboveTopCompetitorPct, null);
assert.equal(legacyRestored.assumptionsFingerprint, null);

async function verifyDatabaseReloadAndEligibility() {
  const userResult = await pool.query<{ id: string; client_id: string }>(
    "SELECT id, client_id FROM users WHERE client_id IS NOT NULL LIMIT 1",
  );
  if (userResult.rows.length === 0) {
    console.log("In-house recommendation persistence tests: skipped (no tenant user)");
    await pool.end();
    return;
  }

  const { id: userId, client_id: clientId } = userResult.rows[0];
  const locationResult = await pool.query<{ id: string }>(
    "SELECT id FROM locations WHERE client_id = $1 ORDER BY id LIMIT 1",
    [clientId],
  );
  if (locationResult.rows.length === 0) {
    console.log("In-house recommendation persistence tests: skipped (no tenant location)");
    await pool.end();
    return;
  }

  const locationId = locationResult.rows[0].id;
  const fingerprint = `persistence-test-${Date.now()}`;
  const now = new Date();
  const freshCreatedAt = now.toISOString();
  const expiredCreatedAt = new Date(now.getTime() - 31 * 60 * 1000).toISOString();
  const insertedPlanIds: string[] = [];
  const testLocation = `Persistence Test Campus ${Date.now()}`;

  async function insertPlan(options: {
    clientId: string;
    userId: string;
    locationId: string | null;
    serviceLine: string;
    status: "proposed" | "applied" | "superseded";
    createdAt: string;
    recommendationId?: string;
  }) {
    const versionResult = await pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next
         FROM inhouse_rate_plans
        WHERE client_id = $1
          AND location IS NOT DISTINCT FROM $2
          AND service_line = $3`,
      [options.clientId, testLocation, options.serviceLine],
    );
    const snapshot = {
      createdAt: options.createdAt,
      maximumPremiumAboveTopCompetitorPct: 3,
      assumptionsFingerprint: fingerprint,
      recommendations: recommendations.map((recommendation) => ({
        ...recommendation,
        id: options.recommendationId ?? recommendation.id,
        serviceLine: options.serviceLine,
      })),
    };
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO inhouse_rate_plans
         (client_id, location_id, location, service_line, version, status,
          assumptions, summary, quarters, residents, applied_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]', '[]', $9, $10)
       RETURNING id`,
      [
        options.clientId,
        options.locationId,
        testLocation,
        options.serviceLine,
        Number(versionResult.rows[0]?.next) || 1,
        options.status,
        JSON.stringify({}),
        JSON.stringify({ streetRateRecommendationSnapshot: snapshot }),
        options.userId,
        options.createdAt,
      ],
    );
    const planId = inserted.rows[0].id;
    insertedPlanIds.push(planId);
    return planId;
  }

  try {
    // These rows are the durable records left by a submitted proposal. The
    // route module has no generated in-memory snapshot in this test process,
    // so the GET handler must reconstruct its response from the database.
    await insertPlan({
      clientId,
      userId,
      locationId,
      serviceLine: "AL",
      status: "proposed",
      createdAt: freshCreatedAt,
      recommendationId: "rec-campus-al",
    });
    await insertPlan({
      clientId,
      userId,
      locationId: null,
      serviceLine: "AL",
      status: "proposed",
      createdAt: freshCreatedAt,
      recommendationId: "rec-all-campus-al",
    });
    await insertPlan({
      clientId,
      userId,
      locationId,
      serviceLine: "HC",
      status: "proposed",
      createdAt: freshCreatedAt,
      recommendationId: "rec-campus-hc",
    });
    await insertPlan({
      clientId,
      userId,
      locationId,
      serviceLine: "SUPERSEDED",
      status: "superseded",
      createdAt: freshCreatedAt,
      recommendationId: "rec-superseded",
    });
    await insertPlan({
      clientId,
      userId,
      locationId,
      serviceLine: "PUBLISHED",
      status: "applied",
      createdAt: freshCreatedAt,
      recommendationId: "rec-published",
    });
    await insertPlan({
      clientId,
      userId,
      locationId,
      serviceLine: "EXPIRED",
      status: "proposed",
      createdAt: expiredCreatedAt,
      recommendationId: "rec-expired",
    });

    const registeredRoutes = new Map<string, (req: any, res: any) => Promise<void>>();
    const fakeApp = {
      get(path: string, handler: (req: any, res: any) => Promise<void>) {
        registeredRoutes.set(`GET ${path}`, handler);
      },
      post(path: string, handler: (req: any, res: any) => Promise<void>) {
        registeredRoutes.set(`POST ${path}`, handler);
      },
    };
    registerInhousePlanningRoutes(fakeApp as any);
    const latest = registeredRoutes.get("GET /api/inhouse-planning/recommendations/latest");
    const edit = registeredRoutes.get("POST /api/inhouse-planning/recommendations/edit");
    assert.ok(latest, "the latest recommendations route should be registered");
    assert.ok(edit, "the recommendation edit route should be registered");

    async function requestLatest(requestClientId: string, requestUserId: string, query: Record<string, string>) {
      let statusCode = 200;
      let body: any;
      const response = {
        status(code: number) {
          statusCode = code;
          return response;
        },
        setHeader() {
          return response;
        },
        json(value: any) {
          body = value;
          return response;
        },
      };
      await latest!(
        {
          clientId: requestClientId,
          query,
          session: { userId: requestUserId, clientId: requestClientId },
        },
        response,
      );
      return { statusCode, body };
    }

    async function requestEdit(
      requestClientId: string,
      requestUserId: string,
      body: Record<string, unknown>,
    ) {
      let statusCode = 200;
      let responseBody: any;
      const response = {
        status(code: number) {
          statusCode = code;
          return response;
        },
        setHeader() {
          return response;
        },
        json(value: any) {
          responseBody = value;
          return response;
        },
      };
      await edit!(
        {
          clientId: requestClientId,
          body,
          session: { userId: requestUserId, clientId: requestClientId },
        },
        response,
      );
      return { statusCode, body: responseBody };
    }

    const restored = await requestLatest(clientId, userId, {
      locationId,
      serviceLine: "AL",
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(
      restored.body.recommendations.length,
      1,
      "restart reload returns only a fresh proposed snapshot for the requested scope",
    );
    assert.equal(restored.body.recommendations[0].id, "rec-campus-al");
    assert.equal(restored.body.createdAt, freshCreatedAt);

    const edited = await requestEdit(clientId, userId, {
      id: "rec-campus-al",
      locationId,
      serviceLine: "AL",
      suggestedRate: 4350,
      locked: true,
    });
    assert.equal(edited.statusCode, 200, "a fresh persisted proposal can be edited after restart");
    assert.equal(edited.body.recommendation.suggestedRate, 4350);
    assert.equal(edited.body.recommendation.locked, true);

    for (const [label, requestClientId, requestUserId, query] of [
      ["different tenant", "__different-tenant__", userId, { locationId, serviceLine: "AL" }],
      ["different user", clientId, "__different-user__", { locationId, serviceLine: "AL" }],
      ["different campus", clientId, userId, { locationId: "__different-campus__", serviceLine: "AL" }],
      ["different service line", clientId, userId, { locationId, serviceLine: "MC" }],
    ] as const) {
      const isolated = await requestLatest(requestClientId, requestUserId, query);
      assert.equal(isolated.statusCode, 200);
      assert.equal(
        isolated.body.recommendations.length,
        0,
        `${label} cannot see the submitted recommendation`,
      );
    }

    for (const [label, requestClientId, requestUserId, body] of [
      [
        "different tenant",
        "__different-tenant__",
        userId,
        { id: "rec-campus-al", locationId, serviceLine: "AL", suggestedRate: 4350 },
      ],
      [
        "different user",
        clientId,
        "__different-user__",
        { id: "rec-campus-al", locationId, serviceLine: "AL", suggestedRate: 4350 },
      ],
      [
        "different campus",
        clientId,
        userId,
        { id: "rec-campus-al", locationId: "__different-campus__", serviceLine: "AL", suggestedRate: 4350 },
      ],
      [
        "missing campus scope",
        clientId,
        userId,
        { id: "rec-campus-al", serviceLine: "AL", suggestedRate: 4350 },
      ],
      [
        "different service line",
        clientId,
        userId,
        { id: "rec-campus-al", locationId, serviceLine: "MC", suggestedRate: 4350 },
      ],
    ] as const) {
      const isolated = await requestEdit(requestClientId, requestUserId, body);
      assert.equal(
        isolated.statusCode,
        404,
        `${label} edit should return the existing unavailable response`,
      );
      assert.equal(isolated.body.error, "Recommendation is no longer available");
    }

    for (const [label, serviceLine, id] of [
      ["superseded", "SUPERSEDED", "rec-superseded"],
      ["published", "PUBLISHED", "rec-published"],
      ["expired", "EXPIRED", "rec-expired"],
    ] as const) {
      const unavailable = await requestEdit(clientId, userId, {
        id,
        locationId,
        serviceLine,
        suggestedRate: 4350,
      });
      assert.equal(
        unavailable.statusCode,
        404,
        `${label} proposal edit should return the existing unavailable response`,
      );
      assert.equal(unavailable.body.error, "Recommendation is no longer available");
    }

    const restoredRows = await loadPersistedRecommendationSnapshots(clientId, userId);
    assert.equal(
      restoredRows.filter((row) => row.locationId === locationId && row.serviceLine === "AL").length,
      1,
      "only the fresh proposed AL snapshot remains eligible for this campus",
    );
  } finally {
    if (insertedPlanIds.length > 0) {
      await pool.query("DELETE FROM inhouse_rate_plans WHERE id = ANY($1::varchar[])", [insertedPlanIds]);
    }
    await pool.end();
  }
}

await verifyDatabaseReloadAndEligibility();

console.log("In-house recommendation persistence tests: passed");