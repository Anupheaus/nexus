import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { io as socketIo } from 'socket.io-client';
import { SocketIOParser } from '../../src/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { WebAuthnAuthRecord, WebAuthnAuthStore } from '../../src/common/auth';
import { createSoftwarePasskey } from '../../src/server/auth/softwarePasskey.testing';

// Vision sc-620. nexus hands parsed REST bodies and the socket handshake's `auth` to its auth handlers, so a key can
// arrive as an object. A MongoDB-backed store puts the key into a filter, where { "$ne": null } is an OPERATOR:
// re-authenticating with { "keyHash": { "$ne": null } } found the first registered device and signed the caller in as it.
// This store matches keys the way MongoDB does, so each exploit below would succeed if a handler passed its key through.
// Every one must be refused, issue no session, and never hand the store anything but a string key.

const NAME = 'e2e-key-injection';
const deviceDetails = { id: 'attacker-device', userAgent: 'e2e' };
/** The installation the requests come from (sc-645). */
const INSTALLATION = 'installation-e2e';
const RP_ID = 'app.test';
const ORIGIN = 'https://app.test';

/** How MongoDB matches a stored field against a filter value, for the operators the exploits use. */
function mongoMatches(stored: unknown, key: unknown): boolean {
  if (key != null && typeof key === 'object' && !Array.isArray(key)) {
    const [operator, operand] = Object.entries(key)[0] ?? [];
    if (operator === '$ne') return operand === null ? stored != null : stored !== operand;
    if (operator === '$gt') return typeof stored === typeof operand && (stored as string) > (operand as string);
    if (operator === '$exists') return (stored !== undefined) === operand;
    return false;
  }
  return stored === key;
}

const records = new Map<string, WebAuthnAuthRecord>();
/** Every store call that received a key that was not a non-empty string. */
const nonStringLookups: string[] = [];

function lookUp(method: string, field: keyof WebAuthnAuthRecord, key: unknown): WebAuthnAuthRecord | undefined {
  if (typeof key !== 'string' || key.length === 0) nonStringLookups.push(`${method}(${JSON.stringify(key)})`);
  return [...records.values()].find(record => mongoMatches(record[field], key));
}

const store: WebAuthnAuthStore = {
  async create(record) { records.set(record.requestId, { ...record }); },
  async findById(requestId) { return lookUp('findById', 'requestId', requestId); },
  async findBySessionToken(token) { return lookUp('findBySessionToken', 'sessionToken', token); },
  async findByDevice(userId, deviceId) { return [...records.values()].find(record => record.userId === userId && record.deviceId === deviceId); },
  async findByRegistrationToken(token) { return lookUp('findByRegistrationToken', 'registrationToken', token); },
  async findByCredentialId(credentialId) { return lookUp('findByCredentialId', 'credentialId', credentialId); },
  async findAllByCredentialId(credentialId) {
    if (typeof credentialId !== 'string' || credentialId.length === 0) nonStringLookups.push(`findAllByCredentialId(${JSON.stringify(credentialId)})`);
    return [...records.values()].filter(record => mongoMatches(record.credentialId, credentialId));
  },
  async update(requestId, patch) {
    const record = records.get(requestId);
    if (record != null) records.set(requestId, { ...record, ...patch });
  },
};

const { configureAuthentication } = defineAuthentication<{ id: string; }>();

/** Everything a JSON body or handshake can carry in place of a string key. */
const OPERATORS: [string, unknown][] = [
  ['{ $ne: null }', { $ne: null }],
  ['{ $gt: "" }', { $gt: '' }],
  ['{ $exists: true }', { $exists: true }],
  ['an array', ['session-1']],
  ['a number', 1],
];

describe('auth keys that are not strings are refused before any lookup (sc-620)', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer();
    await startServer({
      name: NAME,
      logger: new Logger('e2e-key-injection'),
      server,
      auth: configureAuthentication({
        mode: 'webauthn',
        store,
        onGetInviteDetails: async () => ({ appName: 'Injection test' }) as never,
        onGetUser: async userId => ({ id: userId }),
        rpIds: [RP_ID],
        isAllowedOrigin: origin => origin === ORIGIN,
        challengeSecret: 'e2e-challenge-secret',
      }),
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as { port: number; }).port;
  }, 15_000);

  afterAll(() => { server?.close(); });

  /** A registered, enabled device (the victim) and an opened invite nobody has registered yet. */
  beforeEach(() => {
    records.clear();
    nonStringLookups.length = 0;
    records.set('r-device', {
      requestId: 'r-device', userId: 'victim', deviceId: 'd1', sessionToken: 'session-1', credentialId: 'cred-1', credentialPublicKey: 'pk', isEnabled: true, createdAt: 1,
    } as WebAuthnAuthRecord);
    records.set('r-invite', {
      requestId: 'r-invite', userId: 'invitee', deviceId: '', sessionToken: '', registrationToken: 'tok-1', isEnabled: false, createdAt: Date.now(),
    } as WebAuthnAuthRecord);
  });

  async function call(method: 'GET' | 'POST', path: string, body?: object, cookie?: string) {
    const response = await fetch(`http://localhost:${port}/${NAME}/socketAPI/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie != null ? { Cookie: cookie } : {}) },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, sessionCookie: /nexus_session=[^;]+/.test(response.headers.get('set-cookie') ?? ''), text };
  }

  /** Just what matters for a refusal: no success and no session. */
  const outcome = (reply: { ok: boolean; sessionCookie: boolean; }) => ({ ok: reply.ok, sessionCookie: reply.sessionCookie });
  /** A fresh sign-in challenge from the real route. */
  const challenge = async () => (JSON.parse((await call('GET', 'webauthn/challenge')).text) as { challenge: string; }).challenge;

  it('the store really does match an operator (so the tests below would catch a handler that passed one through)', () => {
    expect([mongoMatches('cred-1', { $ne: null }), mongoMatches('session-1', { $gt: '' }), mongoMatches('tok-1', { $exists: true })]).toEqual([true, true, true]);
  });

  it.each(OPERATORS)('re-authentication with %s as the credential id is refused, with no session', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/reauth', { credential: { id: operator, rawId: 'x', type: 'public-key', response: {} }, deviceDetails, installationId: INSTALLATION });

    expect({ reply: outcome(reply), lookups: nonStringLookups }).toEqual({ reply: { ok: false, sessionCookie: false }, lookups: [] });
  });

  // sc-627: knowing a device's key hash no longer signs anyone in.
  it('refuses a re-authentication that sends only a key hash, as clients before sc-627 did', async () => {
    const reply = await call('POST', 'webauthn/reauth', { keyHash: 'hash-1', deviceDetails, installationId: INSTALLATION });

    expect(outcome(reply)).toEqual({ ok: false, sessionCookie: false });
  });

  it.each(OPERATORS)('registration with %s as the registration token is refused, and the invite stays pending', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/register', { registrationToken: operator, credential: {}, deviceDetails, installationId: INSTALLATION });

    expect({ reply: outcome(reply), lookups: nonStringLookups, invite: records.get('r-invite')?.credentialId }).toEqual({
      reply: { ok: false, sessionCookie: false }, lookups: [], invite: undefined,
    });
  });

  it.each(OPERATORS)('registration with %s in place of the passkey is refused, and the invite stays pending', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/register', { registrationToken: 'tok-1', credential: operator, deviceDetails, installationId: INSTALLATION });

    expect({ reply: outcome(reply), invite: [records.get('r-invite')?.isEnabled, records.get('r-invite')?.credentialId] }).toEqual({
      reply: { ok: false, sessionCookie: false }, invite: [false, undefined],
    });
  });

  it('opening an invite with an operator in the request id is refused, and issues no registration token', async () => {
    const replies = [
      await call('GET', 'webauthn/invite?requestId[$ne]=x'),
      await call('GET', 'webauthn/invite?requestId=1'),
    ];

    expect({ replies: replies.map(outcome), lookups: nonStringLookups, token: records.get('r-invite')?.registrationToken }).toEqual({
      replies: [{ ok: false, sessionCookie: false }, { ok: false, sessionCookie: false }], lookups: [], token: 'tok-1',
    });
  });

  // sc-627: biometrics only unlock a device's local key; they never registered a sign-in of their own again.
  it('no longer offers the biometric sign-in setup route', async () => {
    const reply = await call('POST', 'biometric/setup', { keyHash: 'k', deviceDetails }, 'nexus_session=session-1');

    expect({ ok: reply.ok, records: records.size }).toEqual({ ok: false, records: 2 });
  });

  it.each(OPERATORS)('a socket handshake with %s as its session token is not signed in as anyone', async (_label, operator) => {
    const socket = socketIo(`http://localhost:${port}`, {
      path: `/${NAME}`,
      transports: ['websocket'],
      autoConnect: false,
      forceNew: true,
      parser: new SocketIOParser({ logger: new Logger('e2e-key-injection-ws') }),
      auth: { sessionToken: operator },
    });
    let issuedSession = false;
    socket.on('nexus:sessionToken', () => { issuedSession = true; });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    // The server authenticates during the connection; give any session echo time to arrive.
    await new Promise(resolve => setTimeout(resolve, 300));
    socket.disconnect();

    expect({ issuedSession, lookups: nonStringLookups, victimConnected: records.get('r-device')?.lastConnectedAt }).toEqual({
      issuedSession: false, lookups: [], victimConnected: undefined,
    });
  });

  it('registers a genuine passkey through the real routes, signs it in by a fresh challenge, and refuses a replay', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });

    const registered = await call('POST', 'webauthn/register', { registrationToken: 'tok-1', credential: passkey.register(new TextEncoder().encode('tok-1')), deviceDetails, installationId: INSTALLATION });
    const signIn = passkey.signIn(await challenge());
    const signedIn = await call('POST', 'webauthn/reauth', { credential: signIn, deviceDetails, installationId: INSTALLATION });
    const replayed = await call('POST', 'webauthn/reauth', { credential: signIn, deviceDetails, installationId: INSTALLATION });
    const again = await call('POST', 'webauthn/reauth', { credential: passkey.signIn(await challenge()), deviceDetails, installationId: INSTALLATION });

    expect({
      registered: outcome(registered), signedIn: outcome(signedIn), replayed: outcome(replayed), again: outcome(again),
      stored: records.get('r-invite')?.credentialId === passkey.credentialId,
    }).toEqual({
      registered: { ok: true, sessionCookie: true }, signedIn: { ok: true, sessionCookie: true },
      replayed: { ok: false, sessionCookie: false }, again: { ok: true, sessionCookie: true }, stored: true,
    });
  });

  // sc-645: a synced passkey signing in on a second installation is a second device, and the first keeps its session.
  it('registers a synced passkey\'s second installation as a new device through the real routes, leaving the first signed in', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    await call('POST', 'webauthn/register', { registrationToken: 'tok-1', credential: passkey.register(new TextEncoder().encode('tok-1')), deviceDetails, installationId: INSTALLATION });
    const phoneSession = records.get('r-invite')?.sessionToken;

    const laptop = await call('POST', 'webauthn/reauth', { credential: passkey.signIn(await challenge()), deviceDetails, installationId: 'installation-laptop' });

    const devices = [...records.values()].filter(({ credentialId }) => credentialId === passkey.credentialId);
    expect({
      laptop: outcome(laptop),
      installations: devices.map(({ installationId }) => installationId).sort(),
      phoneSession: records.get('r-invite')?.sessionToken === phoneSession,
      sessions: new Set(devices.map(({ sessionToken }) => sessionToken)).size,
    }).toEqual({ laptop: { ok: true, sessionCookie: true }, installations: [INSTALLATION, 'installation-laptop'], phoneSession: true, sessions: 2 });
  });

  it.each(OPERATORS)('re-authentication with %s as the installation id is refused, with no session', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/reauth', { credential: { id: 'cred-1', rawId: 'x', type: 'public-key', response: {} }, deviceDetails, installationId: operator });

    expect({ reply: outcome(reply), lookups: nonStringLookups }).toEqual({ reply: { ok: false, sessionCookie: false }, lookups: [] });
  });

  it('refuses a genuine passkey signing a challenge it made up, or signing in from an origin the app does not allow', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    await call('POST', 'webauthn/register', { registrationToken: 'tok-1', credential: passkey.register(new TextEncoder().encode('tok-1')), deviceDetails, installationId: INSTALLATION });

    const madeUp = await call('POST', 'webauthn/reauth', { credential: passkey.signIn(Buffer.from('made-up').toString('base64url')), deviceDetails, installationId: INSTALLATION });
    const wrongOrigin = await call('POST', 'webauthn/reauth', { credential: passkey.signIn(await challenge(), { origin: 'https://evil.example' }), deviceDetails, installationId: INSTALLATION });

    expect({ madeUp: outcome(madeUp), wrongOrigin: outcome(wrongOrigin) }).toEqual({ madeUp: { ok: false, sessionCookie: false }, wrongOrigin: { ok: false, sessionCookie: false } });
  });

  it('still signs a genuine device in by its session token', async () => {
    const socket = socketIo(`http://localhost:${port}`, {
      path: `/${NAME}`, transports: ['websocket'], autoConnect: false, forceNew: true,
      parser: new SocketIOParser({ logger: new Logger('e2e-key-injection-ws') }),
      auth: { sessionToken: records.get('r-device')?.sessionToken },
    });
    const echoed = new Promise<boolean>(resolve => {
      socket.once('nexus:sessionToken', () => resolve(true));
      setTimeout(() => resolve(false), 3_000);
    });
    socket.connect();
    const issuedSession = await echoed;
    socket.disconnect();

    expect(issuedSession).toBe(true);
  });
});
