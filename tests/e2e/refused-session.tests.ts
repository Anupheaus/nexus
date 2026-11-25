/**
 * A socket whose session is refused must not carry on as the user an earlier socket of the same browser signed in
 * (Vision: a disabled device got straight back in after a reload).
 *
 * The signed-in user is kept on the browser's connection (the `nexus-conn` cookie), which outlives its sockets. These
 * tests sign in over REST like a browser, connect with both cookies, then refuse the session and connect again.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import { randomUUID } from 'crypto';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord } from '../../src/common/auth';
import { defineAction } from '../../src/common/defineAction';
import { createServerActionHandler } from '../../src/server/actions';
import { clearRestActionRegistry } from '../../src/server/actions/restActionRegistry';
import { TestClient } from './TestClient';

interface TestUser { id: string; email: string; }
interface TestCreds { email: string; password: string; }

const SOCKET_NAME = 'e2e-refused-session';
const USER: TestUser = { id: 'user-refused', email: 'refused@test.com' };

// Names must be unique across every startServer call in this Vitest process.
const privateSecretAction = defineAction<void, string>()('refusedSessionPrivateSecret');

const records: Map<string, JwtAuthRecord> = new Map();

const store: JwtAuthStore = {
  async create(record) { records.set(record.requestId, { ...record }); },
  async findById(id) { return records.get(id); },
  async findBySessionToken(token) { return [...records.values()].find(record => record.sessionToken === token); },
  async findByDevice(userId, deviceId) { return [...records.values()].find(record => record.userId === userId && record.deviceId === deviceId); },
  async update(id, patch) {
    const record = records.get(id);
    if (record) records.set(id, { ...record, ...patch });
  },
};

const { configureAuthentication } = defineAuthentication<TestUser, never, TestCreds>();

interface ConnectionRefusal {
  message: string;
  data?: { reason?: string };
}

describe('a refused session does not leave the browser signed in', () => {
  let server: http.Server;
  let port: number;
  const openClients: TestClient[] = [];

  beforeEach(() => records.clear());

  beforeAll(async () => {
    clearRestActionRegistry();
    server = http.createServer();
    await startServer({
      name: SOCKET_NAME,
      logger: new Logger('e2e-refused-session'),
      server,
      auth: configureAuthentication({
        mode: 'jwt',
        store,
        onAuthenticate: async ({ email, password }) => (email === USER.email && password === 'correct' ? USER : undefined),
        onGetUser: async userId => (userId === USER.id ? USER : undefined),
      }),
      actions: [createServerActionHandler(privateSecretAction, async () => 'secret')],
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  }, 15_000);

  afterAll(() => {
    openClients.forEach(client => client.disconnect());
    clearRestActionRegistry();
    server?.close();
  });

  /**
   * Signs in over REST as a browser does. Returns the browser's cookies: the session it was given, and the id of the
   * browser's connection (`nexus-conn`), which every socket of this browser presents.
   */
  async function signIn(): Promise<Record<string, string>> {
    const response = await fetch(`http://localhost:${port}/${SOCKET_NAME}/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: { email: USER.email, password: 'correct' }, deviceDetails: { id: 'device-refused' } }),
    });
    expect(response.status).toBe(200);
    const sessionToken = response.headers.getSetCookie()
      .map(setCookie => setCookie.split(';')[0]!)
      .find(cookie => cookie.startsWith('nexus_session='))
      ?.slice('nexus_session='.length);
    expect(sessionToken, 'the sign-in set a session cookie').toBeTruthy();
    return { 'nexus_session': sessionToken!, 'nexus-conn': randomUUID() };
  }

  function cookieHeader(cookies: Record<string, string>): string {
    return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function clientWith(cookies: Record<string, string>): TestClient {
    const client = new TestClient(port, SOCKET_NAME, undefined, { extraHeaders: { Cookie: cookieHeader(cookies) } });
    openClients.push(client);
    return client;
  }

  /** Connects with the browser's cookies and asks for something only a signed-in user may have. */
  async function connectAndFetchSecret(cookies: Record<string, string>): Promise<string> {
    const client = clientWith(cookies);
    await client.connect();
    try {
      return await client.call(privateSecretAction);
    } finally {
      client.disconnect();
    }
  }

  function recordFor(sessionToken: string): JwtAuthRecord {
    const record = [...records.values()].find(({ sessionToken: token }) => token === sessionToken);
    expect(record, 'the sign-in stored a session').toBeDefined();
    return record!;
  }

  it('a signed-in browser connects and stays signed in across reconnects', async () => {
    const cookies = await signIn();

    expect(await connectAndFetchSecret(cookies)).toBe('secret');
    expect(await connectAndFetchSecret(cookies)).toBe('secret');
  });

  it('a disabled device is refused the connection, and its browser is no longer signed in', async () => {
    const cookies = await signIn();
    expect(await connectAndFetchSecret(cookies)).toBe('secret');

    const { requestId } = recordFor(cookies.nexus_session!);
    await store.update(requestId, { isEnabled: false });

    const refused = clientWith(cookies);
    const refusal = await refused.connect().then(() => undefined, (error: ConnectionRefusal) => error);
    expect(refusal?.data?.reason, 'the connection is refused, saying why').toBe('device-disabled');
    expect(refused.isConnected).toBe(false);

    // The same browser without its session cookie is an ordinary signed-out connection, not the disabled device's user.
    const { 'nexus-conn': connectionId } = cookies;
    await expect(connectAndFetchSecret({ 'nexus-conn': connectionId! })).rejects.toThrow('Unauthorized');
  });

  it('a stale session connects signed out rather than as the user an earlier socket signed in', async () => {
    const cookies = await signIn();
    expect(await connectAndFetchSecret(cookies)).toBe('secret');

    records.delete(recordFor(cookies.nexus_session!).requestId);

    await expect(connectAndFetchSecret(cookies)).rejects.toThrow('Unauthorized');
  });

  it('a re-enabled device is let back in', async () => {
    const cookies = await signIn();
    const { requestId } = recordFor(cookies.nexus_session!);
    await store.update(requestId, { isEnabled: false });
    await expect(clientWith(cookies).connect()).rejects.toBeDefined();

    await store.update(requestId, { isEnabled: true });

    expect(await connectAndFetchSecret(cookies)).toBe('secret');
  });
});
