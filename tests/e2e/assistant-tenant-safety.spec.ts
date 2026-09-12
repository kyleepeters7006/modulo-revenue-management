/**
 * Browser regression coverage for the global portfolio assistant.
 *
 * The auth and assistant endpoints are stubbed at the browser boundary so
 * this suite can exercise the real React component without depending on a
 * particular database account, MFA secret, or Claude availability. The
 * assertions still inspect every request the browser sends, including the
 * tenant-scoped auth identity and page context.
 *
 * Run with:
 *   npx playwright test tests/e2e/assistant-tenant-safety.spec.ts
 */

import { expect, Page, Route, test } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5000";

type AuthUser = {
  isAuthenticated: boolean;
  authState: "authenticated" | "anonymous";
  id?: string;
  username?: string;
  clientId: string;
  clientName: string;
  isAdmin?: boolean;
};

const alpha: AuthUser = {
  isAuthenticated: true,
  authState: "authenticated",
  id: "user-alpha",
  username: "alpha@example.test",
  clientId: "tenant-alpha",
  clientName: "Alpha Health",
};

const beta: AuthUser = {
  isAuthenticated: true,
  authState: "authenticated",
  id: "user-beta",
  username: "beta@example.test",
  clientId: "tenant-beta",
  clientName: "Beta Health",
};

const anonymous: AuthUser = {
  isAuthenticated: false,
  authState: "anonymous",
  clientId: "demo",
  clientName: "Demo",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubAuth(page: Page, currentUser: () => AuthUser) {
  await page.route("**/api/auth/user", (route) => json(route, currentUser()));
  await page.route("**/api/auth/logout", async (route) => {
    await json(route, { ok: true });
  });
}

async function openAssistant(page: Page) {
  await expect(page.getByTestId("button-open-assistant")).toBeVisible();
  await page.getByTestId("button-open-assistant").click();
  await expect(page.getByRole("dialog", { name: "Modulo Assistant" })).toBeVisible();
}

async function ask(page: Page, prompt: string) {
  await page.getByLabel("Message Modulo Assistant").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("global assistant browser tenant safety", () => {
  test("is available across routes, keeps context, and renders provenance", async ({ page }) => {
    let currentUser = alpha;
    const requests: Array<{ messages: unknown; pageContext: unknown }> = [];

    await stubAuth(page, () => currentUser);
    await page.route("**/api/assistant/chat", async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await json(route, {
        message: "Alpha portfolio answer",
        model: "claude-opus-4-6",
        sources: [
          { tool: "portfolio_snapshot", label: "Portfolio snapshot", detail: "Alpha Health · current month" },
        ],
      });
    });

    await page.goto(`${BASE_URL}/overview`);
    await openAssistant(page);
    await ask(page, "What needs attention?");

    await expect(page.getByText("Alpha portfolio answer")).toBeVisible();
    await expect(page.getByText("Sources")).toBeVisible();
    await expect(page.getByText("Portfolio snapshot · Alpha Health · current month")).toBeVisible();
    expect(requests[0]?.pageContext).toEqual({ path: "/overview" });

    await page.getByRole("complementary").getByRole("button", { name: "Close assistant" }).click();
    await page.goto(`${BASE_URL}/pricing-algorithm`);
    await openAssistant(page);
    await expect(page.getByText("Alpha portfolio answer")).toBeVisible();
    await ask(page, "Follow up on that answer.");

    await expect(page.getByText("Alpha portfolio answer")).toHaveCount(2);
    expect(requests[1]?.pageContext).toEqual({ path: "/pricing-algorithm" });
    expect(requests[1]?.messages).toEqual([
      { role: "user", content: "What needs attention?" },
      { role: "assistant", content: "Alpha portfolio answer" },
      { role: "user", content: "Follow up on that answer." },
    ]);
  });

  test("clears the drawer on logout and does not expose another tenant's conversation", async ({ page }) => {
    let currentUser = alpha;
    let logoutCount = 0;
    const requests: Array<{ clientId: string; messages: Array<{ role: string; content: string }> }> = [];

    await page.route("**/api/auth/user", (route) => json(route, currentUser));
    await page.route("**/api/auth/logout", async (route) => {
      logoutCount++;
      currentUser = anonymous;
      await json(route, { ok: true });
    });
    await page.route("**/api/assistant/chat", async (route) => {
      const body = route.request().postDataJSON() as {
        messages: Array<{ role: string; content: string }>;
      };
      requests.push({ clientId: currentUser.clientId, messages: body.messages });
      await json(route, {
        message: `${currentUser.clientName} private answer`,
        sources: [{ tool: "locations", label: `${currentUser.clientName} locations` }],
      });
    });

    await page.goto(`${BASE_URL}/overview`);
    await openAssistant(page);
    await ask(page, "Show my private portfolio context.");
    await expect(page.getByText("Alpha Health private answer")).toBeVisible();

    await page.getByRole("complementary").getByRole("button", { name: "Close assistant" }).click();
    await page.getByTestId("link-logout").click();
    await expect(page.getByTestId("button-open-assistant")).toBeHidden();
    expect(logoutCount).toBe(1);

    // Simulate a fresh sign-in as a different tenant in the same browser
    // profile. The previous tenant's sessionStorage entry must not hydrate.
    currentUser = beta;
    await page.reload();
    await openAssistant(page);
    await expect(page.getByText("Alpha Health private answer")).toBeHidden();
    await expect(page.getByText("Beta Health private answer")).toBeHidden();

    await ask(page, "Show my private portfolio context.");
    await expect(page.getByText("Beta Health private answer")).toBeVisible();
    expect(requests).toEqual([
      {
        clientId: "tenant-alpha",
        messages: [{ role: "user", content: "Show my private portfolio context." }],
      },
      {
        clientId: "tenant-beta",
        messages: [{ role: "user", content: "Show my private portfolio context." }],
      },
    ]);
  });

  test("shows rate-limit, timeout, and failed-answer messages with a working retry", async ({ page }) => {
    await stubAuth(page, () => alpha);
    let attempts = 0;
    await page.route("**/api/assistant/chat", async (route) => {
      attempts++;
      if (attempts === 1) return json(route, { error: "Assistant rate limit exceeded. Try again shortly." }, 429);
      if (attempts === 2) return json(route, { error: "The assistant took too long to answer. Please try again." }, 504);
      if (attempts === 3) return json(route, { error: "The assistant could not complete the request." }, 502);
      return json(route, {
        message: "Recovered portfolio answer",
        sources: [{ tool: "rates", label: "Rate signals" }],
      });
    });

    await page.goto(`${BASE_URL}/overview`);
    await openAssistant(page);
    await ask(page, "Give me a recoverable answer.");

    await expect(page.getByText("Assistant rate limit exceeded. Try again shortly.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("The assistant took too long to answer. Please try again.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("The assistant could not complete the request.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Recovered portfolio answer")).toBeVisible();
    await expect(page.getByText("Rate signals")).toBeVisible();
    expect(attempts).toBe(4);
  });
});