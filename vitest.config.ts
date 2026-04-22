import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{test,tests}.?(c|m)[jt]s?(x)'],
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
