import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        // @anupheaus/react-ui and its dependencies (e.g. @uiw/react-md-editor) use CSS imports
        // and bare directory specifiers that Node ESM rejects. Processing through Vite lets it
        // handle CSS (stubs it out) and resolve directory imports properly.
        inline: ['@anupheaus/react-ui'],
      },
    },
    include: ['**/*.{test,tests}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'tests/perf/**'],
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
