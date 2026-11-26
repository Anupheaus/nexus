/**
 * After a browser signs out, no socket from it is signed in.
 *
 * The signed-in user is kept on the browser's connection (the `nexus-conn` cookie), which its sockets share and which
 * outlives them. Signing out over REST disables the session record and clears the session cookie, but the browser keeps
 * its `nexus-conn` cookie: these tests sign in over REST like a browser, connect with both cookies, then sign out (or
 * lose the session cookie) and check what the browser's sockets can still do.
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

const SOCKET_NAME = 'e2e-sign-out';
const USER: TestUser = { id: 'user-sign-out', email: 'sign-out@test.com' };
const SESSION_COOKIE = 'nexus_session';
const CONNECTION_COOKIE = 'nexus-conn';

// Names must be unique across every startServer call in this Vitest process.
const privateSecretAction = defineAction<void, string>()('signOutPrivateSecret');

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

/** A browser's cookies, by name. */
type BrowserCookies = Record<string, string>;

describe('after a browser signs out, no socket from it is signed in', () => {
  let server: http.Server;
  let port: number;
  const openClients: TestClient[] = [];

  beforeEach(() => records.clear());

  beforeAll(async () => {
    clearRestActionRegistry();
    server = http.createServer();
    await startServer({
      name: SOCKET_NAME,
      logger: new Logger('e2e-sign-out'),
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

  function cookieHeader(cookies: BrowserCookies): string {
    return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** What the response's Set-Cookie headers set each cookie to (an empty value is a cookie being removed). */
  function setCookies(response: Response): BrowserCookies {
    return Object.fromEntries(response.headers.getSetCookie().map(setCookie => {
      const [pair] = setCookie.split(';');
      const separator = pair!.indexOf('=');
      return [pair!.slice(0, separator), pair!.slice(separator + 1)];
    }));
  }

  /**
   * Signs in over REST as a browser does. Returns the browser's cookies: the session it was given, and the id of the
   * browser's connection, which every socket of this browser presents. (The connection id is the browser's own here so
   * these tests do not depend on how the sign-in response sets it; `auth-cookies.tests.ts` covers that.)
   */
  async function signIn(): Promise<BrowserCookies> {
    const response = await fetch(`http://localhost:${port}/${SOCKET_NAME}/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: { email: USER.email, password: 'correct' }, deviceDetails: { id: 'device-sign-out' } }),
    });
    expect(response.status).toBe(200);
    const { [SESSION_COOKIE]: sessionToken } = setCookies(response);
    expect(sessionToken, 'the sign-in set a session cookie').toBeTruthy();
    return { [SESSION_COOKIE]: sessionToken!, [CONNECTION_COOKIE]: randomUUID() };
  }

  /** Signs out over REST as a browser does, and answers the cookies the browser keeps afterwards. */
  async function signOut(cookies: BrowserCookies): Promise<BrowserCookies> {
    const response = await fetch(`http://localhost:${port}/${SOCKET_NAME}/socketAPI/signout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(cookies) },
      body: '{}',
    });
    expect(response.status, 'the sign-out succeeded').toBe(200);
    const { [SESSION_COOKIE]: clearedSession } = setCookies(response);
    expect(clearedSession, 'the sign-out removed the session cookie').toBe('');
    const { [SESSION_COOKIE]: _removed, ...kept } = cookies;
    return kept;
  }

  function clientWith(cookies: BrowserCookies): TestClient {
    const client = new TestClient(port, SOCKET_NAME, undefined, { extraHeaders: { Cookie: cookieHeader(cookies) } });
    openClients.push(client);
    return client;
  }

  /** Connects with the browser's cookies and asks for something only a signed-in user may have. */
  async function connectAndFetchSecret(cookies: BrowserCookies): Promise<string> {
    const client = clientWith(cookies);
    await client.connect();
    try {
      return await client.call(privateSecretAction);
    } finally {
      client.disconnect();
    }
  }

  it('a socket the browser opens after signing out is signed out', async () => {
    const cookies = await signIn();
    expect(await connectAndFetchSecret(cookies)).toBe('secret');

    const afterSignOut = await signOut(cookies);

    await expect(connectAndFetchSecret(afterSignOut)).rejects.toThrow('Unauthorized');
  });

  it('a socket left open across the sign-out is signed out', async () => {
    const cookies = await signIn();
    const openSocket = clientWith(cookies);
    await openSocket.connect();
    expect(await openSocket.call(privateSecretAction)).toBe('secret');

    await signOut(cookies);

    await expect(openSocket.call(privateSecretAction)).rejects.toThrow('Unauthorized');
    openSocket.disconnect();
  });

  // The session cookie can go without a sign-out (it expired, or the browser cleared it): the connection still holds
  // the user an earlier socket signed in, and a socket with no session of its own must not inherit it.
  it('a socket with no session cookie does not inherit the user its connection holds', async () => {
    const cookies = await signIn();
    expect(await connectAndFetchSecret(cookies)).toBe('secret');

    const { [CONNECTION_COOKIE]: connectionId } = cookies;
    await expect(connectAndFetchSecret({ [CONNECTION_COOKIE]: connectionId! })).rejects.toThrow('Unauthorized');
  });

  it('the browser signs back in after signing out', async () => {
    const cookies = await signIn();
    await signOut(cookies);

    const signedInAgain = await signIn();

    expect(await connectAndFetchSecret({ ...signedInAgain, [CONNECTION_COOKIE]: cookies[CONNECTION_COOKIE]! })).toBe('secret');
  });
});
