import { defineConfig, devices } from '@playwright/test';

const isWin = process.platform === 'win32';
const tsx = isWin ? 'node_modules\\.bin\\tsx.cmd' : 'node_modules/.bin/tsx';
const vite = isWin ? 'node_modules\\.bin\\vite.cmd' : 'node_modules/.bin/vite';

export default defineConfig({
  testDir: './tests/playwright/specs',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: `${tsx} --tsconfig tests/playwright/tsconfig.server.json tests/playwright/server/index.ts`,
      port: 3010,
      reuseExistingServer: !process.env['CI'],
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `${vite} --config tests/playwright/app/vite.config.ts`,
      port: 5173,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
