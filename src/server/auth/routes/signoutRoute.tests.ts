import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { createSignoutRoute } from './signoutRoute';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../../common/auth';

function makeStore(record?: SocketAPIAuthRecord): SocketAPIAuthStore<SocketAPIAuthRecord> {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

async function makeServer(store: SocketAPIAuthStore<SocketAPIAuthRecord>) {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());
  createSignoutRoute(router, 'test', store);
  app.use(router.routes());
  const server = http.createServer(app.callback());
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port as number;
  return { server, port };
}

describe('signoutRoute', () => {
  it('returns 200 and clears cookie even when no cookie present', async () => {
    const store = makeStore(undefined);
    const { server, port } = await makeServer(store);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('socketapi_session=;');
    expect(setCookie).toContain('Max-Age=0');
    server.close();
  });

  it('disables the store record when a valid cookie is present', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const { server, port } = await makeServer(store);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signout`, {
      method: 'POST',
      headers: { Cookie: 'socketapi_session=tok' },
    });
    expect(res.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', { isEnabled: false });
    server.close();
  });
});
