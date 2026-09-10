import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  loadPersistedRecommendationSnapshots,
  recommendationSnapshotFromPlan,
  recommendationSnapshotKey,
  registerInhousePlanningRoutes,
} from "../server/routes/inhousePlanningRoutes";
import { registerRoutes } from "../server/routes";
import {
  addToPlanGroup,
  finalizePlanGroup,
  loadAppliedPlanRates,
  loadRecommendedPlanRates,
  newPlanGroupAccumulator,
  unitKey,
} from "../server/services/inhouseRatePlanning/appliedPlanRates";
import { pool } from "../server/db";
import { DEFAULT_ASSUMPTIONS } from "../shared/inhousePlanning";
import { calculatePlan } from "../server/services/inhouseRatePlanning";
import {
  getRefDataCache,
  invalidateRefDataCache,
  setRefDataCache,
} from "../server/refDataCache";

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
  const adminResult = await pool.query<{ id: string }>(
    `SELECT id
       FROM users
      WHERE client_id = $1 AND role IN ('admin', 'security_admin')
      LIMIT 1`,
    [clientId],
  );
  const locationResult = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM locations WHERE client_id = $1 ORDER BY id LIMIT 1",
    [clientId],
  );
  if (locationResult.rows.length === 0) {
    console.log("In-house recommendation persistence tests: skipped (no tenant location)");
    await pool.end();
    return;
  }

  const locationId = locationResult.rows[0].id;
  let fullServer: any;
  const exportAssumptions = { ...DEFAULT_ASSUMPTIONS };
  const fingerprint = JSON.stringify({
    assumptions: exportAssumptions,
    maximumPremiumAboveTopCompetitorPct: 3,
  });
  const now = new Date();
  const freshCreatedAt = now.toISOString();
  const expiredCreatedAt = new Date(now.getTime() - 31 * 60 * 1000).toISOString();
  const insertedPlanIds: string[] = [];
  let isolatedClientId: string | null = null;
  let isolatedUserId: string | null = null;
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
    const applyRoute = registeredRoutes.get("POST /api/inhouse-planning/apply");
    assert.ok(applyRoute, "the in-house plan submit route should be registered");
    const exportRoute = registeredRoutes.get("POST /api/inhouse-planning/export");
    assert.ok(exportRoute, "the Street Rate export route should be registered");

    // Capture the real Rule Administration and Reference Data handlers too.
    // The full route registrar starts background schedulers, so timers created
    // during this test are explicitly unref'd and cannot keep the test process
    // alive.
    const fullRoutes = new Map<string, Array<(...args: any[]) => any>>();
    const fullApp = Object.assign(((..._args: any[]) => {}) as any, {
      use() {},
      get(path: string, ...handlers: Array<(...args: any[]) => any>) {
        if (
          path === "/api/reference-data" ||
          path === "/api/reference-data/units"
        ) {
          fullRoutes.set(`GET ${path}`, handlers);
        }
      },
      post(path: string, ...handlers: Array<(...args: any[]) => any>) {
        if (
          path === "/api/adjustment-rules/:id/implement" ||
          path === "/api/adjustment-rules/publish"
        ) {
          fullRoutes.set(`POST ${path}`, handlers);
        }
      },
      put() {},
      patch() {},
      delete() {},
    });
    const originalSetInterval = globalThis.setInterval;
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setInterval = (...args: any[]) => {
      const timer = originalSetInterval(...args);
      timer.unref?.();
      return timer;
    };
    (globalThis as any).setTimeout = (...args: any[]) => {
      const timer = originalSetTimeout(...args);
      timer.unref?.();
      return timer;
    };
    try {
      fullServer = await registerRoutes(fullApp as any);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.setTimeout = originalSetTimeout;
    }
    const implementRoute = fullRoutes.get("POST /api/adjustment-rules/:id/implement");
    const publishRoute = fullRoutes.get("POST /api/adjustment-rules/publish");
    const groupedReferenceData = fullRoutes.get("GET /api/reference-data");
    const detailReferenceData = fullRoutes.get("GET /api/reference-data/units");
    assert.ok(implementRoute, "the Rule Administration implementation route should be registered");
    assert.ok(publishRoute, "the Rule Administration publish route should be registered");
    assert.ok(groupedReferenceData, "the grouped Reference Data route should be registered");
    assert.ok(detailReferenceData, "the room-detail Reference Data route should be registered");

    async function dispatchRoute(
      handlers: Array<(...args: any[]) => any>,
      req: any,
      response: any,
    ) {
      const dispatch = async (index: number): Promise<void> => {
        const handler = handlers[index];
        if (!handler) return;
        await handler(req, response, () => dispatch(index + 1));
      };
      await dispatch(0);
    }

    function responseCapture() {
      let statusCode = 200;
      let body: any;
      const response: any = {
        status(code: number) {
          statusCode = code;
          return response;
        },
        set() {
          return response;
        },
        setHeader() {
          return response;
        },
        json(value: any) {
          body = value;
          return response;
        },
        send(value: any) {
          body = value;
          return response;
        },
      };
      return {
        response,
        get statusCode() {
          return statusCode;
        },
        get body() {
          return body;
        },
      };
    }

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

    await insertPlan({
      clientId,
      userId,
      locationId: null,
      serviceLine: "AL",
      status: "proposed",
      createdAt: freshCreatedAt,
      recommendationId: "rec-all-campus-al",
      suggestedRate: 4300,
    });
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

    // Exercise the real calculate -> submit path on a scope with enough live
    // data to produce resident allocations. The synthetic rows below then
    // isolate the lifecycle projection, while this request guards that the
    // persisted plan is actually produced by the solver route.
    const submitAssumptions = {
      ...DEFAULT_ASSUMPTIONS,
      rateGrowthTargetPct: -20,
      maxInhouseIncreasePct: 100,
      maxStreetIncreasePct: 100,
      maxYoYStreetIncreasePct: 100,
    };
    const scopeResult = await pool.query<{
      location_id: string;
      location_name: string;
      service_line: string;
    }>(
      `SELECT loc.id AS location_id, loc.name AS location_name, rr.service_line
         FROM locations loc
         JOIN rent_roll_data rr
           ON rr.client_id = loc.client_id AND rr.location = loc.name
        WHERE loc.client_id = $1
          AND rr.occupied_yn = true
          AND COALESCE(rr.in_house_rate, 0) > 0
          AND NOT EXISTS (
            SELECT 1
              FROM inhouse_rate_plans p
             WHERE p.client_id = $1
               AND p.location_id = loc.id
               AND p.service_line = rr.service_line
               AND p.status = 'proposed'
          )
        GROUP BY loc.id, loc.name, rr.service_line
        ORDER BY COUNT(*) DESC
        LIMIT 30`,
      [clientId],
    );
    let liveScope: (typeof scopeResult.rows)[number] | undefined;
    for (const candidate of scopeResult.rows) {
      try {
        const calculated = await calculatePlan({
          clientId,
          locationId: candidate.location_id,
          location: candidate.location_name,
          serviceLine: candidate.service_line,
          assumptions: submitAssumptions,
        });
        if (calculated.feasible) {
          liveScope = candidate;
          break;
        }
      } catch {
        // Sparse scopes without a measurable prior-year baseline are not
        // eligible for a live submit fixture; keep looking for one that is.
      }
    }
    if (liveScope) {
      const beforeSubmit = await pool.query(
        `SELECT rule_adjusted_rate, applied_rule_name
           FROM rent_roll_data
          WHERE client_id = $1 AND location = $2 AND service_line = $3
          ORDER BY room_number
          LIMIT 1`,
        [clientId, liveScope.location_name, liveScope.service_line],
      );
      let submitStatus = 200;
      let submitBody: any;
      const submitResponse = {
        status(code: number) {
          submitStatus = code;
          return submitResponse;
        },
        setHeader() {
          return submitResponse;
        },
        json(value: any) {
          submitBody = value;
          return submitResponse;
        },
      };
      await applyRoute!(
        {
          clientId,
          body: {
            locationId: liveScope.location_id,
            serviceLine: liveScope.service_line,
            assumptions: submitAssumptions,
            recommendations: [],
          },
          session: { userId, clientId },
        },
        submitResponse,
      );
      assert.equal(
        submitStatus,
        200,
        `live ${liveScope.service_line} plan should submit: ${JSON.stringify(submitBody)}`,
      );
      assert.ok(submitBody.planId, "submitting a calculated plan returns its durable plan id");
      insertedPlanIds.push(submitBody.planId);
      const submittedPlan = await pool.query<{ status: string; residents: any[] }>(
        `SELECT status, residents
           FROM inhouse_rate_plans
          WHERE id = $1 AND client_id = $2`,
        [submitBody.planId, clientId],
      );
      assert.equal(submittedPlan.rows[0]?.status, "proposed");
      assert.ok(
        Array.isArray(submittedPlan.rows[0]?.residents) &&
          submittedPlan.rows[0].residents.length > 0,
        "the submitted plan stores solver resident allocations",
      );
      const afterSubmit = await pool.query(
        `SELECT rule_adjusted_rate, applied_rule_name
           FROM rent_roll_data
          WHERE client_id = $1 AND location = $2 AND service_line = $3
          ORDER BY room_number
          LIMIT 1`,
        [clientId, liveScope.location_name, liveScope.service_line],
      );
      assert.deepEqual(
        afterSubmit.rows,
        beforeSubmit.rows,
        "submitting a recommendation does not change Final/applied rate fields",
      );

      for (const [label, route] of [
        ["grouped", groupedReferenceData],
        ["room-detail", detailReferenceData],
      ] as const) {
        const referenceResponse = responseCapture();
        await dispatchRoute(
          route!,
          {
            clientId,
            query: {
              locations: liveScope.location_name,
              serviceLine: liveScope.service_line,
            },
            headers: {},
            session: { userId, clientId },
          },
          referenceResponse.response,
        );
        assert.equal(referenceResponse.statusCode, 200, `${label} Reference Data should load after submit`);
        const referenceRows = referenceResponse.body?.rows ?? [];
        assert.ok(
          referenceRows.some((row: any) =>
            Number.isFinite(Number(row.ihRecommendationNewRate ?? row.recommendedRate)),
          ),
          `${label} Reference Data exposes the submitted recommendation`,
        );
      }
    }

    // The same plan rows feed both grouped Reference Data and Room Detail.
    // Keep this as a real database lifecycle check instead of constructing the
    // indexes by hand: a proposed row must be visible only in Recommended,
    // then the single proposed -> applied transition must move the same unit
    // values to Applied/Final without replaying them.
    const monthlyResident = {
      location: testLocation,
      serviceLine: "AL",
      roomNumber: "L-101",
      roomType: "Studio",
      moveInDate: "2025-01-15",
      newRateDisplay: 4_350,
      currentRateDisplay: 4_200,
      increaseDollarsDisplay: 150,
      increaseDollarsMonthly: 150,
      increasePct: 150 / 4_200,
      isCompanionBed: false,
    };
    const dailyResident = {
      location: testLocation,
      serviceLine: "HC",
      roomNumber: "D-201",
      roomType: "Studio",
      moveInDate: "2025-02-15",
      newRateDisplay: 175,
      currentRateDisplay: 160,
      increaseDollarsDisplay: 15,
      increaseDollarsMonthly: 15 * 30,
      increasePct: 15 / 160,
      isCompanionBed: false,
    };
    const lifecyclePlans: string[] = [];
    for (const [serviceLine, resident, effectiveDate] of [
      ["AL", monthlyResident, "2027-01-01"],
      ["HC", dailyResident, "2027-01-01"],
    ] as const) {
      const versionResult = await pool.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM inhouse_rate_plans
          WHERE client_id = $1
            AND location IS NOT DISTINCT FROM $2
            AND service_line = $3`,
        [clientId, testLocation, serviceLine],
      );
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO inhouse_rate_plans
           (client_id, location_id, location, service_line, version, status,
            assumptions, summary, quarters, residents, inhouse_effective_date,
            applied_by, created_at)
         VALUES ($1, NULL, $2, $3, $4, 'proposed', '{}', '{}', '[]', $5, $6, $7, $8)
         RETURNING id`,
        [
          clientId,
          testLocation,
          serviceLine,
          Number(versionResult.rows[0]?.next) || 1,
          JSON.stringify([resident]),
          effectiveDate,
          userId,
          freshCreatedAt,
        ],
      );
      lifecyclePlans.push(inserted.rows[0].id);
      insertedPlanIds.push(inserted.rows[0].id);
    }

    // Publish a second, fully isolated pair through the real endpoint. This
    // proves the status transition is not being simulated by the test while
    // keeping the shared tenant's existing rules untouched.
    isolatedClientId = `inhouse-persistence-${Date.now()}`;
    isolatedUserId = `inhouse-persistence-user-${Date.now()}`;
    await pool.query("INSERT INTO clients (id, name) VALUES ($1, $2)", [
      isolatedClientId,
      "In-house persistence test tenant",
    ]);
    await pool.query(
      `INSERT INTO users (id, username, email, client_id, role)
       VALUES ($1, $2, $2, $3, 'admin')`,
      [isolatedUserId, `${isolatedUserId}@example.test`, isolatedClientId],
    );
    const isolatedPlanId = await insertPlan({
      clientId: isolatedClientId,
      serviceLine: "AL",
      status: "proposed",
      userId: isolatedUserId,
      createdAt: freshCreatedAt,
    });
    await pool.query(
      `UPDATE inhouse_rate_plans
          SET residents = $1::jsonb
        WHERE id = $2`,
      [JSON.stringify([monthlyResident]), isolatedPlanId],
    );
    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, upload_month, date, location, room_number, room_type,
          occupied_yn, size, street_rate, in_house_rate, service_line)
       VALUES ($1, '2026-08', '2026-08-01', $2, 'L-101', 'Studio',
               true, '', 4200, 4200, 'AL')`,
      [isolatedClientId, testLocation],
    );
    for (const proposalType of ["annual_plan_street_rate", "inhouse_rate_plan"]) {
      await pool.query(
        `INSERT INTO adjustment_rules
           (client_id, location_id, service_line, service_lines, name, description,
            trigger, action, is_active, lifecycle_status, created_by)
         VALUES ($1, NULL, 'AL', ARRAY['AL']::text[], $2, $2, $3, $4, false, 'proposed', $5)`,
        [
          isolatedClientId,
          `Isolated lifecycle ${proposalType}`,
          JSON.stringify({ type: "immediate" }),
          JSON.stringify({ annualPlanId: isolatedPlanId, proposalType }),
          isolatedUserId,
        ],
      );
    }
    const isolatedRule = await pool.query<{ id: string }>(
      `SELECT id
         FROM adjustment_rules
        WHERE client_id = $1
          AND action->>'annualPlanId' = $2
        ORDER BY id
        LIMIT 1`,
      [isolatedClientId, isolatedPlanId],
    );
    const isolatedImplementResponse = responseCapture();
    await dispatchRoute(
      implementRoute!,
      {
        clientId: isolatedClientId,
        params: { id: isolatedRule.rows[0].id },
        session: { userId: isolatedUserId, clientId: isolatedClientId },
      },
      isolatedImplementResponse.response,
    );
    assert.equal(isolatedImplementResponse.statusCode, 200);
    const isolatedPublishResponse = responseCapture();
    await dispatchRoute(
      publishRoute!,
      {
        clientId: isolatedClientId,
        body: { confirm: true },
        session: { userId: isolatedUserId, clientId: isolatedClientId },
      },
      isolatedPublishResponse.response,
    );
    assert.equal(isolatedPublishResponse.statusCode, 200, "publishing the implemented proposal applies its plan");
    assert.equal((await pool.query("SELECT status FROM inhouse_rate_plans WHERE id = $1", [isolatedPlanId])).rows[0].status, "applied");
    assert.equal(
      (await loadAppliedPlanRates(isolatedClientId)).byUnit.get(unitKey(testLocation, "AL", "L-101", "Studio", "2025-01-15"))?.newRate,
      monthlyResident.newRateDisplay,
    );
    const isolatedPublishAgain = responseCapture();
    await dispatchRoute(
      publishRoute!,
      {
        clientId: isolatedClientId,
        body: { confirm: true },
        session: { userId: isolatedUserId, clientId: isolatedClientId },
      },
      isolatedPublishAgain.response,
    );
    assert.equal(isolatedPublishAgain.statusCode, 409, "publishing an applied proposal a second time is rejected");

    const monthlyKey = unitKey(
      monthlyResident.location,
      monthlyResident.serviceLine,
      monthlyResident.roomNumber,
      monthlyResident.roomType,
      monthlyResident.moveInDate,
    );
    const dailyKey = unitKey(
      dailyResident.location,
      dailyResident.serviceLine,
      dailyResident.roomNumber,
      dailyResident.roomType,
      dailyResident.moveInDate,
    );
    const recommendedBeforeImplementation = await loadRecommendedPlanRates(clientId);
    const appliedBeforeImplementation = await loadAppliedPlanRates(clientId);
    const monthlyRecommended = recommendedBeforeImplementation.byUnit.get(monthlyKey);
    const dailyRecommended = recommendedBeforeImplementation.byUnit.get(dailyKey);
    assert.equal(monthlyRecommended?.newRate, monthlyResident.newRateDisplay);
    assert.equal(monthlyRecommended?.increaseDollars, monthlyResident.increaseDollarsDisplay);
    assert.equal(monthlyRecommended?.increaseDollarsMonthly, monthlyResident.increaseDollarsMonthly);
    assert.equal(dailyRecommended?.newRate, dailyResident.newRateDisplay);
    assert.equal(dailyRecommended?.increaseDollars, dailyResident.increaseDollarsDisplay);
    assert.equal(dailyRecommended?.increaseDollarsMonthly, dailyResident.increaseDollarsMonthly);
    assert.equal(appliedBeforeImplementation.byUnit.has(monthlyKey), false);
    assert.equal(appliedBeforeImplementation.byUnit.has(dailyKey), false);

    // This is the pre-implementation invariant represented by both endpoint
    // payloads: no applied plan means no Final-rate takeover.
    const monthlyGroup = newPlanGroupAccumulator();
    addToPlanGroup(monthlyGroup, monthlyRecommended!);
    const monthlyFields = finalizePlanGroup(monthlyGroup);
    assert.equal(monthlyFields.ihPlanNewRate, monthlyResident.newRateDisplay);
    assert.equal(monthlyFields.ihPlanResidents, 1);
    assert.equal(monthlyFields.ihPlanMonthlyImpact, monthlyResident.increaseDollarsMonthly);

    // A cache entry is warm before implementation. The lifecycle invalidation
    // must remove it so the next grouped/detail read cannot serve the
    // recommendation-only payload after the plan becomes live.
    const lifecycleCacheKey = `lifecycle-test:${clientId}:${testLocation}`;
    setRefDataCache(lifecycleCacheKey, { recommendationOnly: true }, Date.now());
    assert.ok(getRefDataCache(lifecycleCacheKey));
    invalidateRefDataCache();
    assert.equal(getRefDataCache(lifecycleCacheKey), null);

    const firstTransition = await pool.query(
      `UPDATE inhouse_rate_plans
          SET status = 'applied'
        WHERE id = ANY($1::varchar[]) AND status = 'proposed'`,
      [lifecyclePlans],
    );
    assert.equal(firstTransition.rowCount, lifecyclePlans.length);
    const secondTransition = await pool.query(
      `UPDATE inhouse_rate_plans
          SET status = 'applied'
        WHERE id = ANY($1::varchar[]) AND status = 'proposed'`,
      [lifecyclePlans],
    );
    assert.equal(secondTransition.rowCount, 0, "a live plan cannot be applied twice");

    const recommendedAfterImplementation = await loadRecommendedPlanRates(clientId);
    const appliedAfterImplementation = await loadAppliedPlanRates(clientId);
    assert.equal(recommendedAfterImplementation.byUnit.has(monthlyKey), false);
    assert.equal(recommendedAfterImplementation.byUnit.has(dailyKey), false);
    assert.equal(appliedAfterImplementation.byUnit.get(monthlyKey)?.newRate, monthlyResident.newRateDisplay);
    assert.equal(appliedAfterImplementation.byUnit.get(dailyKey)?.newRate, dailyResident.newRateDisplay);
    assert.equal(appliedAfterImplementation.byUnit.size - appliedBeforeImplementation.byUnit.size, 2);

    const appliedMonthlyGroup = newPlanGroupAccumulator();
    addToPlanGroup(appliedMonthlyGroup, appliedAfterImplementation.byUnit.get(monthlyKey)!);
    const appliedMonthlyFields = finalizePlanGroup(appliedMonthlyGroup);
    assert.equal(appliedMonthlyFields.ihPlanNewRate, monthlyResident.newRateDisplay);
    assert.equal(appliedMonthlyFields.ihPlanResidents, 1);
    assert.equal(appliedMonthlyFields.ihPlanMonthlyImpact, monthlyResident.increaseDollarsMonthly);

    // Scope checks protect both endpoint projections from leaking a plan into
    // another tenant, location, or service line.
    assert.equal((await loadAppliedPlanRates("__other-tenant__")).byUnit.has(monthlyKey), false);
    assert.equal(
      appliedAfterImplementation.byUnit.has(unitKey(testLocation, "HC", monthlyResident.roomNumber, monthlyResident.roomType, monthlyResident.moveInDate)),
      false,
    );
    assert.equal(
      appliedAfterImplementation.byUnit.has(unitKey("__other-location__", "AL", monthlyResident.roomNumber, monthlyResident.roomType, monthlyResident.moveInDate)),
      false,
    );
  } finally {
    if (insertedPlanIds.length > 0) {
      await pool.query(
        "DELETE FROM adjustment_rules WHERE action->>'annualPlanId' = ANY($1::text[])",
        [insertedPlanIds],
      );
      await pool.query("DELETE FROM inhouse_rate_plans WHERE id = ANY($1::varchar[])", [insertedPlanIds]);
    }
    fullServer?.close?.();
    if (isolatedClientId) {
      await pool.query("DELETE FROM adjustment_rules WHERE client_id = $1", [isolatedClientId]);
      await pool.query("DELETE FROM rent_roll_data WHERE client_id = $1", [isolatedClientId]);
      await pool.query("DELETE FROM inhouse_rate_plans WHERE client_id = $1", [isolatedClientId]);
      await pool.query("DELETE FROM users WHERE id = $1", [isolatedUserId]);
      await pool.query("DELETE FROM clients WHERE id = $1", [isolatedClientId]);
    }
    await pool.end();
  }
}

await verifyDatabaseReloadAndEligibility();

console.log("In-house recommendation persistence tests: passed");
process.exit(0);
