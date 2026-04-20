import { test, expect } from '@playwright/test';

test.describe('Subscriptions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
  });

  test('counter increments after subscribing', async ({ page }) => {
    await page.getByTestId('subscribe-btn').click();
    await expect(page.getByTestId('subscription-status')).toHaveText('subscribed');

    // Wait for at least two increments to confirm live streaming
    const firstValue = await page.getByTestId('counter-value').textContent({ timeout: 2_000 });
    await page.waitForTimeout(500);
    const secondValue = await page.getByTestId('counter-value').textContent();

    expect(Number(secondValue)).toBeGreaterThan(Number(firstValue));
  });

  test('counter stops updating after unsubscribe', async ({ page }) => {
    await page.getByTestId('subscribe-btn').click();
    await expect(page.getByTestId('counter-value')).not.toHaveText('', { timeout: 2_000 });

    await page.getByTestId('unsubscribe-btn').click();
    await expect(page.getByTestId('subscription-status')).toHaveText('unsubscribed');

    // Capture value immediately after unsubscribe
    const valueAfterUnsub = await page.getByTestId('counter-value').textContent();
    await page.waitForTimeout(600); // wait longer than one counter tick (200ms)
    const valueLater = await page.getByTestId('counter-value').textContent();

    expect(valueLater).toBe(valueAfterUnsub);
  });

  test('subscribe button is disabled while subscribed', async ({ page }) => {
    await page.getByTestId('subscribe-btn').click();
    await expect(page.getByTestId('subscribe-btn')).toBeDisabled();
    await expect(page.getByTestId('unsubscribe-btn')).toBeEnabled();
  });

  test('unsubscribe button is disabled while not subscribed', async ({ page }) => {
    await expect(page.getByTestId('unsubscribe-btn')).toBeDisabled();
    await expect(page.getByTestId('subscribe-btn')).toBeEnabled();
  });
});
