import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { io as socketIo } from 'socket.io-client';
import { SocketIOParser } from '../../src/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { WebAuthnAuthRecord, WebAuthnAuthStore } from '../../src/common/auth';

// Vision sc-620. nexus hands parsed REST bodies and the socket handshake's `auth` to its auth handlers, so a key can
// arrive as an object. A MongoDB-backed store puts the key into a filter, where { "$ne": null } is an OPERATOR:
// re-authenticating with { "keyHash": { "$ne": null } } found the first registered device and signed the caller in as it.
// This store matches keys the way MongoDB does, so each exploit below would succeed if a handler passed its key through.
// Every one must be refused, issue no session, and never hand the store anything but a string key.

const NAME = 'e2e-key-injection';
const deviceDetails = { id: 'attacker-device', userAgent: 'e2e' };

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
  async findByKeyHash(keyHash) { return lookUp('findByKeyHash', 'keyHash', keyHash); },
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
      requestId: 'r-device', userId: 'victim', deviceId: 'd1', sessionToken: 'session-1', keyHash: 'hash-1', isEnabled: true, createdAt: 1,
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
    await response.text();
    return { ok: response.ok, sessionCookie: /nexus_session=[^;]+/.test(response.headers.get('set-cookie') ?? '') };
  }

  it('the store really does match an operator (so the tests below would catch a handler that passed one through)', () => {
    expect([mongoMatches('hash-1', { $ne: null }), mongoMatches('session-1', { $gt: '' }), mongoMatches('tok-1', { $exists: true })]).toEqual([true, true, true]);
  });

  it.each(OPERATORS)('re-authentication with %s as the key hash is refused, with no session', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/reauth', { keyHash: operator, deviceDetails });

    expect({ reply, lookups: nonStringLookups }).toEqual({ reply: { ok: false, sessionCookie: false }, lookups: [] });
  });

  it.each(OPERATORS)('registration with %s as the registration token is refused, and the invite stays pending', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/register', { registrationToken: operator, keyHash: 'hash-attacker', deviceDetails });

    expect({ reply, lookups: nonStringLookups, invite: records.get('r-invite')?.keyHash }).toEqual({
      reply: { ok: false, sessionCookie: false }, lookups: [], invite: undefined,
    });
  });

  it.each(OPERATORS)('registration with %s as the key hash is refused, and the invite stays pending', async (_label, operator) => {
    const reply = await call('POST', 'webauthn/register', { registrationToken: 'tok-1', keyHash: operator, deviceDetails });

    expect({ reply, invite: [records.get('r-invite')?.isEnabled, records.get('r-invite')?.keyHash] }).toEqual({
      reply: { ok: false, sessionCookie: false }, invite: [false, undefined],
    });
  });

  it('opening an invite with an operator in the request id is refused, and issues no registration token', async () => {
    const replies = [
      await call('GET', 'webauthn/invite?requestId[$ne]=x'),
      await call('GET', 'webauthn/invite?requestId=1'),
    ];

    expect({ replies, lookups: nonStringLookups, token: records.get('r-invite')?.registrationToken }).toEqual({
      replies: [{ ok: false, sessionCookie: false }, { ok: false, sessionCookie: false }], lookups: [], token: 'tok-1',
    });
  });

  it.each(OPERATORS)('biometric setup with %s as the key hash is refused, and registers no key', async (_label, operator) => {
    const before = records.size;

    const reply = await call('POST', 'biometric/setup', { keyHash: operator, deviceDetails }, 'nexus_session=session-1');

    expect({ reply: reply.ok, lookups: nonStringLookups, records: records.size }).toEqual({ reply: false, lookups: [], records: before });
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

  it('still signs a genuine device in by its key hash and its session token', async () => {
    const reauth = await call('POST', 'webauthn/reauth', { keyHash: 'hash-1', deviceDetails });
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

    expect({ reauth, issuedSession }).toEqual({ reauth: { ok: true, sessionCookie: true }, issuedSession: true });
  });
});
