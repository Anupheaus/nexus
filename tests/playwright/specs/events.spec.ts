import { test, expect } from '@playwright/test';

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
  });

  test('server-push event appears in the event log', async ({ page }) => {
    await page.getByTestId('trigger-event-btn').click();
    await expect(page.getByTestId('event-item').first()).toBeVisible({ timeout: 5_000 });
  });

  test('multiple events accumulate in the log', async ({ page }) => {
    await page.getByTestId('trigger-event-btn').click();
    await page.getByTestId('trigger-event-btn').click();
    await page.getByTestId('trigger-event-btn').click();
    await expect(page.getByTestId('event-item')).toHaveCount(3, { timeout: 5_000 });
  });

  test('event log is empty before any events are triggered', async ({ page }) => {
    await expect(page.getByTestId('event-item')).toHaveCount(0);
  });
});
