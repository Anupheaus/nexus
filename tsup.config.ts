import { defineConfig } from 'tsup';

const dtsConfig = { compilerOptions: { skipLibCheck: true, ignoreDeprecations: '6.0', types: ['node'] } };

export default defineConfig([
  {
    entry: { common: 'src/common/index.ts' },
    format: ['esm'],
    dts: dtsConfig,
    sourcemap: true,
    clean: true,
    external: [/^[^./]/],
    target: 'es2020',
    platform: 'neutral',
  },
  {
    entry: { server: 'src/server/index.ts' },
    format: ['esm'],
    dts: dtsConfig,
    sourcemap: true,
    clean: false,
    external: [/^[^./]/],
    target: 'es2020',
    platform: 'node',
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: ['esm'],
    dts: dtsConfig,
    sourcemap: true,
    clean: false,
    external: [/^[^./]/],
    target: 'es2020',
    platform: 'browser',
  },
]);
