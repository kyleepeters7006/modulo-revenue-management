/**
 * E2E UI regression test: stacking badges in the Rule Designer rule list.
 *
 * Unit tests guard shared/ruleStacking.ts and an API test covers the
 * PATCH /additive endpoint, but this spec asserts the actual on-screen
 * badges in client/src/components/dashboard/rule-designer.tsx:
 *
 *   1. Seed a rule with NO isAdditive flag via the API.
 *   2. Open /pricing-controls — the rule row must show the '+ stacks'
 *      badge (rules stack by default) and the teal stacks indicator dot,
 *      with no amber priority number.
 *   3. Toggle the per-row stacks switch — the badge must flip to
 *      '⊙ exclusive' and the amber priority indicator must appear.
 *   4. Toggle again — badge returns to '+ stacks'.
 *
 * Run with: npx playwright test tests/e2e/rule-stacking-badge.spec.ts
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

test.describe('Rule Designer — stacking badge rendering', () => {
  test.setTimeout(120_000);

  let ruleId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (ruleId) {
      await request.delete(`${BASE_URL}/api/adjustment-rules/${ruleId}`);
      ruleId = null;
    }
  });

  test('unset-flag rule renders "+ stacks" badge; toggle flips it to "⊙ exclusive" and back', async ({ page, request }) => {
    // ── 1. Seed a rule with no isAdditive flag ────────────────────────────────
    const createRes = await request.post(`${BASE_URL}/api/adjustment-rules`, {
      data: { description: 'Increase all studio rates by 4 percent' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createdBody = await createRes.json();
    const created = createdBody.rule ?? createdBody;
    ruleId = created.id;
    expect(ruleId).toBeTruthy();

    // ── 2. Open Pricing Controls and locate the seeded rule row ──────────────
    await page.goto(`${BASE_URL}/pricing-controls`);

    const ruleRow = page.getByTestId(`rule-${ruleId}`);
    await expect(ruleRow).toBeVisible({ timeout: 20_000 });

    // Badge must read '+ stacks' (rules stack by default when flag is unset)
    const badge = page.getByTestId(`badge-stacking-${ruleId}`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('+ stacks');

    // Teal stacks indicator dot present, amber priority number absent
    await expect(page.getByTestId(`stacks-indicator-${ruleId}`)).toBeVisible();
    await expect(page.getByTestId(`priority-indicator-${ruleId}`)).toHaveCount(0);

    // The per-row stacks switch must be ON (checked)
    const additiveSwitch = page.getByTestId(`switch-additive-${ruleId}`);
    await expect(additiveSwitch).toBeVisible();
    await expect(additiveSwitch).toHaveAttribute('data-state', 'checked');

    // ── 3. Toggle: stacking → exclusive ───────────────────────────────────────
    const patch1 = page.waitForResponse(
      (r) => r.url().includes(`/api/adjustment-rules/${ruleId}/additive`) && r.request().method() === 'PATCH',
    );
    await additiveSwitch.click();
    expect((await patch1).ok()).toBeTruthy();

    await expect(badge).toHaveText('⊙ exclusive');
    await expect(additiveSwitch).toHaveAttribute('data-state', 'unchecked');

    // Exclusive rules show the amber priority indicator; teal dot goes away
    const priority = page.getByTestId(`priority-indicator-${ruleId}`);
    await expect(priority).toBeVisible();
    await expect(priority).toHaveText(/^\d+$/);
    await expect(page.getByTestId(`stacks-indicator-${ruleId}`)).toHaveCount(0);

    // Change must be persisted, not just local UI state
    const listRes = await request.get(`${BASE_URL}/api/adjustment-rules`);
    expect(listRes.ok()).toBeTruthy();
    const persisted = (await listRes.json()).find((r: any) => r.id === ruleId);
    expect(persisted).toBeTruthy();
    const action = typeof persisted.action === 'string' ? JSON.parse(persisted.action) : (persisted.action ?? {});
    expect(action.isAdditive).toBe(false);

    // ── 4. Toggle back: exclusive → stacking ──────────────────────────────────
    const patch2 = page.waitForResponse(
      (r) => r.url().includes(`/api/adjustment-rules/${ruleId}/additive`) && r.request().method() === 'PATCH',
    );
    await additiveSwitch.click();
    expect((await patch2).ok()).toBeTruthy();

    await expect(badge).toHaveText('+ stacks');
    await expect(additiveSwitch).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId(`stacks-indicator-${ruleId}`)).toBeVisible();
    await expect(page.getByTestId(`priority-indicator-${ruleId}`)).toHaveCount(0);

    // Survives a reload — badge state comes from the server, not local state
    await page.reload();
    await expect(page.getByTestId(`rule-${ruleId}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`badge-stacking-${ruleId}`)).toHaveText('+ stacks');
  });
});
