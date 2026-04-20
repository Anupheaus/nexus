import { test, expect } from '@playwright/test';

test.describe('Actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('connect-btn').click();
    await expect(page.getByTestId('connection-status')).toHaveText('connected', { timeout: 5_000 });
  });

  test('imperative echo action returns the echoed value', async ({ page }) => {
    await page.getByTestId('echo-btn').click();
    await expect(page.getByTestId('echo-result')).toHaveText('hello', { timeout: 5_000 });
  });

  test('error action propagates error message to client', async ({ page }) => {
    await page.getByTestId('error-btn').click();
    await expect(page.getByTestId('error-result')).toHaveText('intentional error', { timeout: 5_000 });
  });

  test('reactive echo rerenders when input changes', async ({ page }) => {
    // Wait for initial reactive result (uses 'initial' as input)
    await expect(page.getByTestId('reactive-result')).toHaveText('initial', { timeout: 5_000 });

    // Change the input — reactive hook should re-fire
    await page.getByTestId('reactive-input').fill('updated');
    await expect(page.getByTestId('reactive-result')).toHaveText('updated', { timeout: 5_000 });
  });

  test('reactive echo shows loading state while fetching', async ({ page }) => {
    await page.getByTestId('reactive-input').fill('loading-test');
    // Should briefly show loading before settling
    await expect(page.getByTestId('reactive-result')).toHaveText('loading-test', { timeout: 5_000 });
  });
});
