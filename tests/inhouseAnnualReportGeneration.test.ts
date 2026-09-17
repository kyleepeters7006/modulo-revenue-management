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
import ExcelJS from "exceljs";
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
    patch(path: string, ...routeHandlers: RouteHandler[]) {
      handlers.set(`PATCH ${path}`, routeHandlers);
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
    params: Record<string, string> = {},
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
      end(value?: unknown) {
        responseBody = value;
        return response;
      },
    };
    const req = {
      clientId,
      session: authenticated ? { clientId, userId: `user-${clientId}` } : {},
      body,
      query,
      params,
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
  await pool.query(
    `DELETE FROM inhouse_plan_detail_snapshots WHERE client_id IN ($1, $2)`,
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
      `INSERT INTO locations (client_id, name, division) VALUES ($1, $2, $3) RETURNING id`,
      [clientId, name, clientId === CLIENT ? "Central South Indiana" : "Other Division"],
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

  const division = "Central South Indiana";
  const divisionPlan = (locationId: string, location: string, residents: number, increaseDollars: number) => ({
    scope: {
      clientId: CLIENT,
      locationId,
      location,
      division,
      serviceLine: SERVICE_LINE,
      sourceMonth: "2026-12",
    },
    assumptions,
    feasible: true,
    rateBasis: "monthly",
    currentStreetRateMonthly: 5000,
    recommendedStreetRateMonthly: 5100,
    streetIncreasePct: 2,
    streetIncreaseDollarsMonthly: residents * 100,
    currentStreetRateDisplay: 5000,
    recommendedStreetRateDisplay: 5100,
    requiredWeightedAvgIncreasePct: 6,
    quarters: [{
      year: 2027,
      quarter: 1,
      label: "Q1 2027",
      priorYear: {
        label: "Q1 2026",
        year: 2026,
        quarter: 1,
        realizedRateMonthly: 5000,
        basis: "actual",
        monthsAvailable: 3,
        monthsExpected: 3,
      },
      requiredRateMonthly: 5300,
      projectedRateMonthly: 5300,
      yoyGrowthPct: 6,
      passes: true,
      shortfallPct: 0,
      isBinding: false,
    }],
    summary: {
      residentCount: residents,
      residentsReceivingIncrease: residents,
      residentsAtMin: 0,
      residentsAtMax: 0,
      residentsBlockedByStreet: 0,
      weightedAvgIncreasePct: 6,
      minIncreasePct: 6,
      maxIncreasePct: 6,
      totalMonthlyIncreaseDollars: increaseDollars,
      totalAnnualIncreaseDollars: increaseDollars * 12,
      currentAvgInhouseRateMonthly: 5000,
      newAvgInhouseRateMonthly: 5000 + increaseDollars / residents,
    },
    residents: [],
    warnings: [],
    increaseDistribution: [{ label: "6.0%", count: residents }],
    residentIncreaseDistribution: [{ label: "6.0%", count: residents }],
    targetDeviationDiagnostic: null,
  });
  const divisionTierGrid = (plan: any) => ({
    lines: [{
      serviceLine: SERVICE_LINE,
      occupancyPct: 90,
      occupancyMonth: "2026-12",
      occupancySource: "occupancy_history",
      currentTier: "target",
      cells: [{
        serviceLine: SERVICE_LINE,
        tier: "target",
        rangeLabel: "88–94%",
        isCurrent: true,
        inhouseIncreasePct: 6,
        streetIncreasePct: 2,
        feasible: true,
      }],
      warnings: [],
      currentPlan: plan,
    }],
    skipped: [],
    scopeKey: `${division}|all|${SERVICE_LINE}`,
    inputSnapshot: [],
  });
  const generatedAt = new Date();
  await pool.query(
    `INSERT INTO inhouse_annual_report_runs
      (client_id, scope_key, location_id, service_lines, plans, tier_grid, generated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7),
      ($1, $8, $9, $4, $10, $11, $7)`,
    [
      CLIENT,
      `${division}|${campusA}|${SERVICE_LINE}`,
      campusA,
      JSON.stringify([SERVICE_LINE]),
      JSON.stringify([{ sl: SERVICE_LINE, plan: divisionPlan(campusA, "Annual Report Campus A", 2, 200) }]),
      JSON.stringify(divisionTierGrid(divisionPlan(campusA, "Annual Report Campus A", 2, 200))),
      generatedAt,
      `${division}|${campusB}|${SERVICE_LINE}`,
      campusB,
      JSON.stringify([{ sl: SERVICE_LINE, plan: divisionPlan(campusB, "Annual Report Campus B", 3, 450) }]),
      JSON.stringify(divisionTierGrid(divisionPlan(campusB, "Annual Report Campus B", 3, 450))),
    ],
  );
  const divisionRollup = await harness.invoke(
    "GET",
    "/api/inhouse-planning/division-rollup/latest",
    undefined,
    CLIENT,
    true,
    { division, scopeKey: `${division}|all|${SERVICE_LINE}` },
  );
  assert.equal(divisionRollup.statusCode, 200);
  assert.equal(divisionRollup.body.report.locationId, null, "division rollup remains portfolio-shaped");
  assert.equal(divisionRollup.body.report.plans[0].sl, SERVICE_LINE);
  assert.equal(divisionRollup.body.report.plans[0].plan.summary.residentCount, 5);
  assert.equal(
    divisionRollup.body.report.plans[0].plan.summary.totalMonthlyIncreaseDollars,
    650,
    "division rollup sums campus increase dollars",
  );
  assert.equal(divisionRollup.body.report.tierGrid.lines[0].serviceLine, SERVICE_LINE);

  // A later automatic generation can finish only one campus. The rollup must
  // not pair that newer campus with Campus B's older snapshot.
  const newerGeneration = new Date(generatedAt.getTime() + 60_000);
  await pool.query(
    `INSERT INTO inhouse_annual_report_runs
      (client_id, scope_key, location_id, service_lines, plans, tier_grid, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_id, scope_key) DO UPDATE SET
       location_id = EXCLUDED.location_id,
       service_lines = EXCLUDED.service_lines,
       plans = EXCLUDED.plans,
       tier_grid = EXCLUDED.tier_grid,
       generated_at = EXCLUDED.generated_at`,
    [
      CLIENT,
      `${division}|${campusA}|${SERVICE_LINE}`,
      campusA,
      JSON.stringify([SERVICE_LINE]),
      JSON.stringify([{ sl: SERVICE_LINE, plan: divisionPlan(campusA, "Annual Report Campus A", 9, 900) }]),
      JSON.stringify(divisionTierGrid(divisionPlan(campusA, "Annual Report Campus A", 9, 900))),
      newerGeneration,
    ],
  );
  const incompleteRollup = await harness.invoke(
    "GET",
    "/api/inhouse-planning/division-rollup/latest",
    undefined,
    CLIENT,
    true,
    { division, scopeKey: `${division}|all|${SERVICE_LINE}` },
  );
  assert.equal(incompleteRollup.statusCode, 200);
  assert.equal(incompleteRollup.body.report.status, "incomplete_generation");
  assert.equal(incompleteRollup.body.report.generationStatus.state, "incomplete");
  assert.equal(incompleteRollup.body.report.generationStatus.expectedCampusCount, 2);
  assert.equal(incompleteRollup.body.report.generationStatus.includedCampusCount, 1);
  assert.deepEqual(
    incompleteRollup.body.report.generationStatus.missingCampuses,
    [{
      locationId: campusB,
      locationName: "Annual Report Campus B",
      serviceLines: [SERVICE_LINE],
    }],
  );
  assert.equal(incompleteRollup.body.report.plans.length, 0, "partial service-line totals stay unavailable");
  assert.equal(incompleteRollup.body.report.tierGrid.skipped[0].sl, SERVICE_LINE);

  const auditScopeKey = `legacy-audit-${SUFFIX}|${SERVICE_LINE}`;
  const reportGeneratedAt = new Date("2026-09-01T12:00:00.000Z");
  const expectedInputs = [{ serviceLine: SERVICE_LINE, assumptions, tierPolicy }];
  const detailPlan = makePlan(
    {
      clientId: CLIENT,
      locationId: campusA,
      location: "Annual Report Campus A",
      __testRun: 99,
    },
    expectedInputs[0],
  );
  detailPlan.residents = [{
    key: "legacy-resident",
    location: "Annual Report Campus A",
    roomNumber: "101",
    roomType: "Studio",
    careLevel: SERVICE_LINE,
    payorType: "Private Pay",
    moveInDate: "2025-01-01",
    isCompanionBed: false,
    rateProduct: "base",
    streetRateSource: "unit",
    currentRateMonthly: 5000,
    streetRateMonthly: 5500,
    increasePct: 4,
    increaseDollarsMonthly: 200,
    newRateMonthly: 5200,
    newRateDisplay: 5200,
    newGapToStreetPct: 5,
    constraint: "none",
    weight: 1,
  }];
  const compactPlan = { ...detailPlan, residents: [] };
  const insertedReport = await pool.query<{ id: string }>(
    `INSERT INTO inhouse_annual_report_runs
      (client_id, scope_key, location_id, service_lines, plans, tier_grid, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      CLIENT,
      auditScopeKey,
      campusA,
      JSON.stringify([SERVICE_LINE]),
      JSON.stringify([{ sl: SERVICE_LINE, plan: compactPlan }]),
      JSON.stringify({ inputSnapshot: expectedInputs, lines: [] }),
      reportGeneratedAt,
    ],
  );
  const auditReportId = insertedReport.rows[0].id;
  await pool.query(
    `INSERT INTO inhouse_plan_detail_snapshots
      (client_id, scope_key, plans, input_snapshot, generated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      CLIENT,
      auditScopeKey,
      JSON.stringify([{ sl: SERVICE_LINE, plan: detailPlan }]),
      JSON.stringify(expectedInputs),
      new Date(reportGeneratedAt.getTime() + 60_000),
    ],
  );

  const excelRoute = "/api/inhouse-planning/annual-report-runs/:id/excel";
  const matchingExport = await harness.invoke(
    "GET",
    excelRoute,
    undefined,
    CLIENT,
    true,
    {},
    { id: auditReportId },
  );
  assert.equal(matchingExport.statusCode, 200, "a newer detail snapshot with exact inputs can build the audit export");
  assert.equal(Buffer.isBuffer(matchingExport.body), true, "matching audit export returns an Excel workbook");
  const auditWorkbook = new ExcelJS.Workbook();
  await auditWorkbook.xlsx.load(matchingExport.body);
  assert.equal(
    auditWorkbook.getWorksheet("Resident detail")?.getCell("B5").value,
    "Annual Report Campus A",
    "the audit workbook retains resident detail from the matching newer snapshot",
  );

  const mismatchedInputs = [{
    serviceLine: SERVICE_LINE,
    assumptions: { ...assumptions, rateGrowthTargetPct: 7 },
    tierPolicy,
  }];
  const saveMismatchScopeKey = `legacy-save-mismatch-${SUFFIX}|${SERVICE_LINE}`;
  await pool.query(
    `INSERT INTO inhouse_plan_detail_snapshots
      (client_id, scope_key, plans, input_snapshot, generated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      CLIENT,
      saveMismatchScopeKey,
      JSON.stringify([{ sl: SERVICE_LINE, plan: detailPlan }]),
      JSON.stringify(mismatchedInputs),
      new Date(reportGeneratedAt.getTime() + 120_000),
    ],
  );
  const saveMismatch = await harness.invoke(
    "POST",
    "/api/inhouse-planning/annual-report-runs",
    {
      scopeKey: saveMismatchScopeKey,
      locationId: campusA,
      serviceLines: [SERVICE_LINE],
      plans: [{ sl: SERVICE_LINE, plan: compactPlan }],
      tierGrid: { inputSnapshot: expectedInputs, lines: [] },
    },
    CLIENT,
  );
  assert.equal(saveMismatch.statusCode, 200, "saving a report still succeeds when optional detail is from another generation");
  const savedMismatchReport = await pool.query<{
    id: string;
    detail_generated_at: Date | null;
  }>(
    `SELECT id, detail_generated_at
       FROM inhouse_annual_report_runs
      WHERE client_id = $1 AND scope_key = $2`,
    [CLIENT, saveMismatchScopeKey],
  );
  assert.equal(savedMismatchReport.rows[0]?.detail_generated_at, null, "mismatched source detail is not linked to the report");
  const copiedMismatchDetail = await pool.query(
    `SELECT 1
       FROM inhouse_plan_detail_snapshots
      WHERE client_id = $1 AND scope_key = $2`,
    [CLIENT, `annual-report:${savedMismatchReport.rows[0]?.id}`],
  );
  assert.equal(copiedMismatchDetail.rowCount, 0, "mismatched source detail is not copied into the immutable report snapshot");

  await pool.query(
    `INSERT INTO inhouse_plan_detail_snapshots
      (client_id, scope_key, plans, input_snapshot, generated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      CLIENT,
      `annual-report:${auditReportId}`,
      JSON.stringify([{ sl: SERVICE_LINE, plan: detailPlan }]),
      JSON.stringify(expectedInputs),
      new Date(reportGeneratedAt.getTime() + 180_000),
    ],
  );
  const immutableExport = await harness.invoke(
    "GET",
    excelRoute,
    undefined,
    CLIENT,
    true,
    {},
    { id: auditReportId },
  );
  assert.equal(immutableExport.statusCode, 200, "a matching immutable detail copy can build the audit export");

  await pool.query(
    `UPDATE inhouse_plan_detail_snapshots
        SET input_snapshot = $1
      WHERE client_id = $2 AND scope_key = $3`,
    [JSON.stringify(mismatchedInputs), CLIENT, `annual-report:${auditReportId}`],
  );
  await pool.query(
    `DELETE FROM inhouse_plan_detail_snapshots
      WHERE client_id = $1 AND scope_key = $2`,
    [CLIENT, auditScopeKey],
  );
  const mismatchedExport = await harness.invoke(
    "GET",
    excelRoute,
    undefined,
    CLIENT,
    true,
    {},
    { id: auditReportId },
  );
  assert.equal(mismatchedExport.statusCode, 422, "an unrelated newer detail snapshot is rejected");
  assert.match(
    mismatchedExport.body?.error ?? "",
    /Resident detail is unavailable/,
    "the mismatch explains how to restore the missing immutable detail",
  );

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