/**
 * Regression coverage for Reference Data navigation after submitting an
 * in-house increase plan.
 *
 * The plan-history refetch is intentionally held after the apply response.
 * The Reference Data button must remain usable during that refresh instead of
 * briefly becoming disabled because the query has no data.
 *
 * Run with:
 *   npx playwright test tests/e2e/inhouse-reference-data-navigation.spec.ts
 */

import { expect, Page, Route, test } from "@playwright/test";
import { planningInputSnapshotKey } from "../../shared/inhousePlanning";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5000";
const IDENTITY_KEY = "tenant-alpha::user-alpha";
const STORAGE_KEY = "inhouse-rate-planning:calculated-plans:v18";
const SCOPE_KEY = "__all__::AL";

const assumptions = {
  rateGrowthTargetPct: 6,
  measurementMode: "quarterly_yoy",
  streetRateEffectiveDate: "2026-01-01",
  inhouseEffectiveDate: "2026-01-01",
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

const tierPolicy = {
  lowCutoffPct: 88,
  highCutoffPct: 95,
  tiers: {
    low: {
      minInhouseIncreasePct: 0,
      maxInhouseIncreasePct: 5,
      minStreetIncreasePct: 0,
      maxStreetIncreasePct: 8,
      maxYoYStreetIncreasePct: 8,
      desiredVarianceToTopCompetitorPct: -3,
      equalizationStrength: "medium",
    },
    target: {
      minInhouseIncreasePct: 0,
      maxInhouseIncreasePct: 8,
      minStreetIncreasePct: 0,
      maxStreetIncreasePct: 12,
      maxYoYStreetIncreasePct: 12,
      desiredVarianceToTopCompetitorPct: 0,
      equalizationStrength: "medium",
    },
    high: {
      minInhouseIncreasePct: 2,
      maxInhouseIncreasePct: 10,
      minStreetIncreasePct: 2,
      maxStreetIncreasePct: 15,
      maxYoYStreetIncreasePct: 15,
      desiredVarianceToTopCompetitorPct: 3,
      equalizationStrength: "medium",
    },
  },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function plan() {
  const quarters = [1, 2, 3, 4].map((quarter) => ({
    year: 2026,
    quarter,
    label: `Q${quarter} 2026`,
    passes: true,
    requiredRateMonthly: 5_300,
    projectedRateMonthly: 5_300,
    yoyGrowthPct: 6,
    shortfallPct: 0,
    isBinding: quarter === 1,
    priorYear: {
      year: 2025,
      quarter,
      label: `Q${quarter} 2025`,
      realizedRateMonthly: 5_000,
      basis: "actual",
      monthsAvailable: 3,
      monthsExpected: 3,
      residentDays: 100,
    },
  }));

  return {
    scope: {
      clientId: "tenant-alpha",
      locationId: null,
      location: "All campuses",
      serviceLine: "AL",
      sourceMonth: "2026-08",
    },
    assumptions,
    feasible: true,
    rateBasis: "monthly",
    currentStreetRateMonthly: 5_000,
    recommendedStreetRateMonthly: 5_250,
    streetIncreasePct: 5,
    streetIncreaseDollarsMonthly: 250,
    currentStreetRateDisplay: 5_000,
    recommendedStreetRateDisplay: 5_250,
    adjustedTopCompetitorRateMonthly: 5_400,
    requiredWeightedAvgIncreasePct: 6,
    quarters,
    monthlyRateProjection: [],
    bindingQuarterLabel: "Q1 2026",
    summary: {
      residentCount: 1,
      residentsReceivingIncrease: 1,
      residentsAtMin: 0,
      residentsAtMax: 0,
      residentsBlockedByStreet: 0,
      weightedAvgIncreasePct: 6,
      minIncreasePct: 6,
      maxIncreasePct: 6,
      totalMonthlyIncreaseDollars: 300,
      totalAnnualIncreaseDollars: 3_600,
      currentAvgInhouseRateMonthly: 5_000,
      newAvgInhouseRateMonthly: 5_300,
    },
    residents: [],
    planningSignals: {},
    infeasibility: null,
    optimizationNote: null,
    explanation: { headline: "Browser fixture" },
    warnings: [],
  };
}

async function seedCalculatedPlan(page: Page) {
  const inputSnapshot = [{ serviceLine: "AL", assumptions, tierPolicy }];
  const currentPlan = plan();
  const storedPlan = { sl: "AL", plan: currentPlan };
  const stored = {
    plans: [storedPlan],
    lastRunAt: "2026-09-01T12:00:00.000Z",
    detailsOmitted: false,
    inputsKey: planningInputSnapshotKey(inputSnapshot),
    inputSnapshot,
    tierGrid: {
      lines: [{
        serviceLine: "AL",
        occupancyPct: 91,
        occupancyMonth: "2026-08",
        occupancySource: "occupancy_history",
        currentTier: "target",
        currentPlan,
        cells: [],
        warnings: [],
      }],
      skipped: [],
      identityKey: IDENTITY_KEY,
      planScopeKey: SCOPE_KEY,
      scopeKey: "campus-a|AL",
      inputsKey: planningInputSnapshotKey(inputSnapshot),
      inputSnapshot,
    },
  };

  await page.addInitScript(
    ({ storageKey, identityKey, scopeKey, value }) => {
      Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ [`${identityKey}::${scopeKey}`]: value }),
      );
    },
    { storageKey: STORAGE_KEY, identityKey: IDENTITY_KEY, scopeKey: SCOPE_KEY, value: stored },
  );
}

async function stubApis(page: Page) {
  let submitted = false;
  let releasePlanHistory: (() => void) | undefined;
  const planHistoryRefresh = new Promise<void>((resolve) => {
    releasePlanHistory = resolve;
  });
  const planHistoryScopes: string[] = [];
  const applyRequests: Array<Record<string, unknown>> = [];

  await page.route("**/api/auth/user", (route) =>
    json(route, {
      isAuthenticated: true,
      authState: "authenticated",
      id: "user-alpha",
      username: "alpha@example.test",
      clientId: "tenant-alpha",
      clientName: "Alpha Health",
    }),
  );
  await page.route("**/api/locations", (route) =>
    json(route, {
      locations: [{ id: "campus-a", name: "Campus A", division: null }],
    }),
  );
  await page.route("**/api/inhouse-planning/assumptions**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/assumptions-batch")) {
      return json(route, {
        policies: {
          AL: {
            assumptions,
            scopeLevel: "location+serviceLine",
            tierPolicyStored: true,
            tierPolicy,
          },
        },
      });
    }
    return json(route, { assumptions, scopeLevel: "location+serviceLine" });
  });
  await page.route("**/api/inhouse-planning/historical-turnover**", (route) =>
    json(route, { windowStart: null, windowEnd: null, monthsInWindow: 0, byServiceLine: [] }),
  );
  await page.route("**/api/inhouse-planning/plan-details/latest**", (route) =>
    json(route, { snapshot: null }),
  );
  await page.route("**/api/inhouse-planning/annual-report-runs/latest**", (route) =>
    json(route, { report: null }),
  );
  await page.route("**/api/inhouse-planning/plans**", async (route) => {
    const url = new URL(route.request().url());
    planHistoryScopes.push(url.searchParams.toString());
    if (submitted) {
      await planHistoryRefresh;
      return json(route, {
        plans: [{
          id: "plan-7",
          version: 7,
          serviceLine: "AL",
          status: "proposed",
          createdAt: "2026-09-16T12:00:00.000Z",
          summary: { weightedAvgIncreasePct: 6 },
          assumptions: { rateGrowthTargetPct: 6 },
          inhouseEffectiveDate: "2026-01-01",
        }],
      });
    }
    return json(route, { plans: [] });
  });
  await page.route("**/api/inhouse-planning/apply", async (route) => {
    applyRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    submitted = true;
    return json(route, { version: 7 });
  });
  await page.route("**/api/reference-data**", (route) =>
    json(route, { rows: [], rules: [], months: [] }),
  );

  return {
    applyRequests,
    planHistoryScopes,
    releasePlanHistory: () => releasePlanHistory?.(),
  };
}

test.describe("In-house Reference Data navigation", () => {
  test("stays enabled during plan-history refresh after submitting a calculated plan", async ({ page }) => {
    await seedCalculatedPlan(page);
    const api = await stubApis(page);
    await page.goto(`${BASE_URL}/inhouse-increases?serviceLine=AL`);

    const submit = page.getByTestId("button-apply-plan");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => api.applyRequests.length).toBe(1);
    expect(api.applyRequests[0]).toMatchObject({ locationId: null, serviceLine: "AL" });

    await expect.poll(() => api.planHistoryScopes.length).toBeGreaterThan(1);
    expect(api.planHistoryScopes[0]).toContain("serviceLine=AL");

    const referenceData = page.getByTestId("view-inhouse-plan-reference-data");
    await expect(referenceData).toBeEnabled();

    api.releasePlanHistory();
    await expect(page.getByText("Proposals submitted", { exact: true })).toBeVisible();
    await referenceData.click();

    await expect(page).toHaveURL(
      /\/pricing-controls\?scrollTo=reference-data&focusGroup=ihCalculated&serviceLine=AL$/,
    );
    await expect(page.getByTestId("reference-data-card")).toBeVisible();
  });
});