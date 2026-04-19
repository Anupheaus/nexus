import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord } from '../../src/common/auth';

interface TestUser { id: string; email: string; }
interface TestCreds { email: string; password: string; }

const users: Record<string, TestUser> = {
  'test@test.com': { id: 'user-1', email: 'test@test.com' },
};

const records: Map<string, JwtAuthRecord> = new Map();

const store: JwtAuthStore = {
  async create(r) { records.set(r.requestId, { ...r }); },
  async findById(id) { return records.get(id); },
  async findBySessionToken(t) { return [...records.values()].find(r => r.sessionToken === t); },
  async findByDevice(userId, deviceId) { return [...records.values()].find(r => r.userId === userId && r.deviceId === deviceId); },
  async update(id, patch) {
    const r = records.get(id);
    if (r) records.set(id, { ...r, ...patch });
  },
};

const { configureAuthentication } = defineAuthentication<TestUser, TestCreds>();

describe('JWT auth integration', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => records.clear());

  beforeAll(async () => {
    server = http.createServer();
    await startServer({
      name: 'e2e-auth',
      logger: new Logger('e2e'),
      server,
      auth: configureAuthentication({
        mode: 'jwt',
        store,
        onAuthenticate: async ({ email, password }) => {
          if (password === 'correct') return users[email];
          return undefined;
        },
        onGetUser: async (userId) => Object.values(users).find(u => u.id === userId),
      }),
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  }, 15_000);

  afterAll(() => server?.close());

  it('POST /signin returns 401 for wrong password', async () => {
    const res = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'wrong', deviceId: 'dev-e2e', deviceDetails: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /signin returns 200 and Set-Cookie for correct credentials', async () => {
    const res = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'correct', deviceId: 'dev-e2e', deviceDetails: {} }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('socketapi_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST /signout returns 200 and clears cookie', async () => {
    // First sign in to get a token
    const signinRes = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'correct', deviceId: 'dev-signout', deviceDetails: {} }),
    });
    const rawCookie = signinRes.headers.get('set-cookie') ?? '';
    const token = rawCookie.match(/socketapi_session=([^;]+)/)?.[1] ?? '';
    expect(token).toBeTruthy();

    const signoutRes = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signout`, {
      method: 'POST',
      headers: { Cookie: `socketapi_session=${token}` },
    });
    expect(signoutRes.status).toBe(200);
    const clearCookie = signoutRes.headers.get('set-cookie') ?? '';
    expect(clearCookie).toContain('Max-Age=0');

    // Verify record is disabled
    const record = [...records.values()].find(r => r.sessionToken === token);
    expect(record?.isEnabled).toBe(false);
  });
});
