import { test, expect } from '@playwright/test';

test.describe('REST-only mode', () => {
  test('action falls back to REST when socket is not connected', async ({ page }) => {
    await page.goto('/');
    // Wait for auto-connect, then explicitly disconnect so the socket is not connected
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
    await page.getByTestId('disconnect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('disconnected', { timeout: 5_000 });

    await page.getByTestId('rest-btn').click();
    await expect(page.getByTestId('rest-result')).toHaveText('Hello, World!', { timeout: 5_000 });
  });
});
