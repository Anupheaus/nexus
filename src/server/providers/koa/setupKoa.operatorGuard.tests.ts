import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import Router from '@koa/router';
import { setupKoa } from './setupKoa';
import { ConnectionRegistry } from '../connection';
import { registerRestActions } from '../../actions/registerRestActions';
import type { NexusServerAction } from '../../actions/createServerActionHandler';
import { setConfig, setLogger } from '../../async-context/nexusContext';
import { resolveSecurityConfig, REFUSED_OPERATOR_MESSAGE } from '../../security';
import { defineAction } from '../../../common';
import { googleStartAction, signInAction, webauthnInviteAction, webauthnRegisterAction } from '../../../common/internalActions';

/**
 * sc-633 — the operator-key guard `setupKoa` puts ahead of every route, driven over real HTTP through the real Koa
 * stack: the catch-all action route, an action's explicit REST routes (GET query, POST body), nexus's own auth routes
 * (registered the same way), and a route the app registers itself (as mxdb's `/mcp` and Vision's webhooks are).
 */

const mockLogger: any = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), silly: vi.fn(), debug: vi.fn() };
mockLogger.createSubLogger = () => mockLogger;

const handled = vi.fn();
const limitGate = { run: async (fn: () => unknown) => fn() };
const serverAction = (action: { name: string }): NexusServerAction => ({
  registerSocket: vi.fn(),
  restEntry: { action: action as any, handler: (async (request: unknown) => { handled(action.name, request); return { ok: true }; }) as any, limitGate: limitGate as any },
});

const echoAction = defineAction<{ value: string }, { ok: boolean }>()('guardEcho', { isPublic: true });
const findUserAction = defineAction<{ id: string }, { ok: boolean }>()('guardFindUser', { isPublic: true, rest: { method: 'GET', url: '/api/users/:id' } });
const createItemAction = defineAction<{ title: string }, { ok: boolean }>()('guardCreateItem', { isPublic: true, rest: { method: 'POST', url: '/api/items' } });

/** One route of each family, and how to send it a payload. */
const ROUTES: { family: string; method: 'GET' | 'POST'; path: string }[] = [
  { family: 'catch-all action', method: 'POST', path: '/test/actions/guardEcho' },
  { family: 'explicit REST GET', method: 'GET', path: '/api/users/u1' },
  { family: 'explicit REST POST', method: 'POST', path: '/api/items' },
  { family: 'nexus auth: sign in', method: 'POST', path: '/test/socketAPI/signin' },
  { family: 'nexus auth: WebAuthn invite', method: 'GET', path: '/test/socketAPI/webauthn/invite' },
  { family: 'nexus auth: WebAuthn register', method: 'POST', path: '/test/socketAPI/webauthn/register' },
  { family: 'nexus auth: Google start', method: 'POST', path: '/test/socketAPI/google/start' },
  { family: 'app route (mxdb /mcp, a webhook)', method: 'POST', path: '/webhooks/inbound' },
];

const OPERATOR_PAYLOADS: Record<string, unknown>[] = [
  { value: { $ne: null } },
  { value: { $gt: '' } },
  { value: { $exists: true } },
  { list: [{ id: { $in: ['a'] } }] },
  { $where: 'sleep(1000)' },
  { 'address.postcode': 'DE1' },
  // An `@error` object — which `to.deserialise` would turn into an Error, hiding what is inside from later checks
  { value: { '@error': { message: 'x', meta: { $ne: null } } } },
];

interface Reply { status: number; body: string; }

function send(port: number, { method, path, body, contentType = 'application/json' }: { method: string; path: string; body?: string; contentType?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, headers: body == null ? {} : { 'content-type': contentType, 'content-length': Buffer.byteLength(body) } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

async function startApp(isDottedKeyAllowed?: (request: { path: string; method: string }) => boolean): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  const registry = new ConnectionRegistry();
  const app = setupKoa(server, registry, resolveSecurityConfig({ rateLimit: false, securityHeaders: false, trustedProxyHops: 0, operatorKeys: { isDottedKeyAllowed } }));
  const router = new Router();
  registerRestActions(router, 'test', registry, [echoAction, findUserAction, createItemAction, signInAction, webauthnInviteAction, webauthnRegisterAction, googleStartAction].map(serverAction));
  router.post('/webhooks/inbound', ctx => { handled('webhook', (ctx.request as unknown as { body: unknown }).body); ctx.body = { ok: true }; });
  app.use(router.routes());
  const port = await new Promise<number>(resolve => { server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)); });
  return { server, port };
}

describe('the operator-key guard ahead of every route (sc-633)', () => {
  let app: { server: http.Server; port: number };

  beforeAll(async () => {
    setConfig({ name: 'test', server: {} as any });
    setLogger(mockLogger as never);
    app = await startApp(({ path }) => path.startsWith('/webhooks/'));
  });

  afterAll(async () => {
    await new Promise<void>(resolve => { app.server.close(() => resolve()); });
  });

  beforeEach(() => {
    handled.mockClear();
    mockLogger.warn.mockClear();
  });

  it('lets an ordinary request through to every route family', async () => {
    for (const { family, method, path } of ROUTES) {
      const reply = method === 'GET'
        ? await send(app.port, { method, path: `${path}?value=plain` })
        : await send(app.port, { method, path, body: JSON.stringify({ value: 'plain', when: '2026-09-29T10:00:00.000Z' }) });
      expect({ family, refused: reply.body.includes(REFUSED_OPERATOR_MESSAGE) }).toEqual({ family, refused: false });
    }
  });

  it.each(OPERATOR_PAYLOADS.filter(payload => !Object.keys(payload).some(key => key.includes('.'))))('refuses %j (400) in the body of every POST route family, before any handler', async payload => {
    for (const { family, method, path } of ROUTES.filter(route => route.method === 'POST')) {
      const reply = await send(app.port, { method, path, body: JSON.stringify(payload) });
      expect({ family, status: reply.status }).toEqual({ family, status: 400 });
      expect(JSON.parse(reply.body)).toEqual({ error: { message: REFUSED_OPERATOR_MESSAGE } });
    }
    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses a $ key in the query string of every route family (Koa reads the query flat, so that is how one arrives)', async () => {
    for (const { family, method, path } of ROUTES) {
      const reply = await send(app.port, { method, path: `${path}?%24where=sleep`, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect({ family, status: reply.status }).toEqual({ family, status: 400 });
    }
    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses a qs-parsed form body that nests an operator', async () => {
    const reply = await send(app.port, { method: 'POST', path: '/test/socketAPI/signin', body: 'token[$ne]=x', contentType: 'application/x-www-form-urlencoded' });
    expect(reply.status).toBe(400);
    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses a dotted key on every route that has not been allowed one', async () => {
    for (const { family, method, path } of ROUTES.filter(route => !route.path.startsWith('/webhooks/'))) {
      const reply = method === 'GET'
        ? await send(app.port, { method, path: `${path}?${encodeURIComponent('address.postcode')}=DE1` })
        : await send(app.port, { method, path, body: JSON.stringify({ 'address.postcode': 'DE1' }) });
      expect({ family, status: reply.status }).toEqual({ family, status: 400 });
    }
    expect(handled).not.toHaveBeenCalled();
  });

  it('lets an allow-listed webhook carry dotted keys — but never a $ key', async () => {
    const dotted = await send(app.port, { method: 'POST', path: '/webhooks/inbound', body: JSON.stringify({ items: [{ Headers: { 'X-Mailer.Id': 'a' } }] }) });
    const dottedQuery = await send(app.port, { method: 'POST', path: `/webhooks/inbound?${encodeURIComponent('hub.mode')}=subscribe`, body: '{}' });
    const operator = await send(app.port, { method: 'POST', path: '/webhooks/inbound', body: JSON.stringify({ items: [{ Headers: { $where: 'x' } }] }) });
    expect([dotted.status, dottedQuery.status, operator.status]).toEqual([200, 200, 400]);
    expect(handled).toHaveBeenCalledTimes(2);
  });

  it('logs each refusal as an operator-injection security event', async () => {
    await send(app.port, { method: 'POST', path: '/test/actions/guardEcho', body: JSON.stringify({ value: { $ne: null } }) });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ securityEvent: 'operator-injection', key: 'body.value.$ne', path: '/test/actions/guardEcho' }));
  });
});
