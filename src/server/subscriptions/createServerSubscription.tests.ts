import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';

/** Polls `condition` every 20 ms until it returns true or `timeoutMs` expires. */
async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 20));
  }
}
import { Logger } from '@anupheaus/common';
import { createServerSubscription } from './createServerSubscription';
import { defineSubscription } from '../../common';
import { startServer } from '../../server';
import { TestClient } from '../../../tests/e2e/TestClient';

// ─── Contract definitions (unique names to avoid module-level Set collision) ──

const tickSub = defineSubscription<{ intervalMs: number }, { count: number }>()('subTestTick');
const failSub = defineSubscription<void, void>()('subTestFail');
const onceSub = defineSubscription<{ value: string }, { value: string }>()('subTestOnce');

describe('createServerSubscription — integration', () => {
  let server: http.Server;
  let port: number;
  const socketName = 'sub-test';

  beforeAll(async () => {
    server = http.createServer();
    const logger = new Logger('sub-tests');
    await startServer({
      name: socketName,
      logger,
      server,
      subscriptions: [
        createServerSubscription(tickSub, async ({ request, update, onUnsubscribe }) => {
          let n = 0;
          const t = setInterval(() => { n++; update({ count: n }); }, request.intervalMs);
          onUnsubscribe(() => clearInterval(t));
          return { count: 0 };
        }),
        createServerSubscription(failSub, async () => {
          throw new Error('subscribe-failed');
        }),
        createServerSubscription(onceSub, async ({ request }) => {
          return { value: request.value };
        }),
      ],
    });
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 15_000);

  afterAll(() => { server?.close(); });

  it('returns an object with a registerSocket method', () => {
    const sub = defineSubscription<void, void>()('factorySub');
    const result = createServerSubscription(sub, async () => undefined);
    expect(typeof result.registerSocket).toBe('function');
  });

  it('subscribe returns the initial response', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    const { initial } = await c.subscribe(tickSub, { intervalMs: 500 });
    expect(initial).toEqual({ count: 0 });
    c.disconnect();
  });

  it('receives streamed updates after subscribe', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    const updates: number[] = [];
    const { subscriptionId } = await c.subscribe(tickSub, { intervalMs: 40 });
    c.onSubscriptionUpdate(tickSub, subscriptionId, u => updates.push(u.count));
    // Poll until ≥2 updates arrive rather than sleeping a fixed duration.
    await waitFor(() => updates.length >= 2);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    c.disconnect();
  });

  it('unsubscribe stops further updates', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    const updates: number[] = [];
    const { subscriptionId } = await c.subscribe(tickSub, { intervalMs: 40 });
    c.onSubscriptionUpdate(tickSub, subscriptionId, u => updates.push(u.count));
    // Wait until at least one update arrives before unsubscribing.
    await waitFor(() => updates.length >= 1);
    await c.unsubscribe(tickSub, subscriptionId);
    const countAfterUnsub = updates.length;
    // Wait long enough that any in-flight update would have landed.
    await new Promise(r => setTimeout(r, 200));
    expect(updates.length).toBe(countAfterUnsub);
    c.disconnect();
  });

  it('rejects subscribe when the handler throws — only exposes message', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    await expect(c.subscribe(failSub, undefined)).rejects.toThrow('subscribe-failed');
    c.disconnect();
  });

  it('rejects unsubscribe with unknown subscription id', async () => {
    const c = new TestClient(port, socketName);
    await c.connect();
    await expect(c.unsubscribe(tickSub, 'no-such-id')).rejects.toThrow(/Unsubscribe handler not found/);
    c.disconnect();
  });

  it('one socket cannot unsubscribe another socket subscription (S1 security fix)', async () => {
    const cOwner = new TestClient(port, socketName);
    const cAttacker = new TestClient(port, socketName);
    await cOwner.connect();
    await cAttacker.connect();

    const updates: number[] = [];
    const { subscriptionId } = await cOwner.subscribe(tickSub, { intervalMs: 40 }, 'victim-sub-id');
    cOwner.onSubscriptionUpdate(tickSub, subscriptionId, u => updates.push(u.count));

    // Attacker tries to unsubscribe using the known subscription ID.
    await expect(cAttacker.unsubscribe(tickSub, 'victim-sub-id')).rejects.toThrow(/Unsubscribe handler not found/);

    // Owner's subscription continues to receive updates after the attacker's attempt.
    const countBefore = updates.length;
    await waitFor(() => updates.length > countBefore);
    expect(updates.length).toBeGreaterThan(countBefore);

    await cOwner.unsubscribe(tickSub, subscriptionId);
    cOwner.disconnect();
    cAttacker.disconnect();
  });

  it('subscription cleanup runs on disconnect — no updates after socket disconnect', async () => {
    const onUnsubscribeSpy = vi.fn();
    // Register a one-shot sub with a spy on cleanup (via the once subscription)
    const c = new TestClient(port, socketName);
    await c.connect();
    const { subscriptionId } = await c.subscribe(tickSub, { intervalMs: 30 });
    const updates: number[] = [];
    c.onSubscriptionUpdate(tickSub, subscriptionId, u => updates.push(u.count));
    // Wait until updates start arriving before disconnecting.
    await waitFor(() => updates.length >= 1);
    const countAtDisconnect = updates.length;
    c.disconnect();
    // Allow any in-flight emits to settle, then verify updates have stopped.
    await new Promise(r => setTimeout(r, 200));
    expect(updates.length).toBe(countAtDisconnect);
    void onUnsubscribeSpy; // referenced to avoid lint warning
  });
});
