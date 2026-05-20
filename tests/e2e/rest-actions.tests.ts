import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { createServerActionHandler } from '../../src/server/actions';
import { defineAction } from '../../src/common/defineAction';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord } from '../../src/common/auth';
import type { NexusAccount } from '../../src/common/models';
import { clearRestActionRegistry } from '../../src/server/actions/restActionRegistry';

interface TestUser { id: string; email: string; }
interface TestCreds { email: string; password: string; }

// Auth store
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
const users: Record<string, TestUser> = { 'test@test.com': { id: 'user-1', email: 'test@test.com' } };
const { configureAuthentication } = defineAuthentication<TestUser, NexusAccount, TestCreds>();

// Actions — defined at module level so they can be used in tests
const echoAction = defineAction<{ message: string }, { echo: string }>()('echo', { isPublic: true });
const secretAction = defineAction<{ value: number }, { doubled: number }>()('secret');
const getUserAction = defineAction<{ id: string }, TestUser>()('getUser', {
  isPublic: true,
  rest: { method: 'GET', url: '/users/:id' },
});
const createItemAction = defineAction<{ name: string; count: number }, { created: boolean }>()('createItem', {
  isPublic: true,
  rest: { method: 'POST', url: '/items' },
});

describe('REST actions integration', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => records.clear());

  beforeAll(async () => {
    // Clear registry before setting up to ensure test isolation
    clearRestActionRegistry();

    const actions = [
      createServerActionHandler(echoAction, async ({ message }) => ({ echo: message })),
      createServerActionHandler(secretAction, async ({ value }) => ({ doubled: value * 2 })),
      createServerActionHandler(getUserAction, async ({ id }) => ({ id, email: `${id}@test.com` })),
      createServerActionHandler(createItemAction, async ({ name: _name, count: _count }) => ({ created: true })),
    ];

    server = http.createServer();
    await startServer({
      name: 'rest-test',
      logger: new Logger('rest-test'),
      server,
      auth: configureAuthentication({
        mode: 'jwt',
        store,
        onAuthenticate: async ({ email, password }) => password === 'correct' ? users[email] : undefined,
        onGetUser: async (userId) => Object.values<TestUser>(users).find(u => u.id === userId),
      }),
      actions,
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  }, 15_000);

  afterAll(() => { server?.close(); });

  // --- Catch-all ---

  it('catch-all: returns 200 and response for public action', async () => {
    const res = await fetch(`http://localhost:${port}/rest-test/actions/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ echo: 'hello' });
  });

  it('catch-all: returns 401 for non-public action without session', async () => {
    const res = await fetch(`http://localhost:${port}/rest-test/actions/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it('catch-all: returns 200 for non-public action with valid session', async () => {
    // Sign in first to get a session cookie
    const signinRes = await fetch(`http://localhost:${port}/rest-test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'correct', deviceId: 'dev-rest', deviceDetails: {} }),
    });
    expect(signinRes.status).toBe(200);
    const rawCookie = signinRes.headers.get('set-cookie') ?? '';
    const token = rawCookie.match(/socketapi_session=([^;]+)/)?.[1] ?? '';
    expect(token).toBeTruthy();

    const res = await fetch(`http://localhost:${port}/rest-test/actions/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `socketapi_session=${token}` },
      body: JSON.stringify({ value: 7 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ doubled: 14 });
  });

  it('catch-all: returns 404 for unknown action', async () => {
    const res = await fetch(`http://localhost:${port}/rest-test/actions/noSuchAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  // --- Explicit routes ---

  it('explicit GET route: extracts path param into request', async () => {
    const res = await fetch(`http://localhost:${port}/users/user-42`, { method: 'GET' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ id: 'user-42', email: 'user-42@test.com' });
  });

  it('explicit POST route: merges body into request', async () => {
    const res = await fetch(`http://localhost:${port}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'widget', count: 3 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ created: true });
  });
});
