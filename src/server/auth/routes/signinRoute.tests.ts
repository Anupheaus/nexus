import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { createSigninRoute } from './signinRoute';
import type { JwtAuthStore, JwtAuthRecord } from '../../../common/auth';
import type { SocketAPIUser } from '../../../common';

const testUser: SocketAPIUser = { id: 'user-1' };

function makeStore(existingRecord?: JwtAuthRecord): JwtAuthStore {
  return {
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => existingRecord),
    findBySessionToken: vi.fn(async () => existingRecord),
    findByDevice: vi.fn(async () => existingRecord),
    update: vi.fn(async () => {}),
  };
}

async function makeServer(store: JwtAuthStore, onAuthenticate: (creds: unknown) => Promise<SocketAPIUser | undefined>) {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());
  createSigninRoute(router, 'test', store, onAuthenticate);
  app.use(router.routes());
  const server = http.createServer(app.callback());
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port as number;
  return { server, port };
}

describe('signinRoute', () => {
  it('returns 401 when onAuthenticate returns undefined', async () => {
    const store = makeStore();
    const { server, port } = await makeServer(store, async () => undefined);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bad@test.com', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 200 and sets HttpOnly cookie when credentials are valid (new device)', async () => {
    const store = makeStore(undefined); // findByDevice returns undefined → create
    const { server, port } = await makeServer(store, async () => testUser);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'good@test.com', password: 'correct', deviceId: 'dev-1', deviceDetails: {} }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('socketapi_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(store.create).toHaveBeenCalledOnce();
    server.close();
  });

  it('updates existing record when device already has a session', async () => {
    const existing: JwtAuthRecord = { requestId: 'r1', sessionToken: 'old', userId: 'user-1', deviceId: 'dev-1', isEnabled: true };
    const store = makeStore(existing); // findByDevice returns existing
    const { server, port } = await makeServer(store, async () => testUser);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'good@test.com', password: 'correct', deviceId: 'dev-1', deviceDetails: {} }),
    });
    expect(res.status).toBe(200);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ sessionToken: expect.any(String), isEnabled: true }));
    server.close();
  });

  it('sets the Secure flag on the session cookie', async () => {
    const store = makeStore(undefined);
    const { server, port } = await makeServer(store, async () => testUser);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'good@test.com', password: 'correct', deviceId: 'dev-1' }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Secure');
    server.close();
  });

  it('returns 500 when onAuthenticate throws', async () => {
    const store = makeStore(undefined);
    const { server, port } = await makeServer(store, async () => { throw new Error('auth-service-down'); });
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'any@test.com', password: 'any' }),
    });
    // Koa default error handler returns 500 for unhandled throws
    expect(res.status).toBe(500);
    server.close();
  });
});
