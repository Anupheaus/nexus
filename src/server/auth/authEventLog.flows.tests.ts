import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Socket } from 'socket.io';
import { Logger, type LoggerEntry } from '@anupheaus/common';
import type { GoogleOAuthAuthStore, NexusAuthRecord, NexusAuthStore, NexusDeviceDetails, WebAuthnAuthRecord, WebAuthnAuthStore } from '../../common/auth';
import { setAuthData, setLogger } from '../async-context/nexusContext';
import { handleWebAuthnReauth } from '../actions/webauthnReauthAction';
import { handleSignOut } from '../actions/signoutAction';
import { handleGoogleCallback } from '../actions/googleCallbackAction';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';
import { createSoftwarePasskey } from './softwarePasskey.testing';
import { createChallengeSigner } from './webauthnChallenge';
import { verifyPasskeyRegistration, type PasskeyVerificationConfig } from './passkeyVerification';
import { validateSessionCookie } from './validateSessionCookie';

// The [Auth] events the real handlers log, as a registered listener receives them (sc-378).

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const NOW = 1_800_000_000_000;
const SESSION_TOKEN = 'session-token-that-must-never-be-logged';
const OAUTH_CODE = 'oauth-code-that-must-never-be-logged';
const verification: PasskeyVerificationConfig = { rpIds: [RP_ID], isAllowedOrigin: origin => origin === ORIGIN };
const signer = createChallengeSigner('a-long-shared-secret-for-tests');
const deviceDetails = { id: 'device-1' } as NexusDeviceDetails;

const received: LoggerEntry[] = [];
let unsubscribe: () => void;

/** The [Auth] entries delivered to the listener, as `event outcome reason`. */
const authEvents = (): string[] => received
  .filter(({ message }) => message.startsWith('[Auth]'))
  .map(({ meta }) => [meta?.event, meta?.outcome, meta?.reason].filter(part => part != null).join(' '));

beforeAll(() => {
  setLogger(new Logger('auth-flows'));
  unsubscribe = Logger.registerListener({ maxEntries: 1, onTrigger: entries => { received.push(...entries); } });
});

afterAll(() => unsubscribe());

beforeEach(() => {
  received.length = 0;
});

/** A registered passkey device in a store that finds it by its credential id. */
async function registeredDevice(overrides: Partial<WebAuthnAuthRecord> = {}) {
  const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
  const stored = await verifyPasskeyRegistration(verification, passkey.register(new TextEncoder().encode('tok')), 'tok');
  const record = { requestId: 'r1', userId: 'u1', sessionToken: SESSION_TOKEN, deviceId: 'd', isEnabled: true, ...stored!, ...overrides } as WebAuthnAuthRecord;
  const store = {
    findByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? record : undefined)),
    update: vi.fn(),
  } as unknown as WebAuthnAuthStore;
  return { passkey, record, store };
}

function sessionStore(record?: NexusAuthRecord): NexusAuthStore<NexusAuthRecord> {
  return { create: vi.fn(), findById: vi.fn(), findByDevice: vi.fn(), findBySessionToken: vi.fn(async () => record), update: vi.fn() };
}

function socketWithCookie(): Socket {
  return { handshake: { headers: { cookie: `nexus_session=${SESSION_TOKEN}` }, auth: {} }, emit: vi.fn(), disconnect: vi.fn() } as unknown as Socket;
}

describe('[Auth] events', () => {
  it('logs a passkey sign-in that succeeded at info, with the user', async () => {
    const { passkey, store } = await registeredDevice();

    await handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW + 1_000);

    const entry = received.find(({ message }) => message === '[Auth] sign-in succeeded');
    expect([authEvents(), entry?.meta?.userId, entry?.meta?.method]).toEqual([['sign-in success'], 'u1', 'passkey']);
  });

  it('logs a passkey sign-in with a bad signature as one failure with its reason', async () => {
    const { passkey, store, record } = await registeredDevice();
    const credential = passkey.signIn(signer.issue(NOW));
    const forged = { ...credential, response: { ...credential.response, signature: Buffer.from('not a signature').toString('base64url') } };

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: forged, deviceDetails }, vi.fn(), NOW)).rejects.toThrow();

    expect([authEvents(), received.at(-1)?.meta?.userId]).toEqual([['sign-in failure bad-signature'], record.userId]);
  });

  it('logs a sign-in answering an old challenge again (a replay) as a refused challenge', async () => {
    const { passkey, store } = await registeredDevice({ lastChallengeIssuedAt: NOW });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure challenge-rejected']);
  });

  it('logs a sign-in from a disabled device as device-disabled', async () => {
    const { passkey, store } = await registeredDevice({ isEnabled: false });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure device-disabled']);
  });

  it('logs a passkey no device registered as an unknown credential', async () => {
    const { store } = await registeredDevice();
    const stranger = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: stranger.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure unknown-credential']);
  });

  it('logs a stale session cookie as a rejected session', async () => {
    await validateSessionCookie(socketWithCookie(), sessionStore(undefined), async () => ({ id: 'u1' }), vi.fn());

    expect(authEvents()).toEqual(['session failure stale-session']);
  });

  it('logs a disabled device\'s session cookie as a rejected session with the user', async () => {
    const record = { requestId: 'r1', userId: 'u1', sessionToken: SESSION_TOKEN, deviceId: 'd', isEnabled: false } as NexusAuthRecord;

    await validateSessionCookie(socketWithCookie(), sessionStore(record), async () => ({ id: 'u1' }), vi.fn());

    expect([authEvents(), received.at(-1)?.meta?.userId]).toEqual([['session failure device-disabled'], 'u1']);
  });

  it('logs a session cookie for a user that no longer exists as unknown-user', async () => {
    const record = { requestId: 'r1', userId: 'gone', sessionToken: SESSION_TOKEN, deviceId: 'd', isEnabled: true } as NexusAuthRecord;

    await validateSessionCookie(socketWithCookie(), sessionStore(record), async () => undefined, vi.fn());

    expect(authEvents()).toEqual(['session failure unknown-user']);
  });

  it('logs nothing for a connection with no session (the sign-in screen)', async () => {
    const socket = { handshake: { headers: {}, auth: {} }, emit: vi.fn(), disconnect: vi.fn() } as unknown as Socket;

    await validateSessionCookie(socket, sessionStore(undefined), async () => undefined, vi.fn());

    expect(authEvents()).toEqual([]);
  });

  it('logs a Google callback whose state does not verify as an OAuth state mismatch', async () => {
    const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x/cb', baseScopes: [], store: {} as GoogleOAuthAuthStore, onCreateUser: vi.fn() } as unknown as GoogleOAuthAuthConfig;

    await expect(handleGoogleCallback({ config, req: { code: OAUTH_CODE, state: 'forged.state' }, utils: { setCookie: vi.fn(), redirect: vi.fn(), setHeaders: vi.fn() } })).rejects.toThrow('Invalid OAuth state parameter');

    expect([authEvents(), received.at(-1)?.meta?.securityEvent]).toEqual([['sign-in failure oauth-state-mismatch'], 'auth-blocked']);
  });

  it('logs a sign-out that revoked a session at info, with the user', async () => {
    const record = { requestId: 'r1', userId: 'u1', sessionToken: SESSION_TOKEN, deviceId: 'd', isEnabled: true } as NexusAuthRecord;
    setAuthData({ token: SESSION_TOKEN });

    await handleSignOut(sessionStore(record), vi.fn());

    expect([authEvents(), received.at(-1)?.meta?.userId]).toEqual([['sign-out success'], 'u1']);
  });

  it('never delivers a token, cookie, challenge, credential key or OAuth code to a listener', async () => {
    const { passkey, store, record } = await registeredDevice();
    const challenge = signer.issue(NOW);
    const credential = passkey.signIn(challenge);
    const forged = { ...credential, response: { ...credential.response, signature: 'AAAA' } };
    await handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails }, vi.fn(), NOW + 1_000);
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: forged, deviceDetails }, vi.fn(), NOW + 1_000)).rejects.toThrow();
    await validateSessionCookie(socketWithCookie(), sessionStore(undefined), async () => undefined, vi.fn());
    const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x/cb', baseScopes: [], store: {} as GoogleOAuthAuthStore, onCreateUser: vi.fn() } as unknown as GoogleOAuthAuthConfig;
    await handleGoogleCallback({ config, req: { code: OAUTH_CODE, state: 'forged.state' }, utils: { setCookie: vi.fn(), redirect: vi.fn(), setHeaders: vi.fn() } }).catch(() => undefined);

    const delivered = JSON.stringify(received);
    const secrets = [SESSION_TOKEN, OAUTH_CODE, challenge, record.credentialPublicKey!, credential.response.signature, credential.response.clientDataJSON];
    expect([received.length > 0, secrets.filter(secret => delivered.includes(secret))]).toEqual([true, []]);
  });
});
