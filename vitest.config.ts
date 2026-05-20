import { defineConfig } from 'vitest/config';
import path from 'path';

const testFilePattern = '**/*.{test,tests}.?(c|m)[jt]s?(x)';
const commonExcludes = ['**/node_modules/**', '**/dist/**', '.claude/**'];

export default defineConfig({
  test: {
    // Patches process.execPath before any child_process.fork() calls so the
    // Windows NVM junction at C:\Program Files\nodejs\node.exe does not cause
    // ENOENT when vitest spawns fork workers.
    globalSetup: ['./tests/setup/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text-summary'],
      include: ['src/**/*'],
      exclude: ['src/**/*.d.ts'],
    },
    projects: [
      // Server tests — node environment, no jsdom
      {
        test: {
          name: 'server',
          environment: 'node',
          // JWT tests run real RSA crypto which takes 3-5 s per test; raise the
          // limit so they don't flake when running in parallel with the client
          // compilation workload.
          testTimeout: 15000,
          include: [`src/server/${testFilePattern}`],
          exclude: commonExcludes,
        },
      },
      // Client and common tests — jsdom environment
      {
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
          name: 'client',
          environment: 'jsdom',
          server: {
            deps: {
              // @anupheaus/react-ui pulls in @mui/x-date-pickers which uses ESM syntax
              // in a non-"type":"module" package. Without this, vitest's module runner
              // can't resolve its named exports (e.g. AdapterLuxon). Also, mocking
              // @uiw/react-md-editor (in clientSetup.ts) prevents its ESM build's
              // CSS import from crashing the module runner on Windows.
              inline: ['@anupheaus/react-ui', '@mui/x-date-pickers'],
            },
          },
          // Mock @uiw/react-md-editor before any test loads so its ESM build
          // (which imports ./index.css) is never evaluated by Node.js.
          setupFiles: ['./tests/setup/clientSetup.ts'],
          include: [`src/client/${testFilePattern}`, `src/common/${testFilePattern}`],
          exclude: commonExcludes,
        },
      },
    ],
  },
});
