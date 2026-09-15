/**
 * Browser regression coverage for saved per-service-line growth targets.
 *
 * The editor loads a multi-line selection from the batch endpoint, writes one
 * row per selected line, and then invalidates/refetches the same scope. Keep
 * AL and HC different so a first-line cache value repainting every row cannot
 * pass this test.
 *
 * Run with:
 *   npx playwright test tests/e2e/inhouse-assumptions-persistence.spec.ts
 */

import { expect, Page, Route, test } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5000";
const TARGET = 6.5;
const CAMPUS_AL_TARGET = 5.75;

const baseAssumptions = {
  rateGrowthTargetPct: 4.25,
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

type Scope = { locationId: string | null; name: string };

function assumptionsFor(
  scope: Scope,
  serviceLine: string,
  saved: Map<string, Record<string, unknown>>,
  seededCampus: Map<string, Record<string, unknown>>,
) {
  const key = `${scope.locationId ?? "all"}:${serviceLine}`;
  const current = saved.get(key);
  if (current) return current;
  const campusSeed = scope.locationId ? seededCampus.get(key) : undefined;
  if (campusSeed) return campusSeed;
  return {
    ...baseAssumptions,
    rateGrowthTargetPct: serviceLine === "HC" ? 7.5 : baseAssumptions.rateGrowthTargetPct,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubPlanningApis(page: Page) {
  const saved = new Map<string, Record<string, unknown>>();
  // Campus A has an explicit AL target, but HC must resolve from its
  // service-line-specific portfolio target. This is the fallback boundary the
  // editor must preserve when only AL is overridden.
  const seededCampus = new Map<string, Record<string, unknown>>([
    [
      "campus-a:AL",
      {
        ...baseAssumptions,
        rateGrowthTargetPct: CAMPUS_AL_TARGET,
      },
    ],
  ]);
  const posts: Array<{ locationId: string | null; serviceLine: string; assumptions: Record<string, unknown> }> = [];
  const batchReads: Array<{
    locationId: string | null;
    serviceLines: string[];
    targets: Record<string, unknown>;
    scopeLevels: Record<string, string>;
  }> = [];

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
  await page.route("**/api/inhouse-planning/assumptions**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith("/assumptions-batch")) {
      const locationId = requestUrl.searchParams.get("locationId");
      const serviceLines = (requestUrl.searchParams.get("serviceLines") ?? "")
        .split(",")
        .filter(Boolean);
      const policies = Object.fromEntries(
        serviceLines.map((serviceLine) => [
          serviceLine,
          {
            assumptions: assumptionsFor(
              { locationId, name: locationId ? "Campus A" : "All campuses" },
              serviceLine,
              saved,
              seededCampus,
            ),
            scopeLevel:
              locationId && (saved.has(`${locationId}:${serviceLine}`) || seededCampus.has(`${locationId}:${serviceLine}`))
                ? "location+serviceLine"
                : "serviceLine",
            tierPolicyStored: true,
            tierPolicy,
          },
        ]),
      );
      batchReads.push({
        locationId,
        serviceLines,
        targets: Object.fromEntries(
          serviceLines.map((serviceLine) => [
            serviceLine,
            (policies[serviceLine] as { assumptions: Record<string, unknown> }).assumptions.rateGrowthTargetPct,
          ]),
        ),
        scopeLevels: Object.fromEntries(
          serviceLines.map((serviceLine) => [
            serviceLine,
            (policies[serviceLine] as { scopeLevel: string }).scopeLevel,
          ]),
        ),
      });
      return json(route, {
        policies,
      });
    }

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        locationId?: string | null;
        serviceLine: string;
        assumptions: Record<string, unknown>;
      };
      const locationId = body.locationId ?? null;
      posts.push({
        locationId,
        serviceLine: body.serviceLine,
        assumptions: body.assumptions,
      });
      saved.set(`${locationId ?? "all"}:${body.serviceLine}`, body.assumptions);
      return json(route, {
        ok: true,
        assumptions: body.assumptions,
        scopeLevel: locationId ? "location+serviceLine" : "serviceLine",
      });
    }

    const locationId = requestUrl.searchParams.get("locationId");
    const serviceLine = requestUrl.searchParams.get("serviceLine") ?? "AL";
    return json(route, {
      assumptions: assumptionsFor(
        { locationId, name: locationId ? "Campus A" : "All campuses" },
        serviceLine,
        saved,
        seededCampus,
      ),
      scopeLevel:
        locationId && (saved.has(`${locationId}:${serviceLine}`) || seededCampus.has(`${locationId}:${serviceLine}`))
          ? "location+serviceLine"
          : "serviceLine",
    });
  });
  await page.route("**/api/inhouse-planning/historical-turnover**", (route) =>
    json(route, { windowStart: null, windowEnd: null, monthsInWindow: 0, byServiceLine: [] }),
  );
  await page.route("**/api/inhouse-planning/annual-report-runs/latest**", (route) =>
    json(route, { report: null }),
  );
  await page.route("**/api/inhouse-planning/plans**", (route) =>
    json(route, { plans: [] }),
  );

  return { posts, batchReads };
}

async function selectSecondServiceLine(page: Page) {
  await page.getByTestId("button-toggle-inhouse-scope").click();
  await page.getByTestId("select-service-line").click();
  await page
    .locator("label")
    .filter({ hasText: /^HC$/ })
    .getByRole("checkbox")
    .check();
  await page.keyboard.press("Escape");
  await page.getByTestId("button-toggle-inhouse-scope").click();
}

async function selectOnlyAL(page: Page) {
  await page.getByTestId("button-toggle-inhouse-scope").click();
  await page.getByTestId("select-service-line").click();
  await page
    .locator("label")
    .filter({ hasText: /^HC$/ })
    .getByRole("checkbox")
    .uncheck();
  await page.keyboard.press("Escape");
  await page.getByTestId("button-toggle-inhouse-scope").click();
}

async function openAssumptions(page: Page) {
  const toggle = page.getByTestId("button-toggle-inhouse-assumptions");
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function selectCampus(page: Page, label: "All campuses" | "Campus A") {
  await page.getByTestId("button-toggle-inhouse-scope").click();
  await page.getByTestId("select-campus").click();
  await page.getByRole("option", { name: label }).click();
  await page.getByTestId("button-toggle-inhouse-scope").click();
}

test.describe("In-house assumptions persistence", () => {
  test("keeps every selected line's acknowledged decimal target after portfolio reload", async ({ page }) => {
    const planning = await stubPlanningApis(page);
    await page.goto(`${BASE_URL}/inhouse-increases?serviceLine=AL`);
    await selectSecondServiceLine(page);
    await openAssumptions(page);

    const alInput = page.getByTestId("input-growth-target-AL");
    const hcInput = page.getByTestId("input-growth-target-HC");
    await expect(alInput).toHaveValue("4.25");
    await expect(hcInput).toHaveValue("7.5");

    await alInput.fill(String(TARGET));
    await alInput.press("Enter");
    await page.getByTestId("button-save-assumptions").click();
    await expect(page.getByText("Assumptions saved")).toBeVisible();

    await expect.poll(() => planning.posts.length).toBe(2);
    expect(Object.fromEntries(planning.posts.map((post) => [post.serviceLine, post.assumptions.rateGrowthTargetPct]))).toEqual({
      AL: TARGET,
      HC: 7.5,
    });
    await expect(alInput).toHaveValue(String(TARGET));
    await expect(hcInput).toHaveValue("7.5");

    await page.reload();
    await selectSecondServiceLine(page);
    await openAssumptions(page);
    await expect(page.getByTestId("input-growth-target-AL")).toHaveValue(String(TARGET));
    await expect(page.getByTestId("input-growth-target-HC")).toHaveValue("7.5");
  });

  test("keeps saved line-specific targets when a line is removed and restored", async ({ page }) => {
    const planning = await stubPlanningApis(page);
    await page.goto(`${BASE_URL}/inhouse-increases?serviceLine=AL`);
    await selectSecondServiceLine(page);
    await openAssumptions(page);

    const alInput = page.getByTestId("input-growth-target-AL");
    const hcInput = page.getByTestId("input-growth-target-HC");
    await alInput.fill(String(TARGET));
    await alInput.press("Enter");
    await page.getByTestId("button-save-assumptions").click();
    await expect(page.getByText("Assumptions saved")).toBeVisible();

    await expect.poll(() => planning.posts.length).toBe(2);
    expect(Object.fromEntries(planning.posts.map((post) => [post.serviceLine, post.assumptions.rateGrowthTargetPct]))).toEqual({
      AL: TARGET,
      HC: 7.5,
    });

    await selectOnlyAL(page);
    await openAssumptions(page);
    await expect(page.getByTestId("input-growth-target")).toHaveValue(String(TARGET));

    await selectSecondServiceLine(page);
    await openAssumptions(page);
    await expect(alInput).toHaveValue(String(TARGET));
    await expect(hcInput).toHaveValue("7.5");
  });

  test("keeps every selected line's acknowledged decimal target after campus reload", async ({ page }) => {
    const planning = await stubPlanningApis(page);
    await page.goto(`${BASE_URL}/inhouse-increases?locationId=campus-a&serviceLine=AL`);
    await openAssumptions(page);

    const alInput = page.getByTestId("input-growth-target-AL");
    await expect(alInput).toHaveValue(String(CAMPUS_AL_TARGET));

    await alInput.fill(String(TARGET));
    await alInput.press("Enter");
    // Saving a single selected line must not create a campus HC row.
    await page.getByTestId("button-save-assumptions").click();
    await expect(page.getByText("Assumptions saved")).toBeVisible();

    await expect.poll(() => planning.posts.length).toBe(1);
    expect(new Set(planning.posts.map((post) => post.locationId))).toEqual(new Set(["campus-a"]));
    expect(Object.fromEntries(planning.posts.map((post) => [post.serviceLine, post.assumptions.rateGrowthTargetPct]))).toEqual({
      AL: TARGET,
    });

    // Add HC only after the AL campus override is persisted. HC must still
    // resolve from its service-line-specific portfolio row.
    await selectSecondServiceLine(page);
    await openAssumptions(page);
    await expect(page.getByTestId("input-growth-target-AL")).toHaveValue(String(TARGET));
    await expect(page.getByTestId("input-growth-target-HC")).toHaveValue("7.5");
    await expect.poll(() =>
      planning.batchReads.some((read) =>
        read.locationId === "campus-a" &&
        read.targets.AL === TARGET &&
        read.targets.HC === 7.5 &&
        read.scopeLevels.AL === "location+serviceLine" &&
        read.scopeLevels.HC === "serviceLine",
      ),
    ).toBe(true);

    // Leave and revisit the portfolio/campus scope boundary before reloading
    // so the next batch read cannot be satisfied by the current editor state.
    await selectCampus(page, "All campuses");
    await selectCampus(page, "Campus A");
    await openAssumptions(page);
    await expect.poll(() =>
      planning.batchReads.some((read) =>
        read.locationId === "campus-a" &&
        read.serviceLines.includes("AL") &&
        read.serviceLines.includes("HC") &&
        read.targets.AL === TARGET &&
        read.targets.HC === 7.5 &&
        read.scopeLevels.AL === "location+serviceLine" &&
        read.scopeLevels.HC === "serviceLine",
      ),
    ).toBe(true);
    await expect(page.getByTestId("input-growth-target-AL")).toHaveValue(String(TARGET));
    await expect(page.getByTestId("input-growth-target-HC")).toHaveValue("7.5");

    await page.reload();
    await selectSecondServiceLine(page);
    await openAssumptions(page);
    await expect(page.getByTestId("input-growth-target-AL")).toHaveValue(String(TARGET));
    await expect(page.getByTestId("input-growth-target-HC")).toHaveValue("7.5");
  });
});