/**
 * After a browser signs out, no socket from it is signed in.
 *
 * The signed-in user is kept on the browser's connection (the `nexus-conn` cookie), which its sockets share and which
 * outlives them. Signing out over REST ends the session (its token is replaced, so the old session cookie finds nothing)
 * and clears the session cookie, but the browser keeps its `nexus-conn` cookie: these tests sign in over REST like a
 * browser, connect with both cookies, then sign out (or lose the session cookie) and check what the browser's sockets can
 * still do.
 *
 * Signing out ends the session only, never the device: the auth record is the device's registration too, so a passkey
 * device signs straight back in with the same passkey, and only an admin's disable refuses it as `device-disabled`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import { randomUUID } from 'crypto';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord, WebAuthnAuthRecord, WebAuthnAuthStore } from '../../src/common/auth';
import { createSoftwarePasskey } from '../../src/server/auth/softwarePasskey.testing';
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

  // A refused stale session connects signed out; a device refused as disabled would not connect at all.
  it('the old session cookie, replayed after signing out, connects signed out', async () => {
    const cookies = await signIn();
    await signOut(cookies);

    await expect(connectAndFetchSecret(cookies)).rejects.toThrow('Unauthorized');
  });

  it('the browser signs back in after signing out', async () => {
    const cookies = await signIn();
    await signOut(cookies);

    const signedInAgain = await signIn();

    expect(await connectAndFetchSecret({ ...signedInAgain, [CONNECTION_COOKIE]: cookies[CONNECTION_COOKIE]! })).toBe('secret');
  });
});

// ─── A passkey device: signing out ends the session, not the device ──────────

const PASSKEY_SOCKET_NAME = 'e2e-sign-out-passkey';
const RP_ID = 'app.test';
const ORIGIN = 'https://app.test';
const INSTALLATION = 'installation-sign-out';
const REGISTRATION_TOKEN = 'tok-sign-out';
const INVITEE_ID = 'invitee-sign-out';
const INVITE_REQUEST_ID = 'r-invite-sign-out';
const passkeyDeviceDetails = { id: 'device-sign-out-passkey', userAgent: 'e2e' };

const passkeySecretAction = defineAction<void, string>()('signOutPasskeyPrivateSecret');

const passkeyRecords: Map<string, WebAuthnAuthRecord> = new Map();
const claimedSignIns = new Set<string>();
/** Passkeys a device of which was ever disabled, as a real store records them (see `isPasskeyRevoked`). */
const revokedPasskeys = new Set<string>();

const passkeyStore: WebAuthnAuthStore = {
  async create(record) { passkeyRecords.set(record.requestId, { ...record }); },
  async findById(requestId) { return passkeyRecords.get(requestId); },
  async findBySessionToken(token) { return [...passkeyRecords.values()].find(record => record.sessionToken === token); },
  async findByDevice(userId, deviceId) { return [...passkeyRecords.values()].find(record => record.userId === userId && record.deviceId === deviceId); },
  async findByRegistrationToken(token) { return [...passkeyRecords.values()].find(record => record.registrationToken === token); },
  async findByCredentialId(credentialId) { return [...passkeyRecords.values()].find(record => record.credentialId === credentialId); },
  async findAllByCredentialId(credentialId) { return [...passkeyRecords.values()].filter(record => record.credentialId === credentialId); },
  async claimPasskeySignIn({ credentialId, challenge, isNewDevice }) {
    const key = `${credentialId}:${challenge}`;
    if (claimedSignIns.has(key) || (isNewDevice && revokedPasskeys.has(credentialId))) return false;
    claimedSignIns.add(key);
    return true;
  },
  async isPasskeyRevoked(credentialId) { return revokedPasskeys.has(credentialId); },
  async update(requestId, patch) {
    const record = passkeyRecords.get(requestId);
    if (record == null) return;
    if (patch.isEnabled === false && record.credentialId != null) revokedPasskeys.add(record.credentialId);
    passkeyRecords.set(requestId, { ...record, ...patch });
  },
};

const { configureAuthentication: configurePasskeyAuthentication } = defineAuthentication<{ id: string; }>();

describe('after a passkey device signs out, the same passkey signs it back in', () => {
  let server: http.Server;
  let port: number;
  const openClients: TestClient[] = [];

  beforeAll(async () => {
    clearRestActionRegistry();
    server = http.createServer();
    await startServer({
      name: PASSKEY_SOCKET_NAME,
      logger: new Logger('e2e-sign-out-passkey'),
      server,
      auth: configurePasskeyAuthentication({
        mode: 'webauthn',
        store: passkeyStore,
        onGetInviteDetails: async () => ({ appName: 'Sign-out test' }) as never,
        onGetUser: async userId => ({ id: userId }),
        rpIds: [RP_ID],
        isAllowedOrigin: origin => origin === ORIGIN,
        challengeSecret: 'e2e-sign-out-challenge-secret',
      }),
      actions: [createServerActionHandler(passkeySecretAction, async () => 'secret')],
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  }, 15_000);

  /** An opened invite nobody has registered yet. */
  beforeEach(() => {
    passkeyRecords.clear();
    claimedSignIns.clear();
    revokedPasskeys.clear();
    passkeyRecords.set(INVITE_REQUEST_ID, {
      requestId: INVITE_REQUEST_ID, userId: INVITEE_ID, deviceId: '', sessionToken: '', registrationToken: REGISTRATION_TOKEN, isEnabled: false, createdAt: Date.now(),
    } as WebAuthnAuthRecord);
  });

  afterAll(() => {
    openClients.forEach(client => client.disconnect());
    clearRestActionRegistry();
    server?.close();
  });

  function call(path: string, body?: object, cookies: BrowserCookies = {}): Promise<Response> {
    return fetch(`http://localhost:${port}/${PASSKEY_SOCKET_NAME}/socketAPI/${path}`, {
      method: body == null ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(cookies) },
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  /** Redeems the invite with a new passkey, as the browser does: answers the passkey and the browser's cookies. */
  async function registerDevice() {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    const response = await call('webauthn/register', {
      registrationToken: REGISTRATION_TOKEN, credential: passkey.register(new TextEncoder().encode(REGISTRATION_TOKEN)), deviceDetails: passkeyDeviceDetails, installationId: INSTALLATION,
    });
    expect(response.status, 'the invite was redeemed').toBe(200);
    const { [SESSION_COOKIE]: sessionToken } = setCookies(response);
    expect(sessionToken, 'the registration set a session cookie').toBeTruthy();
    const cookies: BrowserCookies = { [SESSION_COOKIE]: sessionToken!, [CONNECTION_COOKIE]: randomUUID() };
    return { passkey, cookies };
  }

  /** Signs in with the passkey (POST webauthn/reauth), and answers the response. */
  async function signInWithPasskey(passkey: ReturnType<typeof createSoftwarePasskey>, cookies: BrowserCookies): Promise<Response> {
    const { challenge } = await (await call('webauthn/challenge')).json() as { challenge: string; };
    return call('webauthn/reauth', { credential: passkey.signIn(challenge), deviceDetails: passkeyDeviceDetails, installationId: INSTALLATION }, cookies);
  }

  async function signOut(cookies: BrowserCookies): Promise<BrowserCookies> {
    const response = await call('signout', {}, cookies);
    expect(response.status, 'the sign-out succeeded').toBe(200);
    const { [SESSION_COOKIE]: _removed, ...kept } = cookies;
    return kept;
  }

  async function connectAndFetchSecret(cookies: BrowserCookies): Promise<string> {
    const client = new TestClient(port, PASSKEY_SOCKET_NAME, undefined, { extraHeaders: { Cookie: cookieHeader(cookies) } });
    openClients.push(client);
    await client.connect();
    try {
      return await client.call(passkeySecretAction);
    } finally {
      client.disconnect();
    }
  }

  function registeredDeviceRecord(): WebAuthnAuthRecord | undefined {
    return passkeyRecords.get(INVITE_REQUEST_ID);
  }

  it('the device stays enabled, and its passkey signs it back in', async () => {
    const { passkey, cookies } = await registerDevice();
    expect(await connectAndFetchSecret(cookies)).toBe('secret');
    const afterSignOut = await signOut(cookies);
    expect(registeredDeviceRecord()?.isEnabled, 'signing out left the device enabled').toBe(true);

    const response = await signInWithPasskey(passkey, afterSignOut);

    expect(response.status, 'the passkey sign-in succeeded').toBe(200);
    const { [SESSION_COOKIE]: newSession } = setCookies(response);
    expect(newSession, 'the sign-in set a new session cookie').toBeTruthy();
    expect(newSession).not.toBe(cookies[SESSION_COOKIE]);
    expect(await connectAndFetchSecret({ ...afterSignOut, [SESSION_COOKIE]: newSession! })).toBe('secret');
  });

  it('the old session cookie, replayed after signing out, connects signed out', async () => {
    const { cookies } = await registerDevice();
    await signOut(cookies);

    await expect(connectAndFetchSecret(cookies)).rejects.toThrow('Unauthorized');
  });

  it('the old session cookie is still refused once the passkey has signed the device back in', async () => {
    const { passkey, cookies } = await registerDevice();
    const afterSignOut = await signOut(cookies);
    expect((await signInWithPasskey(passkey, afterSignOut)).status).toBe(200);

    await expect(connectAndFetchSecret(cookies)).rejects.toThrow('Unauthorized');
  });

  // Disabling a device stays an admin's action (an app's own, e.g. Vision's setUserAuthDeviceEnabled), and still refuses it.
  it('a device an admin disabled after it signed out is refused its passkey sign-in', async () => {
    const { passkey, cookies } = await registerDevice();
    const afterSignOut = await signOut(cookies);
    await passkeyStore.update(INVITE_REQUEST_ID, { isEnabled: false });

    expect((await signInWithPasskey(passkey, afterSignOut)).status).toBe(401);
  });
});
