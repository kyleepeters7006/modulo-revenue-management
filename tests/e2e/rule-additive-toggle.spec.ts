/**
 * E2E regression test: PATCH /api/adjustment-rules/:id/additive toggle semantics.
 *
 * Rules STACK by default (isAdditive unset or true). Toggling the stacks
 * switch on an unset-flag rule must mark it exclusive (isAdditive: false),
 * and toggling again must return it to stacking (isAdditive: true).
 *
 * Run with: npx playwright test tests/e2e/rule-additive-toggle.spec.ts
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

function getAction(rule: any): any {
  return typeof rule.action === 'string' ? JSON.parse(rule.action) : (rule.action ?? {});
}

test.describe('Adjustment rule additive toggle (stacking vs exclusive)', () => {
  let ruleId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (ruleId) {
      await request.delete(`${BASE_URL}/api/adjustment-rules/${ruleId}`);
      ruleId = null;
    }
  });

  test('unset-flag rule stacks by default; toggle marks it exclusive (isAdditive: false)', async ({ request }) => {
    // 1. Create a rule via the natural-language endpoint — no isAdditive flag set.
    const createRes = await request.post(`${BASE_URL}/api/adjustment-rules`, {
      data: { description: 'Increase all studio rates by 5 percent' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createdBody = await createRes.json();
    const created = createdBody.rule ?? createdBody;
    ruleId = created.id;
    expect(ruleId).toBeTruthy();

    // The freshly created rule must NOT be explicitly exclusive.
    const createdAction = getAction(created);
    expect(createdAction.isAdditive === false).toBe(false); // unset or true → stacks

    // 2. Toggle once: unset flag → exclusive (isAdditive: false).
    const patch1 = await request.patch(`${BASE_URL}/api/adjustment-rules/${ruleId}/additive`);
    expect(patch1.ok()).toBeTruthy();
    const afterFirst = await patch1.json();
    expect(getAction(afterFirst).isAdditive).toBe(false);

    // Persisted state must match.
    const listRes = await request.get(`${BASE_URL}/api/adjustment-rules`);
    expect(listRes.ok()).toBeTruthy();
    const persisted = (await listRes.json()).find((r: any) => r.id === ruleId);
    expect(persisted).toBeTruthy();
    expect(getAction(persisted).isAdditive).toBe(false);

    // 3. Toggle again: exclusive → stacking (isAdditive: true).
    const patch2 = await request.patch(`${BASE_URL}/api/adjustment-rules/${ruleId}/additive`);
    expect(patch2.ok()).toBeTruthy();
    const afterSecond = await patch2.json();
    expect(getAction(afterSecond).isAdditive).toBe(true);
  });

  test('PATCH additive on unknown rule returns 404', async ({ request }) => {
    const res = await request.patch(
      `${BASE_URL}/api/adjustment-rules/00000000-0000-0000-0000-000000000000/additive`,
    );
    expect(res.status()).toBe(404);
  });
});
