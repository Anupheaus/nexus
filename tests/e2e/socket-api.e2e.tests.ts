import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import { config } from 'dotenv';
import type { LoggerEntry } from '@anupheaus/common';
import { Logger } from '@anupheaus/common';
import {
  startServer,
  createServerActionHandler,
  createServerSubscription,
  useAction,
  useEvent,
  useSocketAPI,
} from '../../src/server';
import { defineAction, defineSubscription, defineEvent } from '../../src/common';
import { socketAPIUserSignOut } from '../../src/common/internalEvents';
import { actions } from '../harness/server/configureActions';
import { testEndpoint, signIn } from '../harness/common';
import { TestClient } from './TestClient';

config();

const lifecycleMocks = vi.hoisted(() => ({
  onBeforeHandle: vi.fn().mockResolvedValue(undefined),
  onClientConnecting: vi.fn(),
  onClientConnected: vi.fn(),
  onClientDisconnected: vi.fn(),
  onRegisterNamespaces: vi.fn(),
}));

const logCaptures = vi.hoisted(() => ({
  batches: [] as LoggerEntry[][],
}));

const testFailingAction = defineAction<void, void>()('testFailing');
const tickSubscription = defineSubscription<{ intervalMs: number }, { count: number }>()('tickSubscription');
const failSubscription = defineSubscription<void, { count: number }>()('e2eFailSubscription');

const e2eClientEchoAction = defineAction<{ v: number }, { doubled: number }>()('e2eClientEcho');
const e2eTriggerClientEchoAction = defineAction<{ v: number }, { doubled: number }>()('e2eTriggerClientEcho');

const e2eCustomDomainEvent = defineEvent<{ tag: string }>('e2eCustomDomain');
const e2eEmitDomainEventAction = defineAction<{ tag: string }, boolean>()('e2eEmitDomainEvent');

const e2eAnnounceSignOutAction = defineAction<void, true>()('e2eAnnounceSignOut');

/** Slow action so tests can disconnect mid-flight before the server acks. */
const e2eDelayedEchoAction = defineAction<{ foo: string; delayMs?: number }, { bar: string }>()('e2eDelayedEcho');

/** Returns the current authenticated user ID (or null). */
const e2eGetUserIdAction = defineAction<void, string | null>()('e2eGetUserId');
/** Impersonates the given user ID and returns what user ID is visible from inside the impersonation scope. */
const e2eImpersonateAction = defineAction<{ userId: string }, string | null>()('e2eImpersonate');
/** Subscription that pushes one update then its server calls update() after the client unsubscribes. */
const e2eLateUpdateSubscription = defineSubscription<void, { seq: number }>()('e2eLateUpdate');

const e2eActions = [
  ...actions,
  createServerActionHandler(testFailingAction as never, async () => {
    throw new Error('Intentional failure for e2e test');
  }),
  createServerActionHandler(e2eTriggerClientEchoAction, async ({ v }) => {
    const askClient = useAction(e2eClientEchoAction);
    return askClient({ v });
  }),
  createServerActionHandler(e2eEmitDomainEventAction, async ({ tag }) => {
    const emit = useEvent(e2eCustomDomainEvent);
    await emit({ tag });
    return true;
  }),
  createServerActionHandler(e2eAnnounceSignOutAction, async () => {
    const signOut = useEvent(socketAPIUserSignOut);
    await signOut();
    return true as const;
  }),
  createServerActionHandler(e2eDelayedEchoAction, async ({ foo, delayMs }) => {
    await new Promise<void>(r => setTimeout(r, delayMs ?? 800));
    return { bar: foo };
  }),
  createServerActionHandler(e2eGetUserIdAction, async () => {
    const { getUser } = useSocketAPI();
    return getUser()?.id ?? null;
  }),
  createServerActionHandler(e2eImpersonateAction, async ({ userId }) => {
    const { impersonateUser } = useSocketAPI();
    return impersonateUser({ id: userId }, () => {
      const { getUser } = useSocketAPI();
      return getUser()?.id ?? null;
    });
  }),
];

const e2eSubscriptions = [
  createServerSubscription(tickSubscription, async ({ request, update, onUnsubscribe }) => {
    let count = 0;
    const interval = setInterval(() => {
      count++;
      update({ count });
    }, request.intervalMs);
    onUnsubscribe(() => clearInterval(interval));
    return { count: 0 };
  }),
  createServerSubscription(failSubscription, async () => {
    throw new Error('Intentional subscribe failure');
  }),
  createServerSubscription(e2eLateUpdateSubscription, async ({ update, onUnsubscribe }) => {
    let cancelled = false;
    onUnsubscribe(() => { cancelled = true; });
    // Push a second update 200ms after subscribe — may arrive after the client unsubscribes.
    setTimeout(() => { if (!cancelled) update({ seq: 2 }); }, 200);
    return { seq: 1 };
  }),
];

function httpGet(port: number, path: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers });
      });
    }).on('error', reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** How `p` settled before `capMs`, or still pending (timeout). */
async function settleOutcome<T>(p: Promise<T>, capMs: number): Promise<'fulfilled' | 'rejected' | 'timeout'> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve('timeout'), capMs);
    p.then(
      () => { clearTimeout(t); resolve('fulfilled'); },
      () => { clearTimeout(t); resolve('rejected'); },
    );
  });
}

describe('socket-api e2e', () => {
  let server: http.Server;
  let port: number;
  const socketName = 'test';

  function client(auth?: Record<string, string>, options?: ConstructorParameters<typeof TestClient>[3]) {
    return new TestClient(port, socketName, auth, options);
  }

  beforeAll(async () => {
    logCaptures.batches.length = 0;
    server = http.createServer();
    const logger = new Logger('socket-api-e2e');
    await startServer({
      name: socketName,
      logger,
      actions: e2eActions,
      subscriptions: e2eSubscriptions,
      server,
      onBeforeHandle: lifecycleMocks.onBeforeHandle,
      onClientConnecting: lifecycleMocks.onClientConnecting,
      onClientConnected: lifecycleMocks.onClientConnected,
      onClientDisconnected: lifecycleMocks.onClientDisconnected,
      onRegisterNamespaces: lifecycleMocks.onRegisterNamespaces,
      onRegisterRoutes: async router => {
        router.get('/e2e-http', async ctx => {
          ctx.body = { e2eHttp: true };
        });
      },
      clientLoggingService: (_client, _user) => async (entries: LoggerEntry[]) => {
        logCaptures.batches.push([...entries]);
      },
    });
    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 15000);

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    lifecycleMocks.onBeforeHandle.mockClear();
    lifecycleMocks.onClientConnecting.mockClear();
    lifecycleMocks.onClientConnected.mockClear();
    lifecycleMocks.onClientDisconnected.mockClear();
    logCaptures.batches.length = 0;
  });

  describe('connection', () => {
    it('connects to the server', async () => {
      const c = client();
      await c.connect();
      expect(c.isConnected).toBe(true);
      expect(lifecycleMocks.onClientConnecting).toHaveBeenCalled();
      expect(lifecycleMocks.onClientConnected).toHaveBeenCalled();
      c.disconnect();
      await new Promise(r => setTimeout(r, 30));
      expect(lifecycleMocks.onClientDisconnected).toHaveBeenCalled();
    });

    it('handles multiple concurrent connections', async () => {
      const clients = Array.from({ length: 5 }, () => client());
      await Promise.all(clients.map(c => c.connect()));
      expect(clients.every(c => c.isConnected)).toBe(true);
      clients.forEach(c => c.disconnect());
    });

    it('can reconnect after disconnect', async () => {
      const c = client();
      await c.connect();
      c.disconnect();
      await new Promise(r => setTimeout(r, 50));
      await c.connect();
      expect(c.isConnected).toBe(true);
      c.disconnect();
    });

    it('exposes socket.io auth on the server handshake', async () => {
      const c = client({ role: 'e2e-auth' });
      await c.connect();
      expect(lifecycleMocks.onClientConnecting).toHaveBeenCalled();
      const socketArg = lifecycleMocks.onClientConnecting.mock.calls[0]![0]!;
      expect(socketArg.handshake.auth).toEqual({ role: 'e2e-auth' });
      c.disconnect();
    });

  });

  describe('HTTP (Koa) alongside Socket.IO', () => {
    it('serves registered REST routes on the same http.Server', async () => {
      const { status, body } = await httpGet(port, '/e2e-http');
      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ e2eHttp: true });
    });

    it('sets a connection cookie on HTTP responses', async () => {
      const { status, headers } = await httpGet(port, '/e2e-http');
      expect(status).toBe(200);
      const cookies = headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies!.some(c => c.includes('socket-api-conn='))).toBe(true);
    });

    it('accepts WebSocket connections that forward the HTTP connection cookie', async () => {
      const { headers } = await httpGet(port, '/e2e-http');
      const parts = headers['set-cookie'];
      expect(parts).toBeDefined();
      const cookieHeader = parts!.map(c => c.split(';')[0]).join('; ');
      const c = new TestClient(port, socketName, undefined, { extraHeaders: { Cookie: cookieHeader } });
      await c.connect();
      const result = await c.call(testEndpoint, { foo: 'with-cookie' });
      expect(result).toEqual({ bar: 'with-cookie' });
      c.disconnect();
    });

    it('registers namespaces hook with the Socket.IO server', async () => {
      expect(lifecycleMocks.onRegisterNamespaces).toHaveBeenCalled();
      const io = lifecycleMocks.onRegisterNamespaces.mock.calls[0]![0]!;
      expect(io.sockets).toBeDefined();
    });
  });

  describe('actions', () => {
    it('calls action and receives typed response', async () => {
      const c = client();
      await c.connect();
      const result = await c.call(testEndpoint, { foo: 'hello' });
      expect(result).toEqual({ bar: 'hello' });
      expect(lifecycleMocks.onBeforeHandle).toHaveBeenCalled();
      c.disconnect();
    });

    it('passes through request data correctly', async () => {
      const c = client();
      await c.connect();
      const result = await c.call(testEndpoint, { foo: 'complex-value-123' });
      expect(result).toEqual({ bar: 'complex-value-123' });
      c.disconnect();
    });

    it('throws when action throws server-side', async () => {
      const c = client();
      await c.connect();
      await expect(c.call(testFailingAction as never)).rejects.toThrow('Intentional failure');
      c.disconnect();
    });

    it('server useAction invokes client handler and returns ack result', async () => {
      const c = client();
      await c.connect();
      const off = c.registerServerActionHandler(e2eClientEchoAction, async ({ v }) => ({ doubled: v * 2 }));
      const result = await c.call(e2eTriggerClientEchoAction, { v: 21 });
      expect(result).toEqual({ doubled: 42 });
      off();
      c.disconnect();
    });
  });

  describe('events', () => {
    it('delivers custom domain events with ack to the server', async () => {
      const c = client();
      const received: { tag: string }[] = [];
      const off = c.onEvent(e2eCustomDomainEvent, payload => {
        received.push(payload);
      });
      await c.connect();
      await c.call(e2eEmitDomainEventAction, { tag: 'ping' });
      await new Promise(r => setTimeout(r, 80));
      expect(received).toEqual([{ tag: 'ping' }]);
      off();
      c.disconnect();
    });

    it('fires socketAPIUserSignOut when the server emits it', async () => {
      const c = client();
      let count = 0;
      const off = c.onEvent(socketAPIUserSignOut, () => { count++; });
      await c.connect();
      await c.call(e2eAnnounceSignOutAction);
      await new Promise(r => setTimeout(r, 80));
      expect(count).toBe(1);
      off();
      c.disconnect();
    });
  });

  describe('authentication', () => {
    it('calls signIn and receives success', async () => {
      const c = client();
      await c.connect();
      const result = await c.call(signIn, { email: 'test@example.com', password: 'password' });
      expect(result).toBe(true);
      c.disconnect();
    });
  });

  describe('subscriptions', () => {
    it('subscribes and receives initial response', async () => {
      const c = client();
      await c.connect();
      const { initial } = await c.subscribe(tickSubscription, { intervalMs: 200 });
      expect(initial).toEqual({ count: 0 });
      c.disconnect();
    });

    it('receives streaming updates then unsubscribes', async () => {
      const c = client();
      await c.connect();

      const updates: { count: number; }[] = [];
      const { subscriptionId } = await c.subscribe(tickSubscription, { intervalMs: 50 });
      c.onSubscriptionUpdate(tickSubscription, subscriptionId, u => updates.push(u));

      await new Promise(r => setTimeout(r, 200));
      expect(updates.length).toBeGreaterThanOrEqual(2);

      const countBefore = updates.length;
      await c.unsubscribe(tickSubscription, subscriptionId);
      await new Promise(r => setTimeout(r, 150));
      expect(updates.length).toBe(countBefore);

      c.disconnect();
    });

    it('rejects subscribe when the handler throws', async () => {
      const c = client();
      await c.connect();
      await expect(c.subscribe(failSubscription, undefined)).rejects.toThrow('Intentional subscribe failure');
      c.disconnect();
    });

    it('rejects unsubscribe for an unknown subscription id', async () => {
      const c = client();
      await c.connect();
      await expect(c.unsubscribe(tickSubscription, 'no-such-subscription-id')).rejects.toThrow(/Unsubscribe handler not found/);
      c.disconnect();
    });

    it('supports two concurrent subscriptions on one socket', async () => {
      const c = client();
      await c.connect();
      const a: { count: number }[] = [];
      const b: { count: number }[] = [];
      const subA = await c.subscribe(tickSubscription, { intervalMs: 40 }, 'sub-a-concurrent');
      const subB = await c.subscribe(tickSubscription, { intervalMs: 40 }, 'sub-b-concurrent');
      c.onSubscriptionUpdate(tickSubscription, subA.subscriptionId, u => a.push(u));
      c.onSubscriptionUpdate(tickSubscription, subB.subscriptionId, u => b.push(u));
      await new Promise(r => setTimeout(r, 180));
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(b.length).toBeGreaterThanOrEqual(2);
      await c.unsubscribe(tickSubscription, subA.subscriptionId);
      await c.unsubscribe(tickSubscription, subB.subscriptionId);
      c.disconnect();
    });

    it('can subscribe again after unsubscribe', async () => {
      const c = client();
      await c.connect();
      const first = await c.subscribe(tickSubscription, { intervalMs: 60 }, 'sub-resub-a');
      const seen: number[] = [];
      c.onSubscriptionUpdate(tickSubscription, first.subscriptionId, u => seen.push(u.count));
      await new Promise(r => setTimeout(r, 100));
      await c.unsubscribe(tickSubscription, first.subscriptionId);
      const lenAfterUnsub = seen.length;
      await new Promise(r => setTimeout(r, 120));
      expect(seen.length).toBe(lenAfterUnsub);

      const second = await c.subscribe(tickSubscription, { intervalMs: 60 }, 'sub-resub-b');
      c.onSubscriptionUpdate(tickSubscription, second.subscriptionId, u => seen.push(u.count));
      await new Promise(r => setTimeout(r, 150));
      expect(seen.length).toBeGreaterThan(lenAfterUnsub);
      await c.unsubscribe(tickSubscription, second.subscriptionId);
      c.disconnect();
    });
  });

  describe('client logging service', () => {
    it('receives mxdb.log batches from the client', async () => {
      const c = client();
      await c.connect();
      const entry = { message: 'e2e-client-log', level: 3 } as LoggerEntry;
      c.emitClientLog([entry]);
      await new Promise(r => setTimeout(r, 100));
      expect(logCaptures.batches.length).toBeGreaterThanOrEqual(1);
      const flat = logCaptures.batches.flat();
      expect(flat.some(e => e.message === 'e2e-client-log')).toBe(true);
      c.disconnect();
    });
  });

  describe('full flow', () => {
    it('connects, signs in, calls action, then disconnects', async () => {
      const c = client();
      await c.connect();
      const signInResult = await c.call(signIn, { email: 'user@test.com', password: 'secret' });
      expect(signInResult).toBe(true);
      const actionResult = await c.call(testEndpoint, { foo: 'authenticated' });
      expect(actionResult).toEqual({ bar: 'authenticated' });
      c.disconnect();
    });
  });

  describe('connection robustness and load', () => {
    it(
      'does not successfully complete emitWithAck before connect (hangs, errors, or times out)',
      async () => {
        const c = client();
        expect(c.isConnected).toBe(false);
        const outcome = await settleOutcome(c.call(testEndpoint, { foo: 'no-connect' }), 8000);
        expect(outcome).not.toBe('fulfilled');
        c.disconnect();
      },
      { timeout: 12_000 },
    );

    it(
      'does not successfully complete emitWithAck after disconnect',
      async () => {
        const c = client();
        await c.connect();
        c.disconnect();
        await delay(40);
        expect(c.isConnected).toBe(false);
        const outcome = await settleOutcome(c.call(testEndpoint, { foo: 'after-disc' }), 8000);
        expect(outcome).not.toBe('fulfilled');
        c.disconnect();
      },
      { timeout: 12_000 },
    );

    it(
      'disconnect while a slow action is in-flight does not leave a fulfilled client ack; socket recovers',
      async () => {
        const c = client();
        await c.connect();
        const pending = c.call(e2eDelayedEchoAction, { foo: 'in-flight', delayMs: 1200 });
        await delay(60);
        c.disconnect();
        const mid = await settleOutcome(pending, 12_000);
        expect(mid).not.toBe('fulfilled');

        await c.connect();
        expect(await c.call(testEndpoint, { foo: 'after-reconnect' })).toEqual({ bar: 'after-reconnect' });
        c.disconnect();
      },
      { timeout: 25_000 },
    );

    it(
      'repeated connect → call → disconnect cycles stay consistent',
      async () => {
        const c = client();
        const iterations = 14;
        for (let i = 0; i < iterations; i++) {
          await c.connect();
          expect(c.isConnected).toBe(true);
          const label = `flap-${i}`;
          expect(await c.call(testEndpoint, { foo: label })).toEqual({ bar: label });
          c.disconnect();
          await delay(25);
          expect(c.isConnected).toBe(false);
        }
      },
      { timeout: 45_000 },
    );

    it(
      'many sockets each run parallel actions without cross-talk',
      async () => {
        const clientCount = 22;
        const callsPerClient = 5;
        const clients = Array.from({ length: clientCount }, () => client());
        await Promise.all(clients.map(cl => cl.connect()));
        const expectedBars: string[] = [];
        const tasks: Promise<{ bar: string }>[] = [];
        for (const cl of clients) {
          const sid = cl.rawSocket.id;
          for (let k = 0; k < callsPerClient; k++) {
            const foo = `${sid}-${k}`;
            expectedBars.push(foo);
            tasks.push(cl.call(testEndpoint, { foo }));
          }
        }
        const results = await Promise.all(tasks);
        expect(results).toHaveLength(expectedBars.length);
        for (let i = 0; i < results.length; i++) {
          expect(results[i]).toEqual({ bar: expectedBars[i] });
        }
        clients.forEach(cl => cl.disconnect());
      },
      { timeout: 60_000 },
    );

    it(
      'single socket tolerates a large parallel burst of actions',
      async () => {
        const c = client();
        await c.connect();
        const burst = 64;
        const results = await Promise.all(
          Array.from({ length: burst }, (_, k) => c.call(testEndpoint, { foo: `burst-${k}` })),
        );
        expect(results).toHaveLength(burst);
        for (let k = 0; k < burst; k++) {
          expect(results[k]).toEqual({ bar: `burst-${k}` });
        }
        c.disconnect();
      },
      { timeout: 45_000 },
    );
  });

  // ─── T4: Impersonation ──────────────────────────────────────────────────────

  describe('impersonation', () => {
    it('impersonateUser makes getUser() return the impersonated user inside the scope', async () => {
      const c = client();
      await c.connect();
      const result = await c.call(e2eImpersonateAction, { userId: 'impersonated-id' });
      expect(result).toBe('impersonated-id');
      c.disconnect();
    });

    it('impersonateUser does not affect getUser() outside the impersonation scope', async () => {
      const c = client();
      await c.connect();
      // Authenticate first so the real user is set.
      await c.call(signIn, { email: 'user@test.com', password: 'x' });
      await delay(50);
      const realId = await c.call(e2eGetUserIdAction);
      expect(typeof realId).toBe('string');

      // Impersonate a different user.
      await c.call(e2eImpersonateAction, { userId: 'impersonated-id' });

      // Real user should be unchanged after impersonation scope ends.
      const afterId = await c.call(e2eGetUserIdAction);
      expect(afterId).toBe(realId);
      c.disconnect();
    });
  });

  // ─── T5: Missing scenarios ──────────────────────────────────────────────────

  describe('onBeforeHandle error propagation', () => {
    it('when onBeforeHandle throws, the client receives an error — not a hang', async () => {
      lifecycleMocks.onBeforeHandle.mockRejectedValueOnce(new Error('before-handle-boom'));
      const c = client();
      await c.connect();
      await expect(c.call(testEndpoint, { foo: 'x' })).rejects.toThrow('before-handle-boom');
      c.disconnect();
    });

    it('subsequent calls succeed after a single onBeforeHandle failure', async () => {
      lifecycleMocks.onBeforeHandle.mockRejectedValueOnce(new Error('transient-failure'));
      const c = client();
      await c.connect();
      await expect(c.call(testEndpoint, { foo: 'first' })).rejects.toThrow();
      // Next call succeeds because the mock is only set to fail once.
      expect(await c.call(testEndpoint, { foo: 'second' })).toEqual({ bar: 'second' });
      c.disconnect();
    });
  });

  describe('subscription update() after unsubscribe', () => {
    it('server-side update() after client unsubscribes does not crash and is not received', async () => {
      const c = client();
      await c.connect();
      const updates: number[] = [];
      const { subscriptionId } = await c.subscribe(e2eLateUpdateSubscription, undefined);
      c.onSubscriptionUpdate(e2eLateUpdateSubscription, subscriptionId, u => updates.push(u.seq));
      // Immediately unsubscribe before the delayed server update fires.
      await c.unsubscribe(e2eLateUpdateSubscription, subscriptionId);
      // Wait long enough for the server's delayed update to have fired.
      await delay(350);
      // The client should have seen seq=1 (initial) but NOT seq=2 (post-unsubscribe server push).
      expect(updates.includes(2)).toBe(false);
      c.disconnect();
    });
  });

});
