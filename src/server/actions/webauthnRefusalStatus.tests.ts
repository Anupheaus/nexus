import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { registerRestActions } from './registerRestActions';
import { createWebauthnRegisterAction } from './webauthnRegisterAction';
import { createWebauthnReauthAction } from './webauthnReauthAction';
import { createWebauthnInviteAction } from './webauthnInviteAction';
import { ConnectionRegistry } from '../providers/connection';
import { setConfig, setLogger } from '../async-context/nexusContext';
import { clearAuthConfig } from '../auth/authConfig';
import { createSoftwarePasskey } from '../auth/softwarePasskey.testing';
import { createChallengeSigner } from '../auth/webauthnChallenge';
import type { PasskeyVerificationConfig } from '../auth/passkeyVerification';
import type { WebAuthnAuthStore, WebAuthnAuthRecord } from '../../common/auth';

// A refused passkey ceremony is the caller's failure, not the server's: it must reach the client as a 4xx with the same
// fixed message, while a genuinely unexpected failure stays a 500 (sc-685).

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const verification: PasskeyVerificationConfig = { rpIds: [RP_ID], isAllowedOrigin: origin => origin === ORIGIN };
const pending = { requestId: 'r1', userId: 'u1', accountId: 'a1', isEnabled: false, sessionToken: '', deviceId: '', registrationToken: 'tok' };
const mockLogger: any = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), silly: vi.fn(), debug: vi.fn() };
mockLogger.createSubLogger = () => mockLogger;

function makeStore(overrides: Partial<WebAuthnAuthStore> = {}): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByCredentialId: vi.fn(async () => undefined),
    update: vi.fn(),
    ...overrides,
  };
}

interface Outcome { status: number; message: string; }

describe('passkey refusals over REST', () => {
  let server: http.Server;
  let port: number;

  /** Handlers register once per process, so the actions read the store of the current test through this. */
  let store: WebAuthnAuthStore = makeStore();
  const currentStore = new Proxy({} as WebAuthnAuthStore, { get: (_target, property) => store[property as keyof WebAuthnAuthStore] });

  beforeAll(async () => {
    const app = new Koa();
    const router = new Router();
    app.use(bodyParser());
    registerRestActions(router, 'test', new ConnectionRegistry(), [
      createWebauthnRegisterAction(currentStore, verification),
      createWebauthnReauthAction(currentStore, verification, createChallengeSigner('test-secret')),
      createWebauthnInviteAction(currentStore, async () => ({}) as never),
    ]);
    app.use(router.routes());
    server = http.createServer(app.callback());
    port = await new Promise<number>(resolve => { server.listen(0, () => resolve((server.address() as { port: number }).port)); });
  });

  afterAll(() => { server.close(); });

  async function call(action: string, body: Record<string, unknown>): Promise<Outcome> {
    const url = `http://localhost:${port}/test/socketAPI/webauthn/${action}`;
    const res = action === 'invite'
      ? await fetch(`${url}?requestId=${encodeURIComponent(String(body.requestId))}`)
      : await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const { error } = await res.json() as { error: { message: string } };
    return { status: res.status, message: error.message };
  }

  beforeEach(() => {
    setConfig({ name: 'test', server: {} as never });
    setLogger(mockLogger);
    clearAuthConfig();
  });

  it('a bad registration token is a 401 with the same message', async () => {
    store = makeStore();
    expect(await call('register', { registrationToken: 'nope', credential: {}, deviceDetails: {} }))
      .toEqual({ status: 401, message: 'Invalid registration token' });
  });

  it('a passkey from a disallowed origin is a 401 with the same message', async () => {
    store = makeStore({ findByRegistrationToken: vi.fn(async () => pending as WebAuthnAuthRecord) });
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: 'https://evil.example' });
    const credential = passkey.register(new TextEncoder().encode('tok'));
    expect(await call('register', { registrationToken: 'tok', credential, deviceDetails: {} }))
      .toEqual({ status: 401, message: 'Passkey could not be verified' });
  });

  it('a passkey that is not the registration is a 401 with the same message', async () => {
    store = makeStore({ findByRegistrationToken: vi.fn(async () => pending as WebAuthnAuthRecord) });
    expect(await call('register', { registrationToken: 'tok', credential: { keyHash: 'abc' }, deviceDetails: {} }))
      .toEqual({ status: 401, message: 'Passkey could not be verified' });
  });

  it('a sign-in by an unknown passkey is a 401 with the same message', async () => {
    store = makeStore();
    expect(await call('reauth', { credential: { id: 'unknown' }, deviceDetails: {} }))
      .toEqual({ status: 401, message: 'WebAuthn re-authentication failed' });
  });

  it('an unknown invite is a 401 with the same message', async () => {
    store = makeStore();
    expect(await call('invite', { requestId: 'missing' }))
      .toEqual({ status: 401, message: 'Invite not found' });
  });

  it('an invite already used is a 401 with the same message', async () => {
    store = makeStore({ findById: vi.fn(async () => ({ ...pending, registrationToken: undefined, isEnabled: true }) as WebAuthnAuthRecord) });
    expect(await call('invite', { requestId: 'r1' }))
      .toEqual({ status: 401, message: 'Invite already used' });
  });

  it('an unexpected failure (the store going down) is still a 500', async () => {
    store = makeStore({ findById: vi.fn(async () => { throw new Error('connection lost'); }) });
    expect(await call('invite', { requestId: 'r1' }))
      .toEqual({ status: 500, message: 'connection lost' });
  });
});
