import { defineConfig } from 'vitest/config';
import { siblingAlias } from './tests/setup/siblingSources.ts';

export default defineConfig({
  resolve: { alias: siblingAlias(__dirname) },
  test: {
    include: ['tests/e2e/**/*.{test,tests}.?(c|m)[jt]s?(x)'],
    environment: 'node',
  },
});
