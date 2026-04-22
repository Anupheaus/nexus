import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.{test,tests}.?(c|m)[jt]s?(x)'],
    environment: 'node',
  },
});
