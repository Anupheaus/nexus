import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // @capacitor/* are optional peer deps not installed in dev.
      // Alias them to lightweight stubs so Vite can resolve the dynamic
      // imports in googleSignIn.ts during tests without installing the packages.
      '@capacitor/browser': path.resolve(__dirname, 'tests/stubs/capacitor-browser.ts'),
      '@capacitor/app': path.resolve(__dirname, 'tests/stubs/capacitor-app.ts'),
    },
  },
  test: {
    poolOptions: {
      // vitest 4 resolves node.exe via process.execPath which on Windows+NVM
      // is a junction point that CreateProcess cannot follow (ENOENT). Using
      // the bare 'node' command lets the OS resolve it via PATH instead.
      forks: { execPath: 'node' },
    },
    include: ['**/*.{test,tests}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'tests/perf/**', '.claude/**'],
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['src/server/**/*', 'node'],
      ['tests/e2e/**/*', 'node'],
      ['tests/perf/**/*', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text-summary'],
      include: ['src/**/*'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
