/**
 * E2E regression tests: structured rule payload is the source of truth.
 *
 * The rule designer posts `structured` (conditions + action JSON) alongside
 * the display description. The server must:
 *   1. Persist exactly the structured trigger/action — including negative
 *      thresholds and the fraction scale — without re-reading the sentence.
 *   2. Retain an explicit room-type scope through a structured PATCH
 *      (editing must never silently broaden a scoped rule).
 *   3. Reject an unrepresentable structured payload with a 400 instead of
 *      falling back to sentence parsing.
 *
 * Run with: npx playwright test tests/e2e/rule-structured-payload.spec.ts
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

const parse = (v: any) => (typeof v === 'string' ? JSON.parse(v) : (v ?? {}));

const structuredBody = (over: any = {}) => ({
  description: 'If Campus Occupancy (Trailing 3) is less than 85%, Decrease rate by 3% [e2e structured test]',
  structured: {
    conditions: [{ metric: 'Campus Occupancy', timePeriod: 'Trailing 3', operator: 'is less than', value: '85' }],
    conditionOperator: 'AND',
    action: { type: 'decrease_rate', amountType: 'percent', amountValue: '3', scope: 'All selected campuses' },
  },
  preview: false,
  locationId: null,
  serviceLines: ['AL'],
  roomTypes: ['Studio'],
  effectiveDate: null,
  isAdditive: true,
  isHistorical: false,
  ...over,
});

test.describe('Structured rule payload end-to-end', () => {
  let ruleId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (ruleId) {
      await request.delete(`${BASE_URL}/api/adjustment-rules/${ruleId}`);
      ruleId = null;
    }
  });

  test('POST persists the structured trigger/action verbatim and PATCH retains room-type scope', async ({ request }) => {
    const created = await request.post(`${BASE_URL}/api/adjustment-rules`, { data: structuredBody() });
    expect(created.status(), await created.text()).toBe(200);
    const rule = (await created.json()).rule ?? (await created.json());
    ruleId = rule.id;

    let trigger = parse(rule.trigger);
    let action = parse(rule.action);
    const conds = trigger.conditions ?? (trigger.condition ? [trigger.condition] : []);
    expect(trigger.type).toBe('condition');
    expect(conds[0]).toMatchObject({ field: 'occupancy_trailing3', operator: '<', value: 0.85 });
    expect(action).toMatchObject({ type: 'adjust_rate', adjustmentType: 'percentage', adjustmentValue: -3 });
    expect(action.filters?.roomType).toEqual(['Studio']);

    // Edit: change the threshold; the hydrated room types are re-sent, exactly
    // as the designer does. The room-type scope must survive.
    const patched = await request.patch(`${BASE_URL}/api/adjustment-rules/${ruleId}`, {
      data: structuredBody({
        description: 'If Campus Occupancy (Trailing 3) is less than 80%, Decrease rate by 3% [e2e structured test]',
        structured: {
          conditions: [{ metric: 'Campus Occupancy', timePeriod: 'Trailing 3', operator: 'is less than', value: '80' }],
          conditionOperator: 'AND',
          action: { type: 'decrease_rate', amountType: 'percent', amountValue: '3', scope: 'All selected campuses' },
        },
      }),
    });
    expect(patched.status(), await patched.text()).toBe(200);
    const updated = (await patched.json()).rule ?? (await patched.json());

    trigger = parse(updated.trigger);
    action = parse(updated.action);
    const conds2 = trigger.conditions ?? (trigger.condition ? [trigger.condition] : []);
    expect(conds2[0]).toMatchObject({ field: 'occupancy_trailing3', operator: '<', value: 0.8 });
    expect(action.filters?.roomType).toEqual(['Studio']); // scope NOT broadened by the edit
  });

  test('unrepresentable structured payload is rejected with 400, never sentence-parsed', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/adjustment-rules`, {
      data: structuredBody({
        // The description alone WOULD parse — proving a fallback would have
        // silently succeeded. The structured action must win and be rejected.
        description: 'If campus occupancy is below 85%, decrease rates by 3%',
        structured: {
          conditions: [{ metric: 'Campus Occupancy', timePeriod: 'Current Month', operator: 'is less than', value: '85' }],
          conditionOperator: 'AND',
          action: { type: 'set_rate', amountType: 'percent', amountValue: '3', scope: 'All selected campuses' },
        },
        preview: true,
      }),
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.details?.[0] ?? body.error)).toContain('set_rate');
  });
});
