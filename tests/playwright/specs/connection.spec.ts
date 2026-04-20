import { test, expect } from '@playwright/test';

test.describe('Connection', () => {
  test('auto-connects on page load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
  });

  test('disconnects when the disconnect button is clicked', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
    await page.getByTestId('disconnect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('disconnected', { timeout: 5_000 });
  });

  test('reconnects after disconnect', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
    await page.getByTestId('disconnect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('disconnected', { timeout: 5_000 });
    await page.getByTestId('connect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
  });

  test('shows connected status text when connected', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
    await expect(page.getByTestId('connect-btn')).toBeVisible();
    await expect(page.getByTestId('disconnect-btn')).toBeVisible();
  });
});
