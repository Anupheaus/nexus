/**
 * Every REST response that sets the session cookie also sends the connection cookie, when the browser has no
 * connection yet.
 *
 * A request on a new connection gets a `nexus-conn` cookie, the id that ties a browser's sockets and requests to one
 * connection (where the signed-in user is kept). Sign-in, invite redemption and sign-out each set or remove the
 * `nexus_session` cookie on the same response, and that used to replace the `nexus-conn` one, so a browser that signed
 * in on a new connection never learned its id.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord, WebAuthnAuthRecord, WebAuthnAuthStore } from '../../src/common/auth';
import { defineAction } from '../../src/common/defineAction';
import { createServerActionHandler } from '../../src/server/actions';
import { clearRestActionRegistry } from '../../src/server/actions/restActionRegistry';
import { createSoftwarePasskey } from '../../src/server/auth/softwarePasskey.testing';
import { TestClient } from './TestClient';

const SESSION_COOKIE = 'nexus_session';
const CONNECTION_COOKIE = 'nexus-conn';

/** A browser's cookies, by name. */
type BrowserCookies = Record<string, string>;

/** What the response's Set-Cookie headers set each cookie to (an empty value is a cookie being removed). */
function setCookies(response: Response): BrowserCookies {
  return Object.fromEntries(response.headers.getSetCookie().map(setCookie => {
    const [pair] = setCookie.split(';');
    const separator = pair!.indexOf('=');
    return [pair!.slice(0, separator), pair!.slice(separator + 1)];
  }));
}

function cookieHeader(cookies: BrowserCookies): string {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
}

function listen(server: http.Server): Promise<number> {
  return new Promise(resolve => server.listen(0, () => resolve((server.address() as { port: number }).port)));
}

// ─── JWT: sign-in and sign-out ───────────────────────────────────────────────

interface TestUser { id: string; email: string; }
interface TestCreds { email: string; password: string; }

const JWT_NAME = 'e2e-auth-cookies';
const USER: TestUser = { id: 'user-cookies', email: 'cookies@test.com' };
// Names must be unique across every startServer call in this Vitest process.
const privateSecretAction = defineAction<void, string>()('authCookiesPrivateSecret');

const jwtRecords: Map<string, JwtAuthRecord> = new Map();
const jwtStore: JwtAuthStore = {
  async create(record) { jwtRecords.set(record.requestId, { ...record }); },
  async findById(id) { return jwtRecords.get(id); },
  async findBySessionToken(token) { return [...jwtRecords.values()].find(record => record.sessionToken === token); },
  async findByDevice(userId, deviceId) { return [...jwtRecords.values()].find(record => record.userId === userId && record.deviceId === deviceId); },
  async update(id, patch) {
    const record = jwtRecords.get(id);
    if (record) jwtRecords.set(id, { ...record, ...patch });
  },
};

const { configureAuthentication: configureJwtAuthentication } = defineAuthentication<TestUser, never, TestCreds>();

describe('sign-in and sign-out send the connection cookie beside the session cookie', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => jwtRecords.clear());

  beforeAll(async () => {
    clearRestActionRegistry();
    server = http.createServer();
    await startServer({
      name: JWT_NAME,
      logger: new Logger('e2e-auth-cookies'),
      server,
      auth: configureJwtAuthentication({
        mode: 'jwt',
        store: jwtStore,
        onAuthenticate: async ({ email, password }) => (email === USER.email && password === 'correct' ? USER : undefined),
        onGetUser: async userId => (userId === USER.id ? USER : undefined),
      }),
      actions: [createServerActionHandler(privateSecretAction, async () => 'secret')],
    });
    port = await listen(server);
  }, 15_000);

  afterAll(() => {
    clearRestActionRegistry();
    server?.close();
  });

  function signIn(cookies: BrowserCookies = {}): Promise<Response> {
    return fetch(`http://localhost:${port}/${JWT_NAME}/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(cookies) },
      body: JSON.stringify({ credentials: { email: USER.email, password: 'correct' }, deviceDetails: { id: 'device-cookies' } }),
    });
  }

  function signOut(cookies: BrowserCookies): Promise<Response> {
    return fetch(`http://localhost:${port}/${JWT_NAME}/socketAPI/signout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(cookies) },
      body: '{}',
    });
  }

  it('a sign-in on a new connection sets both cookies', async () => {
    const response = await signIn();

    expect(response.status).toBe(200);
    expect(setCookies(response)).toEqual({ [SESSION_COOKIE]: expect.any(String), [CONNECTION_COOKIE]: expect.any(String) });
    // One connection per request: not a second, different connection cookie from another layer of the server.
    expect(response.headers.getSetCookie(), 'each cookie is set once').toHaveLength(2);
  });

  it('a sign-in on a connection the browser already has sets only the session cookie', async () => {
    const { [CONNECTION_COOKIE]: connectionId } = setCookies(await signIn());

    const response = await signIn({ [CONNECTION_COOKIE]: connectionId! });

    expect(Object.keys(setCookies(response))).toEqual([SESSION_COOKIE]);
  });

  // The browser's next socket presents exactly what the sign-in set, and is signed in on it.
  it('a socket presenting the cookies the sign-in set is signed in', async () => {
    const cookies = setCookies(await signIn());
    const client = new TestClient(port, JWT_NAME, undefined, { extraHeaders: { Cookie: cookieHeader(cookies) } });
    await client.connect();
    try {
      expect(await client.call(privateSecretAction)).toBe('secret');
    } finally {
      client.disconnect();
    }
  });

  // A connection forgotten by the server (it expired) gets a new id on the sign-out response, beside the removal of
  // the session cookie.
  it('a sign-out on a new connection removes the session cookie and sets the connection cookie', async () => {
    const { [SESSION_COOKIE]: sessionToken } = setCookies(await signIn());

    const response = await signOut({ [SESSION_COOKIE]: sessionToken!, [CONNECTION_COOKIE]: 'expired-connection' });

    expect(response.status).toBe(200);
    expect(setCookies(response)).toEqual({ [SESSION_COOKIE]: '', [CONNECTION_COOKIE]: expect.any(String) });
  });
});

// ─── WebAuthn: invite redemption and passkey sign-in ─────────────────────────

const WEBAUTHN_NAME = 'e2e-auth-cookies-webauthn';
const RP_ID = 'app.test';
const ORIGIN = 'https://app.test';
const INSTALLATION = 'installation-cookies';
const REGISTRATION_TOKEN = 'tok-cookies';
const deviceDetails = { id: 'device-cookies-webauthn', userAgent: 'e2e' };

const webauthnRecords = new Map<string, WebAuthnAuthRecord>();
const claimedSignIns = new Set<string>();

const webauthnStore: WebAuthnAuthStore = {
  async create(record) { webauthnRecords.set(record.requestId, { ...record }); },
  async findById(requestId) { return webauthnRecords.get(requestId); },
  async findBySessionToken(token) { return [...webauthnRecords.values()].find(record => record.sessionToken === token); },
  async findByDevice(userId, deviceId) { return [...webauthnRecords.values()].find(record => record.userId === userId && record.deviceId === deviceId); },
  async findByRegistrationToken(token) { return [...webauthnRecords.values()].find(record => record.registrationToken === token); },
  async findByCredentialId(credentialId) { return [...webauthnRecords.values()].find(record => record.credentialId === credentialId); },
  async findAllByCredentialId(credentialId) { return [...webauthnRecords.values()].filter(record => record.credentialId === credentialId); },
  async claimPasskeySignIn({ credentialId, challenge }) {
    const key = `${credentialId}:${challenge}`;
    if (claimedSignIns.has(key)) return false;
    claimedSignIns.add(key);
    return true;
  },
  async isPasskeyRevoked() { return false; },
  async update(requestId, patch) {
    const record = webauthnRecords.get(requestId);
    if (record != null) webauthnRecords.set(requestId, { ...record, ...patch });
  },
};

const { configureAuthentication: configureWebAuthnAuthentication } = defineAuthentication<{ id: string; }>();

describe('invite redemption and passkey sign-in send the connection cookie beside the session cookie', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    clearRestActionRegistry();
    server = http.createServer();
    await startServer({
      name: WEBAUTHN_NAME,
      logger: new Logger('e2e-auth-cookies-webauthn'),
      server,
      auth: configureWebAuthnAuthentication({
        mode: 'webauthn',
        store: webauthnStore,
        onGetInviteDetails: async () => ({ appName: 'Cookies test' }) as never,
        onGetUser: async userId => ({ id: userId }),
        rpIds: [RP_ID],
        isAllowedOrigin: origin => origin === ORIGIN,
        challengeSecret: 'e2e-cookies-challenge-secret',
      }),
    });
    port = await listen(server);
  }, 15_000);

  afterAll(() => {
    clearRestActionRegistry();
    server?.close();
  });

  /** An opened invite nobody has registered yet. */
  beforeEach(() => {
    webauthnRecords.clear();
    claimedSignIns.clear();
    webauthnRecords.set('r-invite', {
      requestId: 'r-invite', userId: 'invitee', deviceId: '', sessionToken: '', registrationToken: REGISTRATION_TOKEN, isEnabled: false, createdAt: Date.now(),
    } as WebAuthnAuthRecord);
  });

  function call(method: 'GET' | 'POST', path: string, body?: object): Promise<Response> {
    return fetch(`http://localhost:${port}/${WEBAUTHN_NAME}/socketAPI/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  it('redeeming an invite on a new connection sets both cookies', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });

    const response = await call('POST', 'webauthn/register', {
      registrationToken: REGISTRATION_TOKEN, credential: passkey.register(new TextEncoder().encode(REGISTRATION_TOKEN)), deviceDetails, installationId: INSTALLATION,
    });

    expect(response.status).toBe(200);
    expect(setCookies(response)).toEqual({ [SESSION_COOKIE]: expect.any(String), [CONNECTION_COOKIE]: expect.any(String) });
  });

  it('a passkey sign-in on a new connection sets both cookies', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    await call('POST', 'webauthn/register', {
      registrationToken: REGISTRATION_TOKEN, credential: passkey.register(new TextEncoder().encode(REGISTRATION_TOKEN)), deviceDetails, installationId: INSTALLATION,
    });
    const { challenge } = await (await call('GET', 'webauthn/challenge')).json() as { challenge: string; };

    const response = await call('POST', 'webauthn/reauth', { credential: passkey.signIn(challenge), deviceDetails, installationId: INSTALLATION });

    expect(response.status).toBe(200);
    expect(setCookies(response)).toEqual({ [SESSION_COOKIE]: expect.any(String), [CONNECTION_COOKIE]: expect.any(String) });
  });
});
