/**
 * Sequential RPC smoke / loose throughput check. Run via `npm run test:perf` (excluded from `npm test`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { config } from 'dotenv';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server';
import { actions } from '../harness/server/configureActions';
import { testEndpoint } from '../harness/common';
import { TestClient } from '../e2e/TestClient';

config();

describe('nexus perf (e2e)', () => {
  let server: http.Server;
  let port: number;
  const socketName = 'test-perf';

  beforeAll(async () => {
    server = http.createServer();
    const logger = new Logger('nexus-perf');
    await startServer({
      name: socketName,
      logger,
      actions,
      server,
    });
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 15_000);

  afterAll(() => {
    server?.close();
  });

  it(
    '100 sequential round-trips complete in under 8 seconds on loopback',
    async () => {
      const c = new TestClient(port, socketName);
      await c.connect();
      const n = 100;
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        expect(await c.call(testEndpoint, { foo: `seq-${i}` })).toEqual({ bar: `seq-${i}` });
      }
      const elapsed = Date.now() - t0;
      // 80ms/call average — generous for loopback WebSocket but catches serious regressions.
      expect(elapsed).toBeLessThan(8_000);
      c.disconnect();
    },
    15_000,
  );

  it(
    '50 parallel actions from a single socket complete in under 5 seconds',
    async () => {
      const c = new TestClient(port, socketName);
      await c.connect();
      const n = 50;
      const t0 = Date.now();
      const results = await Promise.all(
        Array.from({ length: n }, (_, k) => c.call(testEndpoint, { foo: `par-${k}` })),
      );
      const elapsed = Date.now() - t0;
      expect(results).toHaveLength(n);
      for (let k = 0; k < n; k++) expect(results[k]).toEqual({ bar: `par-${k}` });
      expect(elapsed).toBeLessThan(5_000);
      c.disconnect();
    },
    10_000,
  );
});
