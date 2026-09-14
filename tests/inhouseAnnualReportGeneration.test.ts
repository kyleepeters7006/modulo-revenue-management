/**
 * Regression coverage for portfolio-to-campus annual report generation.
 *
 * The first section protects the bounded worker pool. The endpoint fixture
 * below exercises the authenticated report reads and the real database
 * upsert/filter boundary while using a deterministic tier calculator.
 *
 * Requires DATABASE_URL; run with:
 *   npx tsx tests/inhouseAnnualReportGeneration.test.ts
 */
import assert from "node:assert/strict";
import pg from "pg";
import { registerInhousePlanningRoutes } from "../server/routes/inhousePlanningRoutes";
import { generateCampusAnnualReports } from "../server/services/inhouseAnnualReportGeneration";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SUFFIX = `${Date.now()}-${process.pid}`;
const CLIENT = `inhouse_annual_report_${SUFFIX}`;
const OTHER_CLIENT = `inhouse_annual_report_other_${SUFFIX}`;
const SERVICE_LINE = "AL";
const SCOPE_KEY = (locationId: string) => `${locationId}|${SERVICE_LINE}`;

type RouteHandler = (req: any, res: any, next?: () => Promise<void>) => unknown;

async function assertWorkerPoolContract() {
  const locations = [
    { id: "a", name: "Campus A" },
    { id: "b", name: "Campus B" },
    { id: "c", name: "Campus C" },
  ];
  const lines = [
    { serviceLine: SERVICE_LINE, assumptions: { rateGrowthTargetPct: 6 }, tierPolicy: { lowCutoffPct: 88 } },
  ];
  let active = 0;
  let peak = 0;
  const saved: string[] = [];
  const result = await generateCampusAnnualReports({
    locations,
    lines,
    concurrency: 2,
    calculate: async (location, postedLines) => {
      assert.deepEqual(postedLines, lines, "each campus receives the explicit portfolio inputs");
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, location.id === "b" ? 15 : 2));
      active -= 1;
      if (location.id === "b") throw new Error("campus calculation failed");
      return {
        lines: [{
          serviceLine: SERVICE_LINE,
          currentPlan: {},
          occupancyPct: 92,
          occupancyMonth: "2026-12",
          currentTier: "target",
          cells: [],
          warnings: [],
        }],
        skipped: [],
      };
    },
    save: async ({ location }) => {
      saved.push(location.id);
    },
  });

  assert.equal(peak, 2, "campus calculations never exceed the configured concurrency");
  assert.deepEqual(saved.sort(), ["a", "c"], "successful campuses are saved independently");
  assert.deepEqual(result.failed.map(({ locationId }) => locationId), ["b"]);
}

const assumptions = {
  rateGrowthTargetPct: 6,
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

const tierGuardrails = {
  minInhouseIncreasePct: 0,
  maxInhouseIncreasePct: 8,
  minStreetIncreasePct: 0,
  maxStreetIncreasePct: 15,
  maxYoYStreetIncreasePct: 15,
  desiredVarianceToTopCompetitorPct: 0,
  equalizationStrength: "medium",
};

const tierPolicy = {
  lowCutoffPct: 88,
  highCutoffPct: 94,
  tiers: {
    low: tierGuardrails,
    target: tierGuardrails,
    high: tierGuardrails,
  },
};

function makePlan(input: any, line: any) {
  return {
    feasible: true,
    scope: {
      clientId: input.clientId,
      locationId: input.locationId,
      location: input.location,
      serviceLine: line.serviceLine,
      sourceMonth: "2026-12",
    },
    assumptions: line.assumptions,
    summary: {
      weightedAvgIncreasePct: line.assumptions.rateGrowthTargetPct,
      testRun: input.__testRun,
    },
    quarters: [],
    residents: [{ increasePct: 4 }],
    warnings: [],
  };
}

function makeTierResult(input: any) {
  return {
    lines: input.lines.map((line: any) => ({
      serviceLine: line.serviceLine,
      currentPlan: makePlan(input, line),
      occupancyPct: input.locationId ? 91 : 90,
      occupancyMonth: "2026-12",
      currentTier: "target",
      cells: [],
      warnings: [],
    })),
    skipped: [],
  };
}

function makeRouteHarness(dependencies: any) {
  const handlers = new Map<string, RouteHandler[]>();
  const fakeApp = {
    get(path: string, ...routeHandlers: RouteHandler[]) {
      handlers.set(`GET ${path}`, routeHandlers);
    },
    post(path: string, ...routeHandlers: RouteHandler[]) {
      handlers.set(`POST ${path}`, routeHandlers);
    },
  };
  registerInhousePlanningRoutes(fakeApp as any, dependencies);

  async function invoke(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    clientId: string,
    authenticated = true,
    query: Record<string, string> = {},
  ) {
    const routeHandlers = handlers.get(`${method} ${path}`);
    if (!routeHandlers) throw new Error(`route was not registered: ${method} ${path}`);
    let statusCode = 200;
    let responseBody: unknown;
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
      clientId,
      session: authenticated ? { clientId, userId: `user-${clientId}` } : {},
      body,
      query,
    };
    let index = 0;
    const next = async () => {
      const handler = routeHandlers[index++];
      if (handler) await handler(req, response, next);
    };
    await next();
    return { statusCode, body: responseBody as any };
  }

  return { invoke };
}

async function cleanup() {
  await pool.query(
    `DELETE FROM inhouse_annual_report_runs WHERE client_id IN ($1, $2)`,
    [CLIENT, OTHER_CLIENT],
  );
  await pool.query(`DELETE FROM locations WHERE client_id IN ($1, $2)`, [CLIENT, OTHER_CLIENT]);
  await pool.query(`DELETE FROM clients WHERE id IN ($1, $2)`, [CLIENT, OTHER_CLIENT]);
}

async function setupFixture() {
  await pool.query(`INSERT INTO clients (id, name) VALUES ($1, $2), ($3, $4)`, [
    CLIENT,
    "In-house annual report test",
    OTHER_CLIENT,
    "Other in-house annual report tenant",
  ]);
  const locations = [];
  for (const [clientId, name] of [
    [CLIENT, "Annual Report Campus A"],
    [CLIENT, "Annual Report Campus B"],
    [OTHER_CLIENT, "Other Tenant Campus"],
  ]) {
    locations.push(await pool.query<{ id: string }>(
      `INSERT INTO locations (client_id, name) VALUES ($1, $2) RETURNING id`,
      [clientId, name],
    ));
  }
  return {
    campusA: locations[0].rows[0].id,
    campusB: locations[1].rows[0].id,
    otherCampus: locations[2].rows[0].id,
  };
}

async function readReport(clientId: string, scopeKey: string) {
  const result = await pool.query<{
    location_id: string;
    scope_key: string;
    service_lines: string[];
    plans: any;
    tier_grid: any;
    generated_at: Date;
  }>(
    `SELECT location_id, scope_key, service_lines, plans, tier_grid, generated_at
       FROM inhouse_annual_report_runs
      WHERE client_id = $1 AND scope_key = $2`,
    [clientId, scopeKey],
  );
  return result.rows[0] ?? null;
}

async function assertEndpointContract() {
  const { campusA, campusB, otherCampus } = await setupFixture();
  const calls: any[] = [];
  let calculatorRun = 0;
  let generationFinished: Promise<unknown> | null = null;
  let generationStartedResolve: (() => void) | null = null;
  const generationStarted = new Promise<void>((resolve) => {
    generationStartedResolve = resolve;
  });
  const expectedLines = [{ serviceLine: SERVICE_LINE, assumptions, tierPolicy }];

  const harness = makeRouteHarness({
    calculatePlanTiersBatch: async (input: any) => {
      input.__testRun = ++calculatorRun;
      calls.push(input);
      return makeTierResult(input);
    },
    generateCampusAnnualReports: (options: any) => {
      generationStartedResolve?.();
      generationFinished = generateCampusAnnualReports(options);
      return generationFinished;
    },
  });

  const calculate = await harness.invoke(
    "POST",
    "/api/inhouse-planning/calculate-tiers-batch",
    { locationId: null, lines: expectedLines },
    CLIENT,
  );
  assert.equal(calculate.statusCode, 200, "authenticated portfolio calculation succeeds");
  await generationStarted;
  assert.ok(generationFinished, "portfolio calculation starts the campus report fan-out");
  await generationFinished;

  const campusCalls = calls.filter((input) => input.locationId);
  assert.deepEqual(
    new Set(campusCalls.map((input) => input.locationId)),
    new Set([campusA, campusB]),
    "portfolio fan-out calculates only campuses owned by the authenticated tenant",
  );
  for (const input of campusCalls) {
    assert.deepEqual(input.lines, expectedLines, "each campus receives portfolio assumptions and tier policy");
  }

  const firstA = await readReport(CLIENT, SCOPE_KEY(campusA));
  const firstB = await readReport(CLIENT, SCOPE_KEY(campusB));
  assert.ok(firstA && firstB, "portfolio calculation creates separate campus reports");
  assert.equal(firstA?.location_id, campusA);
  assert.equal(firstB?.location_id, campusB);
  assert.deepEqual(firstA?.tier_grid.inputSnapshot, expectedLines, "campus report stores the portfolio input snapshot");
  assert.equal(firstA?.plans?.[0]?.plan?.scope?.locationId, campusA, "campus report uses campus-specific plan data");
  const firstCampusBRun = firstB?.plans?.[0]?.plan?.summary?.testRun;

  // A report from a newer run already exists. The next fan-out is deliberately
  // older than it, so its conflict update must leave the newer snapshot intact.
  const newerAt = new Date(Date.now() + 60_000);
  const newerTierGrid = {
    marker: "newer-run",
    inputSnapshot: expectedLines,
  };
  await pool.query(
    `UPDATE inhouse_annual_report_runs
        SET generated_at = $1, tier_grid = $2
      WHERE client_id = $3 AND scope_key = $4`,
    [newerAt, JSON.stringify(newerTierGrid), CLIENT, SCOPE_KEY(campusA)],
  );

  generationFinished = null;
  generationStartedResolve = null;
  const secondGenerationStarted = new Promise<void>((resolve) => {
    generationStartedResolve = resolve;
  });
  const secondCalculate = await harness.invoke(
    "POST",
    "/api/inhouse-planning/calculate-tiers-batch",
    { locationId: null, lines: expectedLines },
    CLIENT,
  );
  assert.equal(secondCalculate.statusCode, 200);
  await secondGenerationStarted;
  assert.ok(generationFinished);
  await generationFinished;
  const preservedA = await readReport(CLIENT, SCOPE_KEY(campusA));
  assert.equal(preservedA?.tier_grid?.marker, "newer-run", "an older background run cannot overwrite a newer report");
  const updatedB = await readReport(CLIENT, SCOPE_KEY(campusB));
  assert.ok(
    (updatedB?.plans?.[0]?.plan?.summary?.testRun ?? 0) > (firstCampusBRun ?? 0),
    "a later portfolio calculation upserts the campus report that is not stale",
  );

  const campusReport = await harness.invoke(
    "GET",
    "/api/inhouse-planning/annual-report-runs/latest",
    undefined,
    CLIENT,
    true,
    { scopeKey: SCOPE_KEY(campusB) },
  );
  assert.equal(campusReport.statusCode, 200);
  assert.equal(campusReport.body.report.locationId, campusB, "campus filter restores only the matching campus report");
  assert.deepEqual(campusReport.body.report.serviceLines, [SERVICE_LINE]);

  const wrongServiceLine = await harness.invoke(
    "GET",
    "/api/inhouse-planning/annual-report-runs/latest",
    undefined,
    CLIENT,
    true,
    { scopeKey: `${campusB}|SL` },
  );
  assert.equal(wrongServiceLine.statusCode, 200);
  assert.equal(wrongServiceLine.body.report, null, "campus filter does not restore another service-line scope");

  const otherTenant = await harness.invoke(
    "GET",
    "/api/inhouse-planning/annual-report-runs/latest",
    undefined,
    OTHER_CLIENT,
    true,
    { scopeKey: SCOPE_KEY(campusA) },
  );
  assert.equal(otherTenant.statusCode, 200);
  assert.equal(otherTenant.body.report, null, "tenant scoping prevents cross-tenant report reopening");

  const anonymous = await harness.invoke(
    "GET",
    "/api/inhouse-planning/annual-report-runs/latest",
    undefined,
    CLIENT,
    false,
    { scopeKey: SCOPE_KEY(campusB) },
  );
  assert.equal(anonymous.statusCode, 401, "annual report reopening remains authenticated");

  // Keep the fixture honest: a similarly named campus in another tenant was
  // never included in the portfolio calculation.
  assert.equal(calls.some((input) => input.locationId === otherCampus), false);
}

async function main() {
  try {
    await assertWorkerPoolContract();
    await cleanup();
    await assertEndpointContract();
    console.log("In-house annual report generation tests: passed");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});