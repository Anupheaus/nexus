import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { registerRestActions } from './registerRestActions';
import type { NexusServerAction } from './createServerActionHandler';
import { setAuthConfig, clearAuthConfig } from '../auth/authConfig';
import { ConnectionRegistry } from '../providers/connection';
import { setConfig } from '../async-context/nexusContext';
import { RateLimiter } from '../security/RateLimiter';
import { createSecurityMiddleware } from '../security/createSecurityMiddleware';
import { resolveSecurityConfig } from '../security/SecurityConfig';
import { defineAction } from '../../common';
import type { JwtAuthStore, JwtAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';
import { AuthenticationError, NotImplementedError } from '@anupheaus/common';

const echoAction = defineAction<{ value: string }, { value: string }>()('restEcho');
const getUserAction = defineAction<{ id: string }, { name: string }>()('restGetUser', {
  rest: { method: 'GET', url: '/api/users/:id' },
});
const createItemAction = defineAction<{ title: string }, { id: string }>()('restCreateItem', {
  rest: { method: 'POST', url: '/api/items' },
});
const socketOnlyAction = defineAction<{ value: string }, { value: string }>()('socketOnlyAction', {
  transport: ['socket'],
});
const redirectAction = defineAction<void, void>()('redirectAction');
const authErrAction = defineAction<void, void>()('authErrAction');
const notFoundAction = defineAction<void, void>()('notFoundAction');

const limitGate = { run: async (fn: () => unknown) => fn() };

function makeServerAction<Req, Res>(
  action: ReturnType<ReturnType<typeof defineAction<Req, Res>>>,
  handler: (req: Req, utils: any) => unknown,
): NexusServerAction {
  return {
    registerSocket: vi.fn(),
    restEntry: { action: action as any, handler: handler as any, limitGate: limitGate as any },
  };
}

function makeRateLimitedServerAction<Req, Res>(
  action: ReturnType<ReturnType<typeof defineAction<Req, Res>>>,
  handler: (req: Req, utils: any) => unknown,
  opts: { maxRequests: number; windowMs: number; message?: string },
): NexusServerAction {
  return {
    registerSocket: vi.fn(),
    restEntry: {
      action: action as any, handler: handler as any, limitGate: limitGate as any,
      rateLimiter: new RateLimiter(opts.maxRequests, opts.windowMs),
      rateLimitMessage: opts.message,
    },
  };
}

const allActions: NexusServerAction[] = [
  makeServerAction(echoAction, async (req: { value: string }) => ({ value: req.value })),
  makeServerAction(getUserAction, async (req: { id: string }) => ({ name: `User ${req.id}` })),
  makeServerAction(createItemAction, async (req: { title: string }) => ({ id: `item-${req.title}` })),
  makeServerAction(socketOnlyAction, async (req: { value: string }) => ({ value: req.value })),
  makeServerAction(redirectAction, (_req: unknown, { redirect }: any) => redirect('/new-location')),
  makeServerAction(authErrAction, async () => { throw new AuthenticationError({ message: 'Unauthorized' }); }),
  makeServerAction(notFoundAction, async () => { throw new NotImplementedError('not here'); }),
];

function makeStore(sessionToken?: string, userId = 'u-1', isEnabled = true): JwtAuthStore {
  const record: JwtAuthRecord | undefined = sessionToken
    ? { requestId: 'r1', sessionToken, userId, deviceId: 'd1', isEnabled }
    : undefined;
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionToken: vi.fn(async (token: string) =>
      token === sessionToken ? record : undefined,
    ),
    findByDevice: vi.fn(),
    update: vi.fn(async () => {}),
  };
}

async function makeApp(opts?: {
  auth?: boolean;
  sessionToken?: string;
  actions?: NexusServerAction[];
  proxy?: boolean;
}): Promise<{ server: http.Server; port: number }> {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());
  // Apply the real security middleware so the per-action limiter can read the resolved trustedProxyHops
  // (1 here) and derive the client IP from X-Forwarded-For — mirroring production behind one proxy.
  if (opts?.proxy) {
    app.use(createSecurityMiddleware(
      resolveSecurityConfig({ trustedProxyHops: 1, rateLimit: false, securityHeaders: false }),
      app,
    ));
  }

  const registry = new ConnectionRegistry();

  if (opts?.auth) {
    const user: NexusUser = { id: 'u-1' };
    const store = makeStore(opts.sessionToken);
    const authConfig = {
      mode: 'jwt' as const,
      store,
      onAuthenticate: async () => user,
      onGetUser: async () => user,
      syncUserToClient: false,
    };
    setAuthConfig(authConfig);
    setConfig({ name: 'test', server: {} as any, auth: authConfig });
  }

  registerRestActions(router, 'test', registry, opts?.actions ?? allActions);
  app.use(router.routes());

  const server = http.createServer(app.callback());
  const port = await new Promise<number>(resolve => {
    server.listen(0, () => resolve((server.address() as any).port));
  });
  return { server, port };
}

describe('registerRestActions', () => {
  beforeEach(() => {
    setConfig({ name: 'test', server: {} as any });
    clearAuthConfig();
  });

  afterEach(() => {
    clearAuthConfig();
  });

  // ── catch-all POST route ────────────────────────────────────────────────────

  it('catch-all: returns 404 for unknown action', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/unknown`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
    server.close();
  });

  it('catch-all: invokes handler and returns 200 with result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ping' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: 'ping' });
    server.close();
  });

  it('catch-all: returns 500 when handler throws a plain error', async () => {
    const failingActions = [
      makeServerAction(echoAction, async () => { throw new Error('handler-fail'); }),
    ];
    const { server, port } = await makeApp({ actions: failingActions });
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toBe('handler-fail');
    server.close();
  });

  // ── auth gate ──────────────────────────────────────────────────────────────

  it('returns 401 when auth is configured and no session cookie', async () => {
    const { server, port } = await makeApp({ auth: true });
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 200 when auth is configured and valid session cookie provided', async () => {
    const { server, port } = await makeApp({ auth: true, sessionToken: 'valid-tok' });
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'nexus_session=valid-tok' },
      body: JSON.stringify({ value: 'hi' }),
    });
    expect(res.status).toBe(200);
    server.close();
  });

  // ── explicit GET route with path params ────────────────────────────────────

  it('explicit GET route: substitutes path param and returns result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/api/users/u-42`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'User u-42' });
    server.close();
  });

  it('explicit GET route: coerces query param types (number, boolean)', async () => {
    const coerceAction = defineAction<{ active: boolean; count: number }, void>()('coerceTest', {
      rest: { method: 'GET', url: '/api/coerce' },
    });
    const received: unknown[] = [];
    const coerceServerAction = makeServerAction(coerceAction, async (req: unknown) => { received.push(req); });
    const { server, port } = await makeApp({ actions: [coerceServerAction] });
    await fetch(`http://localhost:${port}/api/coerce?active=true&count=42`);
    expect(received[0]).toEqual({ active: true, count: 42 });
    server.close();
  });

  // ── explicit POST route ────────────────────────────────────────────────────

  it('explicit POST route: reads body and returns result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'item-Hello' });
    server.close();
  });

  // ── transport enforcement ──────────────────────────────────────────────────

  it('returns 405 when action transport excludes rest', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/socketOnlyAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(405);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('socket');
    server.close();
  });

  // ── redirect ───────────────────────────────────────────────────────────────

  it('returns 302 with location header when handler returns redirect result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/redirectAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/new-location');
    server.close();
  });

  // ── error status codes from typed errors ──────────────────────────────────

  it('returns 401 when handler throws AuthenticationError', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/authErrAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 404 when handler throws NotImplementedError', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/notFoundAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
    server.close();
  });

  // ── only registered actions are reachable ─────────────────────────────────

  it('action not in the provided array returns 404 even if it exists elsewhere', async () => {
    const { server, port } = await makeApp({ actions: [] });
    const res = await fetch(`http://localhost:${port}/test/actions/otherAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
    server.close();
  });

  // ── per-IP rate limiting ───────────────────────────────────────────────────

  const rlAction = defineAction<{ value: string }, { value: string }>()('rlAction', {
    isPublic: true,
    server: { rateLimit: { maxRequests: 2, windowMs: 60_000, message: 'slow down please' } },
  });

  function postRl(port: number, ip?: string): Promise<Response> {
    return fetch(`http://localhost:${port}/test/actions/rlAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ip != null ? { 'X-Forwarded-For': ip } : {}) },
      body: JSON.stringify({ value: 'x' }),
    });
  }

  it('rate limit: allows up to maxRequests then returns 429 with the configured message', async () => {
    const actions = [makeRateLimitedServerAction(rlAction, async (req: { value: string }) => req, { maxRequests: 2, windowMs: 60_000, message: 'slow down please' })];
    const { server, port } = await makeApp({ actions });
    expect((await postRl(port)).status).toBe(200);
    expect((await postRl(port)).status).toBe(200);
    const blocked = await postRl(port);
    expect(blocked.status).toBe(429);
    expect((await blocked.json() as { error: { message: string } }).error.message).toBe('slow down please');
    server.close();
  });

  it('rate limit: limits each IP independently', async () => {
    const actions = [makeRateLimitedServerAction(rlAction, async (req: { value: string }) => req, { maxRequests: 2, windowMs: 60_000 })];
    const { server, port } = await makeApp({ actions, proxy: true });
    // IP A exhausts its window…
    expect((await postRl(port, '10.0.0.1')).status).toBe(200);
    expect((await postRl(port, '10.0.0.1')).status).toBe(200);
    expect((await postRl(port, '10.0.0.1')).status).toBe(429);
    // …while IP B is still free.
    expect((await postRl(port, '10.0.0.2')).status).toBe(200);
    server.close();
  });

  it('rate limit: an action without server.rateLimit is never throttled', async () => {
    const { server, port } = await makeApp();
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'ping' }),
      });
      expect(res.status).toBe(200);
    }
    server.close();
  });
});
