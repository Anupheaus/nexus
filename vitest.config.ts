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
    server: {
      deps: {
        // @anupheaus/react-ui and its dependencies (e.g. @uiw/react-md-editor) use CSS imports
        // and bare directory specifiers that Node ESM rejects. Processing through Vite lets it
        // handle CSS (stubs it out) and resolve directory imports properly.
        inline: ['@anupheaus/react-ui'],
      },
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
