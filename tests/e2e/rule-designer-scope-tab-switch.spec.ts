/**
 * E2E test: Service line scope selection persists when switching between
 * Ask AI and Structured tabs in the Rule Designer.
 *
 * Run with: npx playwright test tests/e2e/rule-designer-scope-tab-switch.spec.ts
 *
 * Scenario:
 *   1. Open Pricing Controls page (demo mode, no login needed).
 *   2. On the Ask AI tab, select AL and HC in the Scope picker.
 *   3. Switch to the Structured tab — scope labels must still show "AL, HC".
 *   4. Switch back to Ask AI — scope labels must still show "AL, HC".
 *   5. Confirm the picker dropdown is closed after each tab switch.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

test.describe('Rule Designer — scope selection persists across tab switches', () => {
  test('AL + HC selected on Ask AI carries over to Structured and back', async ({ page }) => {
    await page.goto(`${BASE_URL}/pricing-controls`);

    // ── 1. Confirm Ask AI tab is active and scope shows the default ────────────
    const askAiScopeBtn = page.getByTestId('scope-picker-ask-ai');
    await expect(askAiScopeBtn).toBeVisible();

    const askAiScopeLabel = page.getByTestId('scope-label-ask-ai');
    await expect(askAiScopeLabel).toHaveText('All service lines');

    // ── 2. Open the picker on Ask AI and select AL and HC ─────────────────────
    await askAiScopeBtn.click();

    const alCheckbox = page.getByTestId('scope-checkbox-ask-ai-AL');
    const hcCheckbox = page.getByTestId('scope-checkbox-ask-ai-HC');

    await expect(alCheckbox).toBeVisible();
    await alCheckbox.check();
    await hcCheckbox.check();

    await expect(alCheckbox).toBeChecked();
    await expect(hcCheckbox).toBeChecked();

    // Label should now reflect both selections
    await expect(askAiScopeLabel).toContainText('AL');
    await expect(askAiScopeLabel).toContainText('HC');

    // ── 3. Switch to Structured tab ───────────────────────────────────────────
    await page.getByRole('tab', { name: /Structured/i }).click();

    // Picker should be closed after tab switch
    await expect(page.getByTestId('scope-checkbox-structured-AL')).not.toBeVisible();

    // Scope label on Structured tab must carry the same selection
    const structuredScopeLabel = page.getByTestId('scope-label-structured');
    await expect(structuredScopeLabel).toBeVisible();
    await expect(structuredScopeLabel).toContainText('AL');
    await expect(structuredScopeLabel).toContainText('HC');

    // Open the Structured picker and verify checkboxes match
    await page.getByTestId('scope-picker-structured').click();

    const alStructuredCheckbox = page.getByTestId('scope-checkbox-structured-AL');
    const hcStructuredCheckbox = page.getByTestId('scope-checkbox-structured-HC');

    await expect(alStructuredCheckbox).toBeVisible();
    await expect(alStructuredCheckbox).toBeChecked();
    await expect(hcStructuredCheckbox).toBeChecked();

    // Close the picker before switching back
    await page.keyboard.press('Escape');

    // ── 4. Switch back to Ask AI ──────────────────────────────────────────────
    await page.getByRole('tab', { name: /Ask AI/i }).click();

    // Picker should still be closed
    await expect(page.getByTestId('scope-checkbox-ask-ai-AL')).not.toBeVisible();

    // Scope label must still show the original selections
    await expect(askAiScopeLabel).toBeVisible();
    await expect(askAiScopeLabel).toContainText('AL');
    await expect(askAiScopeLabel).toContainText('HC');

    // Open Ask AI picker to confirm checkboxes are still checked
    await askAiScopeBtn.click();

    await expect(alCheckbox).toBeVisible();
    await expect(alCheckbox).toBeChecked();
    await expect(hcCheckbox).toBeChecked();
  });
});
