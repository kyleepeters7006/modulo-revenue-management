/**
 * Browser regression coverage for saved in-house plans during scope changes.
 *
 * The first annual-report response is deliberately held while the operator
 * changes both filters. This is intentionally browser-level coverage: the
 * result can arrive after React has switched query keys, and a stale response
 * must not repaint the old campus or service lines.
 *
 * Run with:
 *   npx playwright test tests/e2e/inhouse-scatter-scope-switch.spec.ts
 */

import { expect, Page, Route, test } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5000";
const IDENTITY_KEY = "tenant-alpha::user-alpha";
const STORAGE_KEY = "inhouse-rate-planning:calculated-plans:v18";

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

function plan(locationId: string | null, location: string, serviceLine: string, increase: number) {
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
      locationId,
      location,
      serviceLine,
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
    requiredWeightedAvgIncreasePct: increase,
    quarters,
    monthlyRateProjection: [],
    bindingQuarterLabel: "Q1 2026",
    summary: {
      residentCount: 1,
      residentsReceivingIncrease: 1,
      residentsAtMin: 0,
      residentsAtMax: 0,
      residentsBlockedByStreet: 0,
      weightedAvgIncreasePct: increase,
      minIncreasePct: increase,
      maxIncreasePct: increase,
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

function tierLine(serviceLine: string, currentPlan: ReturnType<typeof plan>, occupancyPct = 91) {
  return {
    serviceLine,
    occupancyPct,
    occupancyMonth: "2026-08",
    occupancySource: "occupancy_history",
    currentTier: "target",
    currentPlan,
    cells: [],
    warnings: [],
  };
}

function storedBundle(
  entries: Array<{ sl: string; plan: ReturnType<typeof plan> }>,
  scopeKey = "__all__|AL,HC",
) {
  return {
    plans: entries,
    lastRunAt: "2026-09-01T12:00:00.000Z",
    detailsOmitted: true,
    inputsKey: "fixture-inputs",
    inputSnapshot: [],
    tierGrid: {
      lines: entries.map(({ sl, plan: currentPlan }) => tierLine(sl, currentPlan)),
      skipped: [],
      identityKey: IDENTITY_KEY,
      planScopeKey: "fixture-scope",
      scopeKey,
      inputsKey: "fixture-inputs",
      inputSnapshot: [],
    },
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function reportFor(
  locationId: string | null,
  location: string,
  scopeServiceLines: string[],
  planServiceLines = scopeServiceLines,
) {
  const plans = planServiceLines.map((sl, index) => ({
    sl,
    plan: plan(locationId, location, sl, index === 0 ? 4 : 5),
  }));
  return {
    report: {
      id: `report-${locationId ?? "portfolio"}-${scopeServiceLines.join("-")}`,
      generatedAt: "2026-09-02T12:00:00.000Z",
      scopeKey: `${locationId ?? "all"}|${scopeServiceLines.join(",")}`,
      locationId,
      plans,
      tierGrid: {
        lines: plans.map(({ sl, plan: currentPlan }) => tierLine(sl, currentPlan)),
        skipped: [],
        scopeKey: `${locationId ?? "all"}|${scopeServiceLines.join(",")}`,
        inputsKey: "fixture-inputs",
        inputSnapshot: [],
      },
    },
  };
}

async function stubPlanningApis(
  page: Page,
  delayedScope: string,
  delayedResponse: unknown,
) {
  const pending: string[] = [];
  let releaseDelayed: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    releaseDelayed = resolve;
  });

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
      locations: [
        { id: "campus-a", name: "Campus A" },
        { id: "campus-b", name: "Campus B" },
      ],
    }),
  );
  await page.route("**/api/inhouse-planning/assumptions-batch**", (route) =>
    json(route, {
      policies: Object.fromEntries(
        ["AL", "HC"].map((sl) => [
          sl,
          { assumptions, scopeLevel: "default", tierPolicyStored: true, tierPolicy },
        ]),
      ),
    }),
  );
  await page.route("**/api/inhouse-planning/assumptions**", (route) =>
    json(route, { assumptions, scopeLevel: "default" }),
  );
  await page.route("**/api/inhouse-planning/historical-turnover**", (route) =>
    json(route, { windowStart: null, windowEnd: null, monthsInWindow: 0, byServiceLine: [] }),
  );
  await page.route("**/api/inhouse-planning/occupancy-by-campus", (route) =>
    json(route, {
      readings: [
        {
          locationId: "campus-a",
          location: "Campus A",
          serviceLine: "AL",
          occupancyPct: 91,
          month: "2026-08",
          source: "occupancy_history",
        },
        {
          locationId: "campus-b",
          location: "Campus B",
          serviceLine: "HC",
          occupancyPct: 92,
          month: "2026-08",
          source: "occupancy_history",
        },
      ],
    }),
  );
  await page.route("**/api/inhouse-planning/plans**", (route) =>
    json(route, { plans: [] }),
  );
  await page.route("**/api/inhouse-planning/annual-report-runs/latest**", async (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("scopeKey") ?? "";
    pending.push(scope);
    if (scope === delayedScope) {
      await delayed;
      return json(route, delayedResponse);
    }
    const [locationId, selectedLines = ""] = scope.split("|");
    const lines = selectedLines ? selectedLines.split(",") : [];
    return json(
      route,
      reportFor(
        locationId === "all" ? null : locationId,
        locationId === "campus-b" ? "Campus B" : "Campus A",
        lines,
      ),
    );
  });
  await page.route("**/api/inhouse-planning/annual-report-runs", (route) =>
    json(route, { report: { id: "saved", scopeKey: "fixture" } }),
  );

  return {
    pending,
    releaseDelayed: () => releaseDelayed?.(),
  };
}

async function seedStorage(page: Page, value: unknown, scopeKey: string) {
  await page.addInitScript(
    ({ storageKey, identityKey, scopeKey: recordScopeKey, value: stored }) => {
      Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
      const key = `${identityKey}::${recordScopeKey}`;
      window.localStorage.setItem(storageKey, JSON.stringify({ [key]: stored }));
    },
    { storageKey: STORAGE_KEY, identityKey: IDENTITY_KEY, scopeKey, value },
  );
}

async function openScope(page: Page) {
  await page.getByTestId("button-toggle-inhouse-scope").click();
}

async function setServiceLine(page: Page, current: string, next: string) {
  const scope = page.locator("#inhouse-scope-content");
  // Add the replacement first because the picker intentionally prevents an
  // empty service-line selection.
  await page.getByTestId("select-service-line").click();
  await page
    .locator("label")
    .filter({ hasText: new RegExp(`^${next}$`) })
    .getByRole("checkbox")
    .click();
  await page.keyboard.press("Escape");
  // The selected-line badge has a dedicated remove button and avoids relying
  // on Radix's label-to-checkbox click delegation in a portal.
  await scope.getByRole("button", { name: "×" }).first().click();
}

test.describe("In-house scatter scope restoration", () => {
  test("drops delayed previous-campus results and clears the line highlight", async ({ page }) => {
    const initialPlans = storedBundle([
      { sl: "AL", plan: plan("campus-a", "Campus A", "AL", 4) },
    ], "campus-a|AL");
    await seedStorage(page, initialPlans, "campus-a::AL");
    const planning = await stubPlanningApis(
      page,
      "campus-a|AL",
      reportFor("campus-a", "Campus A", ["AL"]),
    );

    await page.goto(`${BASE_URL}/inhouse-increases?locationId=campus-a&serviceLine=AL`);
    await expect.poll(() => planning.pending).toContain("campus-a|AL");
    await expect(page.getByTestId("card-inhouse-scatterplots")).toBeVisible();
    await page.getByTestId("button-toggle-inhouse-scatterplots").click();

    const initialAlLegend = page.getByTestId("card-inhouse-scatterplots").getByRole("button", { name: "AL" });
    await initialAlLegend.click();
    await expect(initialAlLegend).toHaveAttribute("aria-pressed", "true");

    await openScope(page);
    await page.getByTestId("select-campus").click();
    await page.getByRole("option", { name: "Campus B" }).click();
    await setServiceLine(page, "AL", "HC");

    // Release the response captured for Campus A only after both visible
    // filters have moved. A stale implementation would restore it here.
    planning.releaseDelayed();
    await expect(page.getByTestId("card-inhouse-scatterplots")).toBeVisible();
    await page.getByTestId("button-toggle-inhouse-scatterplots").click();
    const scatter = page.getByTestId("card-inhouse-scatterplots");
    await expect(scatter).toContainText("HC");
    await expect(scatter.getByRole("button", { name: "AL" })).toHaveCount(0);
    await expect(scatter.getByRole("button", { name: "HC" })).toHaveAttribute("aria-pressed", "false");

    // Hover a plotted point so the tooltip proves the point is Campus B, not
    // the delayed Campus A result that arrived after the scope switch.
    const point = scatter.locator(".recharts-scatter-symbol").first();
    await expect(point).toBeVisible();
    await point.hover();
    await expect(scatter).toContainText("Campus B");
    await expect(scatter).not.toContainText("Campus A");
  });

  test("renders portfolio results as aggregate service-line points", async ({ page }) => {
    const portfolioPlans = storedBundle([
      { sl: "AL", plan: plan(null, "All campuses", "AL", 4) },
      { sl: "HC", plan: plan(null, "All campuses", "HC", 5) },
    ], "all|AL,AL/MC,HC,HC/MC,SL,VIL");
    await seedStorage(page, portfolioPlans, "__all__::AL,AL/MC,HC,HC/MC,SL,VIL");
    const planning = await stubPlanningApis(
      page,
      "all|AL,AL/MC,HC,HC/MC,SL,VIL",
      reportFor(null, "All campuses", ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"], ["AL", "HC"]),
    );

    await page.goto(`${BASE_URL}/inhouse-increases`);
    await expect.poll(() => planning.pending).toContain("all|AL,AL/MC,HC,HC/MC,SL,VIL");
    planning.releaseDelayed();
    await expect(page.getByTestId("card-inhouse-scatterplots")).toBeVisible();
    await page.getByTestId("button-toggle-inhouse-scatterplots").click();
    const scatter = page.getByTestId("card-inhouse-scatterplots");
    await expect(scatter).toContainText("Each dot is a portfolio service-line calculation");
    await expect(scatter.getByRole("button", { name: "AL" })).toBeVisible();
    await expect(scatter.getByRole("button", { name: "HC" })).toBeVisible();

    const points = scatter.locator(".recharts-scatter-symbol");
    await expect(points).toHaveCount(4);
    await points.first().hover();
    await expect(scatter).toContainText("All campuses");
    await expect(scatter).not.toContainText("Campus A");
    await expect(scatter).not.toContainText("Campus B");
  });
});