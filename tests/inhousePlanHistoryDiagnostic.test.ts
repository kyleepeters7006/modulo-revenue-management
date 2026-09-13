/**
 * Saved in-house plan diagnostic persistence regression test.
 *
 * This uses a throwaway tenant and inserts only the immutable plan-history
 * rows. It deliberately does not seed rent-roll data or call the solver: the
 * contract under test is the storage/API round trip after submission.
 *
 * Requires DATABASE_URL; the route handlers are exercised in-process.
 * Run with: npx tsx tests/inhousePlanHistoryDiagnostic.test.ts
 */
import assert from "node:assert/strict";
import pg from "pg";
import { registerInhousePlanningRoutes } from "../server/routes/inhousePlanningRoutes";

const { Pool } = pg;
const SUFFIX = `${Date.now()}-${process.pid}`;
const CLIENT = `inhouse_plan_history_${SUFFIX}`;
const USERNAME = `ptest_inhouse_plan_history_${SUFFIX}`;
const SERVICE_LINE = "AL";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let userId = "";

const diagnostic = {
  maximumQuarterDeviationPct: 2.75,
  maximumQuarterLabel: "2027 Q3",
  cumulativeDeviationPct: 4.5,
  quarters: [
    {
      label: "2027 Q3",
      priorYearRateMonthly: 4_000,
      requiredRateMonthly: 4_180,
      projectedRateMonthly: 4_295,
      deviationPct: 2.75,
      overshootPct: 2.75,
      shortfallPct: 0,
      testable: true,
    },
  ],
  drivers: [
    {
      id: "resident_guardrails",
      label: "Resident guardrails",
      status: "contributing",
      maximumQuarterContributionPct: 1.25,
      cumulativeContributionPct: 2.1,
      note: "The resident increase bounds pushed the selected path above target.",
    },
    {
      id: "street_bounds",
      label: "Street Rate bounds",
      status: "mitigating",
      maximumQuarterContributionPct: -0.4,
      cumulativeContributionPct: -0.7,
      note: "The Street Rate ceiling reduced the modeled deviation.",
    },
    {
      id: "effective_date_timing",
      label: "Effective-date timing",
      status: "not_binding",
      maximumQuarterContributionPct: 0,
      cumulativeContributionPct: 0,
      note: "Timing did not materially affect the selected path.",
    },
  ],
} as const;

const assumptions = {
  rateGrowthTargetPct: 4.5,
  measurementMode: "quarterly_yoy",
  streetRateEffectiveDate: "2027-01-01",
  inhouseEffectiveDate: "2027-01-01",
  annualTurnoverPct: 35,
  minInhouseIncreasePct: 0,
  maxInhouseIncreasePct: 8,
  equalizationStrength: "medium",
  allowInhouseAboveStreet: true,
  maxStreetIncreasePct: 15,
  minStreetIncreasePct: 0,
  desiredVarianceToTopCompetitorPct: 0,
  maxYoYStreetIncreasePct: 15,
};

async function cleanup() {
  await pool.query(`DELETE FROM inhouse_rate_plans WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM adjustment_rules WHERE client_id = $1`, [CLIENT]);
  await pool.query(`DELETE FROM security_audit_events WHERE user_id = $1`, [userId || ""]);
  await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId || ""]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM clients WHERE id = $1`, [CLIENT]);
}

async function setupFixture() {
  await pool.query(
    `INSERT INTO clients (id, name) VALUES ($1, $2)`,
    [CLIENT, "In-house plan history test"],
  );
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users
       (username, client_id)
     VALUES ($1, $2)
     RETURNING id`,
    [USERNAME, CLIENT],
  );
  userId = user.rows[0]?.id || "";
  if (!userId) throw new Error("test user was not created");
}

async function seedLegacyPlanHistory() {
  await pool.query(
    `INSERT INTO inhouse_rate_plans
       (client_id, service_line, version, status, assumptions, summary,
        quarters, residents, target_deviation_diagnostic,
        street_rate_effective_date, inhouse_effective_date, recommended_street_rate,
        created_at)
     VALUES
       ($1, $2, 2, 'applied', $3, $4, $5, $6, NULL, '2026-01-01', '2026-01-01', 4000, $7)`,
    [
      CLIENT,
      SERVICE_LINE,
      JSON.stringify(assumptions),
      JSON.stringify({ weightedAvgIncreasePct: 4.5 }),
      JSON.stringify([]),
      JSON.stringify([]),
      "2026-01-02T12:00:00Z",
    ],
  );
}

function makeRouteHarness() {
  const handlers = new Map<string, Array<(req: any, res: any, next?: () => Promise<void>) => unknown>>();
  const fakeApp = {
    get(path: string, ...routeHandlers: any[]) {
      handlers.set(`GET ${path}`, routeHandlers);
    },
    post(path: string, ...routeHandlers: any[]) {
      handlers.set(`POST ${path}`, routeHandlers);
    },
  };

  const submittedPlan = {
    feasible: true,
    scope: {
      clientId: CLIENT,
      locationId: null,
      location: null,
      serviceLine: SERVICE_LINE,
      sourceMonth: "2026-12",
    },
    assumptions,
    summary: {
      weightedAvgIncreasePct: 4.5,
    },
    quarters: [],
    residents: [],
    targetDeviationDiagnostic: diagnostic,
    streetIncreasePct: 3,
    recommendedStreetRateDisplay: 4_200,
  };

  registerInhousePlanningRoutes(fakeApp as any, {
    calculatePlan: async (input: any) => ({
      ...submittedPlan,
      scope: {
        ...submittedPlan.scope,
        clientId: input.clientId,
        locationId: input.locationId,
        location: input.location,
        serviceLine: input.serviceLine,
      },
      assumptions: input.assumptions,
    }) as any,
  });

  async function invoke(method: "GET" | "POST", path: string, body?: unknown) {
    const routeHandlers = handlers.get(`${method} ${path}`);
    if (!routeHandlers) throw new Error(`route was not registered: ${method} ${path}`);
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
      json(value: unknown) {
        responseBody = value;
        return response;
      },
      end() {
        return response;
      },
    };
    const req = {
      clientId: CLIENT,
      session: { clientId: CLIENT, userId },
      body,
      query: method === "GET" ? { serviceLine: SERVICE_LINE } : {},
    };
    let nextPromise: Promise<unknown> | undefined;
    let index = 0;
    const next = () => {
      const handler = routeHandlers[index++];
      if (!handler) return Promise.resolve();
      nextPromise = Promise.resolve(handler(req, response, next));
      return nextPromise.then(() => undefined);
    };
    await Promise.resolve(routeHandlers[index++](req, response, next));
    if (nextPromise) await nextPromise;
    return { statusCode, body: responseBody };
  }

  return { invoke };
}

async function main() {
  await cleanup();
  try {
    await setupFixture();
    const harness = makeRouteHarness();

    const apply = await harness.invoke("POST", "/api/inhouse-planning/apply", {
      serviceLine: SERVICE_LINE,
      assumptions,
    });
    assert.equal(apply.statusCode, 200, `plan submission should succeed: ${JSON.stringify(apply.body)}`);
    assert.equal(apply.body?.ok, true, "newly submitted plan uses the production apply handler");
    await seedLegacyPlanHistory();

    const history = await harness.invoke("GET", "/api/inhouse-planning/plans");
    assert.equal(history.statusCode, 200, `history read should succeed: ${JSON.stringify(history.body)}`);
    const body = history.body as {
      plans: Array<{
        version: number;
        targetDeviationDiagnostic?: typeof diagnostic | null;
      }>;
    };

    const submitted = body.plans.find((plan) => plan.version === 1);
    assert.ok(submitted, "newly submitted plan is present in history");
    assert.deepEqual(
      submitted?.targetDeviationDiagnostic,
      diagnostic,
      "saved target-deviation diagnostic survives the API/storage round trip",
    );
    assert.equal(
      submitted?.targetDeviationDiagnostic?.maximumQuarterDeviationPct,
      diagnostic.maximumQuarterDeviationPct,
      "history preserves the maximum-quarter deviation",
    );
    assert.equal(
      submitted?.targetDeviationDiagnostic?.cumulativeDeviationPct,
      diagnostic.cumulativeDeviationPct,
      "history preserves cumulative deviation",
    );
    assert.deepEqual(
      submitted?.targetDeviationDiagnostic?.drivers.map((driver) => ({
        id: driver.id,
        status: driver.status,
      })),
      diagnostic.drivers.map((driver) => ({ id: driver.id, status: driver.status })),
      "history preserves each driver status",
    );

    const legacy = body.plans.find((plan) => plan.version === 2);
    assert.ok(legacy, "legacy plan is present in history");
    assert.equal(
      Object.prototype.hasOwnProperty.call(legacy, "targetDeviationDiagnostic"),
      true,
      "legacy history explicitly includes the diagnostic field",
    );
    assert.equal(
      legacy?.targetDeviationDiagnostic,
      null,
      "legacy history returns an explicit unavailable diagnostic value",
    );

    console.log("Saved in-house plan diagnostic history test passed");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});