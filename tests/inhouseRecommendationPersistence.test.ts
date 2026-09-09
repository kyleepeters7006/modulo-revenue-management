import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  loadPersistedRecommendationSnapshots,
  recommendationSnapshotFromPlan,
  recommendationSnapshotKey,
  registerInhousePlanningRoutes,
} from "../server/routes/inhousePlanningRoutes";
import { pool } from "../server/db";
import { DEFAULT_ASSUMPTIONS } from "../shared/inhousePlanning";

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
  const exportAssumptions = { ...DEFAULT_ASSUMPTIONS };
  const fingerprint = JSON.stringify({
    assumptions: exportAssumptions,
    maximumPremiumAboveTopCompetitorPct: 3,
  });
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
    suggestedRate?: number;
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
        suggestedRate: options.suggestedRate ?? recommendation.suggestedRate,
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
      suggestedRate: 4300,
    });
    await insertPlan({
      clientId,
      userId,
      locationId,
      serviceLine: "VIL",
      status: "proposed",
      createdAt: freshCreatedAt,
      recommendationId: "rec-campus-vil",
      suggestedRate: 4700,
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

    const registeredRoutes = new Map<string, (...args: any[]) => Promise<void>>();
    const fakeApp = {
      get(path: string, handler: (req: any, res: any) => Promise<void>) {
        registeredRoutes.set(`GET ${path}`, handler);
      },
      post(path: string, ...handlers: Array<(...args: any[]) => any>) {
        const handler = async (req: any, res: any) => {
          const dispatch = async (index: number): Promise<void> => {
            const middleware = handlers[index];
            if (!middleware) return;
            await middleware(req, res, () => dispatch(index + 1));
          };
          await dispatch(0);
        };
        if (handler) registeredRoutes.set(`POST ${path}`, handler);
      },
    };
    registerInhousePlanningRoutes(fakeApp as any);
    const latest = registeredRoutes.get("GET /api/inhouse-planning/recommendations/latest");
    const edit = registeredRoutes.get("POST /api/inhouse-planning/recommendations/edit");
    assert.ok(latest, "the latest recommendations route should be registered");
    assert.ok(edit, "the recommendation edit route should be registered");
    const exportRoute = registeredRoutes.get("POST /api/inhouse-planning/export");
    assert.ok(exportRoute, "the Street Rate export route should be registered");

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

    async function requestExport(
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
        end(value: any) {
          responseBody = value;
          return response;
        },
      };
      await exportRoute!(
        {
          clientId: requestClientId,
          body,
          session: { userId: requestUserId, clientId: requestClientId },
          user: { username: "persistence-test" },
        },
        response,
      );
      return { statusCode, body: responseBody };
    }

    const exportBody = {
      locationId,
      serviceLine: "AL",
      assumptions: exportAssumptions,
      maximumPremiumAboveTopCompetitorPct: 3,
      recommendations: [{ id: "rec-campus-al", suggestedRate: 4300, locked: false }],
    };

    const matchingExport = await requestExport(clientId, userId, exportBody);
    assert.equal(
      matchingExport.statusCode,
      200,
      "an authenticated export reopens the matching saved recommendation",
    );
    assert.ok(
      Buffer.isBuffer(matchingExport.body) && matchingExport.body.length > 0,
      "a matching recommendation export returns a workbook",
    );
    const snapshotExport = await requestExport(clientId, userId, {
      ...exportBody,
      recommendations: [],
    });
    assert.equal(snapshotExport.statusCode, 200, "a matching saved snapshot can be exported");
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(snapshotExport.body);
    const recommendationSheet = exportedWorkbook.getWorksheet("Street recommendations");
    assert.ok(recommendationSheet, "the export includes Street recommendations");
    assert.equal(
      recommendationSheet.rowCount,
      2,
      "the workbook contains only the selected campus/service-line recommendation",
    );
    assert.equal(recommendationSheet.getCell("A2").value, "Campus A");
    assert.equal(recommendationSheet.getCell("B2").value, "AL");
    assert.equal(recommendationSheet.getCell("C2").value, "Studio");
    assert.equal(recommendationSheet.getCell("D2").value, 4200);
    assert.equal(recommendationSheet.getCell("E2").value, 4400);
    assert.equal(
      recommendationSheet.getCell("F2").value,
      null,
      "the saved recommendation has no premium ceiling value",
    );
    assert.equal(
      recommendationSheet.getCell("G2").value,
      4300,
      "the workbook contains the matching saved recommendation values",
    );
    assert.ok(
      !recommendationSheet.getColumn(7).values.includes(4700),
      "the workbook excludes the other saved scope's recommendation",
    );

    let anonymousExportStatus = 200;
    let anonymousExportBody: any;
    const anonymousExportResponse = {
      status(code: number) {
        anonymousExportStatus = code;
        return anonymousExportResponse;
      },
      json(value: any) {
        anonymousExportBody = value;
        return anonymousExportResponse;
      },
    };
    await exportRoute!(
      { clientId, body: exportBody, user: { username: "anonymous-test" } },
      anonymousExportResponse,
    );
    assert.equal(anonymousExportStatus, 401, "anonymous users cannot export Street Rate workbooks");
    assert.match(
      String(anonymousExportBody?.error),
      /login required/i,
      "anonymous export rejection explains that login is required",
    );

    for (const [label, requestClientId, requestUserId, body] of [
      [
        "different tenant",
        "__different-tenant__",
        userId,
        { ...exportBody, locationId: null },
      ],
      [
        "different user",
        clientId,
        "__different-user__",
        exportBody,
      ],
      [
        "different campus",
        clientId,
        userId,
        { ...exportBody, locationId: null },
      ],
      [
        "different service line",
        clientId,
        userId,
        { ...exportBody, serviceLine: "HC" },
      ],
    ] as const) {
      const isolated = await requestExport(requestClientId, requestUserId, body);
      assert.notEqual(
        isolated.statusCode,
        200,
        `${label} cannot export the saved recommendation from this scope`,
      );
    }

    async function setPrimaryPlanState(
      status: "proposed" | "applied" | "superseded",
      createdAt?: string,
    ) {
      const primaryPlanId = insertedPlanIds[0];
      assert.ok(primaryPlanId, "the campus AL proposal should have been inserted");
      if (createdAt) {
        await pool.query(
          `UPDATE inhouse_rate_plans
              SET status = $2,
                  created_at = $3::timestamp,
                  summary = jsonb_set(
                    summary,
                    '{streetRateRecommendationSnapshot,createdAt}',
                    to_jsonb($4::text)
                  )
            WHERE id = $1`,
          [primaryPlanId, status, createdAt, createdAt],
        );
      } else {
        await pool.query(
          "UPDATE inhouse_rate_plans SET status = $2 WHERE id = $1",
          [primaryPlanId, status],
        );
      }
    }

    for (const [label, status] of [
      ["superseded", "superseded"],
      ["published", "applied"],
    ] as const) {
      await setPrimaryPlanState(status);
      const rejected = await requestExport(clientId, userId, exportBody);
      assert.equal(
        rejected.statusCode,
        409,
        `${label} recommendations cannot be exported`,
      );
    }

    await setPrimaryPlanState("proposed", expiredCreatedAt);
    const expiredExport = await requestExport(clientId, userId, exportBody);
    assert.equal(expiredExport.statusCode, 409, "expired recommendations cannot be exported");

    await setPrimaryPlanState("proposed", freshCreatedAt);
    const mismatchedExport = await requestExport(clientId, userId, {
      ...exportBody,
      assumptions: {
        ...exportAssumptions,
        rateGrowthTargetPct: exportAssumptions.rateGrowthTargetPct + 1,
      },
    });
    assert.equal(
      mismatchedExport.statusCode,
      409,
      "recommendations with changed assumptions cannot be exported",
    );

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
    assert.equal(
      restored.body.recommendations.some((recommendation: any) => recommendation.id === "rec-all-campus-al"),
      false,
      "a portfolio-wide proposal is not available for a campus-scoped request",
    );

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

    const portfolioRestored = await requestLatest(clientId, userId, {
      serviceLine: "AL",
    });
    assert.equal(portfolioRestored.statusCode, 200);
    assert.ok(
      portfolioRestored.body.recommendations.some(
        (recommendation: any) => recommendation.id === "rec-all-campus-al",
      ),
      "restart reload returns a portfolio-wide proposal when no campus scope is requested",
    );

    const portfolioEdited = await requestEdit(clientId, userId, {
      id: "rec-all-campus-al",
      serviceLine: "AL",
      suggestedRate: 4350,
      locked: true,
    });
    assert.equal(
      portfolioEdited.statusCode,
      200,
      "a fresh portfolio-wide proposal can be edited after restart without a campus scope",
    );
    assert.equal(portfolioEdited.body.recommendation.suggestedRate, 4350);
    assert.equal(portfolioEdited.body.recommendation.locked, true);

    for (const [label, body] of [
      [
        "campus-scoped request",
        { id: "rec-all-campus-al", locationId, serviceLine: "AL", suggestedRate: 4350 },
      ],
      [
        "different service line",
        { id: "rec-all-campus-al", serviceLine: "HC", suggestedRate: 4350 },
      ],
    ] as const) {
      const unavailable = await requestEdit(clientId, userId, body);
      assert.equal(
        unavailable.statusCode,
        404,
        `${label} cannot edit the portfolio-wide recommendation`,
      );
      assert.equal(unavailable.body.error, "Recommendation is no longer available");
    }

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
