import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { registerRestActions } from './registerRestActions';
import { registerRestAction, clearRestActionRegistry } from './restActionRegistry';
import { setAuthConfig, clearAuthConfig } from '../auth/authConfig';
import { ConnectionRegistry } from '../providers/connection';
import { setConfig } from '../async-context/socketApiContext';
import { defineAction } from '../../common';
import type { JwtAuthStore, JwtAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

const echoAction = defineAction<{ value: string }, { value: string }>()('restEcho');
const getUserAction = defineAction<{ id: string }, { name: string }>()('restGetUser', {
  rest: { method: 'GET', url: '/api/users/:id' },
});
const createItemAction = defineAction<{ title: string }, { id: string }>()('restCreateItem', {
  rest: { method: 'POST', url: '/api/items' },
});

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

async function makeApp(opts?: { auth?: boolean; sessionToken?: string }): Promise<{ server: http.Server; port: number }> {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());

  const registry = new ConnectionRegistry();

  if (opts?.auth) {
    const user: SocketAPIUser = { id: 'u-1' };
    const store = makeStore(opts.sessionToken);
    const authConfig = {
      mode: 'jwt' as const,
      store,
      onAuthenticate: async () => user,
      onGetUser: async () => user,
      syncUserToClient: false,
    };
    setAuthConfig(authConfig);
    // executeRestEntry reads auth from useConfig(), so we must include it in ServerConfig
    setConfig({ name: 'test', server: {} as any, auth: authConfig });
  }

  registerRestActions(router, 'test', registry);
  app.use(router.routes());

  const server = http.createServer(app.callback());
  const port = await new Promise<number>(resolve => {
    server.listen(0, () => resolve((server.address() as any).port));
  });
  return { server, port };
}

describe('registerRestActions', () => {
  const limitGate = { run: async (fn: () => unknown) => fn() };

  beforeEach(() => {
    // setConfig must be called so that useConfig() inside executeRestEntry does not throw
    setConfig({
      name: 'test',
      server: {} as any,
    });
    clearRestActionRegistry();
    clearAuthConfig();
    registerRestAction(echoAction, async (req: { value: string }) => ({ value: req.value }), limitGate as any);
    registerRestAction(getUserAction, async (req: { id: string }) => ({ name: `User ${req.id}` }), limitGate as any);
    registerRestAction(createItemAction, async (req: { title: string }) => ({ id: `item-${req.title}` }), limitGate as any);
  });

  afterEach(() => {
    clearRestActionRegistry();
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

  it('catch-all: returns 400 when handler throws', async () => {
    clearRestActionRegistry();
    registerRestAction(echoAction, async () => { throw new Error('handler-fail'); }, limitGate as any);
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(400);
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
      headers: { 'Content-Type': 'application/json', Cookie: 'socketapi_session=valid-tok' },
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
    clearRestActionRegistry();
    const coerceAction = defineAction<{ active: boolean; count: number }, void>()('coerceTest', {
      rest: { method: 'GET', url: '/api/coerce' },
    });
    const received: unknown[] = [];
    registerRestAction(coerceAction, async (req: unknown) => { received.push(req); }, limitGate as any);
    const { server, port } = await makeApp();
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
});
