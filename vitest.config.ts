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
  },
});
