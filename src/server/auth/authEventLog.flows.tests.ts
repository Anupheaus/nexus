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
import axios from 'axios';
import { handleGoogleOneTap } from '../actions/googleOneTapAction';
import { handleWebAuthnInvite } from '../actions/webauthnInviteAction';
import { handleWebAuthnRegister } from '../actions/webauthnRegisterAction';
import { refreshGoogleToken } from './googleTokenRefresh';

// The [Auth] events the real handlers log, as a registered listener receives them (sc-378).

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const NOW = 1_800_000_000_000;
const SESSION_TOKEN = 'session-token-that-must-never-be-logged';
const OAUTH_CODE = 'oauth-code-that-must-never-be-logged';
const verification: PasskeyVerificationConfig = { rpIds: [RP_ID], isAllowedOrigin: origin => origin === ORIGIN };
const signer = createChallengeSigner('a-long-shared-secret-for-tests');
const deviceDetails = { id: 'device-1' } as NexusDeviceDetails;
const installationId = 'installation-1';

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

/** A registered passkey device (this installation's) in a store that finds it by its credential id. */
async function registeredDevice(overrides: Partial<WebAuthnAuthRecord> = {}) {
  const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
  const stored = await verifyPasskeyRegistration(verification, passkey.register(new TextEncoder().encode('tok')), 'tok');
  const record = { requestId: 'r1', userId: 'u1', sessionToken: SESSION_TOKEN, deviceId: 'd', isEnabled: true, installationId, ...stored!, ...overrides } as WebAuthnAuthRecord;
  const store = {
    findByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? record : undefined)),
    findAllByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? [record] : [])),
    claimPasskeySignIn: vi.fn(async () => true),
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

    await handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId }, vi.fn(), NOW + 1_000);

    const entry = received.find(({ message }) => message === '[Auth] sign-in succeeded');
    expect([authEvents(), entry?.meta?.userId, entry?.meta?.method]).toEqual([['sign-in success'], 'u1', 'passkey']);
  });

  it('logs a passkey sign-in with a bad signature as one failure with its reason', async () => {
    const { passkey, store, record } = await registeredDevice();
    const credential = passkey.signIn(signer.issue(NOW));
    const forged = { ...credential, response: { ...credential.response, signature: Buffer.from('not a signature').toString('base64url') } };

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: forged, deviceDetails, installationId }, vi.fn(), NOW)).rejects.toThrow();

    expect([authEvents(), received.at(-1)?.meta?.userId]).toEqual([['sign-in failure bad-signature'], record.userId]);
  });

  it('logs a sign-in answering an old challenge again (a replay) as a refused challenge', async () => {
    const { passkey, store } = await registeredDevice({ lastChallengeIssuedAt: NOW });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure challenge-rejected']);
  });

  it('logs a sign-in from a disabled device as device-disabled', async () => {
    const { passkey, store } = await registeredDevice({ isEnabled: false });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure device-disabled']);
  });

  it('logs a passkey no device registered as an unknown credential', async () => {
    const { store } = await registeredDevice();
    const stranger = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: stranger.signIn(signer.issue(NOW)), deviceDetails, installationId }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure unknown-credential']);
  });

  it('logs a synced passkey signing in on a new installation as a sign-in success on a new installation', async () => {
    const { passkey, store } = await registeredDevice();
    (store as unknown as { create: unknown; isPasskeyRevoked: unknown }).create = vi.fn();
    (store as unknown as { create: unknown; isPasskeyRevoked: unknown }).isPasskeyRevoked = vi.fn(async () => false);

    await handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId: 'installation-2' }, vi.fn(), NOW + 1_000);

    const entry = received.find(({ message }) => message === '[Auth] sign-in succeeded');
    expect([authEvents(), entry?.meta?.userId, entry?.meta?.isNewInstallation]).toEqual([['sign-in success'], 'u1', true]);
  });

  it('logs a new installation refused because a device of the passkey is disabled as device-disabled', async () => {
    const { passkey, store } = await registeredDevice({ isEnabled: false });

    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId: 'installation-2' }, vi.fn(), NOW)).rejects.toThrow();

    expect(authEvents()).toEqual(['sign-in failure device-disabled']);
  });

  describe('a refused sign-in on a new installation', () => {
    type NewInstallationStore = { create: ReturnType<typeof vi.fn>; isPasskeyRevoked: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; claimPasskeySignIn: ReturnType<typeof vi.fn>; findAllByCredentialId: ReturnType<typeof vi.fn>; };

    /** A passkey whose one device is on `installation-1`, signing in on `installation-2`, with the store's answers set per test. */
    async function signingInOnNewInstallation(overrides: Partial<NewInstallationStore> = {}) {
      const { passkey, store, record } = await registeredDevice();
      Object.assign(store, { create: vi.fn(), isPasskeyRevoked: vi.fn(async () => false), ...overrides });
      const signIn = (credential = passkey.signIn(signer.issue(NOW))) =>
        handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: 'installation-2' }, vi.fn(), NOW + 1_000);
      return { passkey, record, store: store as unknown as NewInstallationStore, signIn };
    }

    /** What the one refusal logged: its `event outcome reason`, and whether it was marked as a new installation. */
    const refusal = () => [authEvents(), received.at(-1)?.meta?.isNewInstallation];

    it('logs devices of the passkey that disagree as credential-mismatch', async () => {
      const { record, store, signIn } = await signingInOnNewInstallation();
      const otherUsersDevice = { ...record, requestId: 'r2', installationId: 'installation-3', userId: 'someone-else' };
      store.findAllByCredentialId = vi.fn(async () => [record, otherUsersDevice]);

      await expect(signIn()).rejects.toThrow();

      expect(refusal()).toEqual([['sign-in failure credential-mismatch'], true]);
    });

    it('logs a failed claim as a replay when the passkey is not revoked', async () => {
      const { signIn } = await signingInOnNewInstallation({ claimPasskeySignIn: vi.fn(async () => false), isPasskeyRevoked: vi.fn(async () => false) });

      await expect(signIn()).rejects.toThrow();

      expect(refusal()).toEqual([['sign-in failure replay'], true]);
    });

    it('logs a failed claim as device-disabled when the passkey is revoked', async () => {
      const { signIn } = await signingInOnNewInstallation({ claimPasskeySignIn: vi.fn(async () => false), isPasskeyRevoked: vi.fn(async () => true) });

      await expect(signIn()).rejects.toThrow();

      expect(refusal()).toEqual([['sign-in failure device-disabled'], true]);
    });

    it('logs a duplicate key from the store as passkey-already-registered', async () => {
      const { signIn } = await signingInOnNewInstallation({ create: vi.fn(async () => { throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 }); }) });

      await expect(signIn()).rejects.toThrow();

      expect(refusal()).toEqual([['sign-in failure passkey-already-registered'], true]);
    });

    it('logs any other store error as store-error, without the error text, and still refuses', async () => {
      const { signIn } = await signingInOnNewInstallation({ create: vi.fn(async () => { throw new Error('connection reset while writing session-token-for-the-log'); }) });

      await expect(signIn()).rejects.toThrow('WebAuthn re-authentication failed');

      expect(refusal()).toEqual([['sign-in failure store-error'], true]);
      expect(JSON.stringify(received)).not.toContain('connection reset');
    });

    it('logs a passkey revoked between the claim and the create as device-disabled, and disables the new device', async () => {
      const { signIn, store } = await signingInOnNewInstallation({ isPasskeyRevoked: vi.fn(async () => true) });

      await expect(signIn()).rejects.toThrow();

      expect(refusal()).toEqual([['sign-in failure device-disabled'], true]);
      expect(store.update).toHaveBeenCalledWith(expect.any(String), { isEnabled: false });
    });

    it('logs the reason the ceremony was refused, not a generic one', async () => {
      const { passkey, signIn } = await signingInOnNewInstallation();
      const credential = passkey.signIn(signer.issue(NOW));
      const forged = { ...credential, response: { ...credential.response, signature: Buffer.from('not a signature').toString('base64url') } };

      await expect(signIn(forged)).rejects.toThrow();

      expect(refusal()).toEqual([['sign-in failure bad-signature'], true]);
    });
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

  it('logs a Google token refresh for a session that does not exist as no-session', async () => {
    const store = { findBySessionToken: vi.fn(async () => undefined) } as unknown as GoogleOAuthAuthStore;

    await expect(refreshGoogleToken({ store, clientId: 'cid', clientSecret: 'secret', sessionToken: SESSION_TOKEN })).rejects.toThrow();

    expect(authEvents()).toEqual(['token-refresh failure no-session']);
  });

  it('logs a Google token refresh that Google refused as refresh-failed, with the user', async () => {
    const record = { requestId: 'r1', userId: 'g1', isEnabled: true, googleTokenExpiresAt: 0, googleRefreshToken: 'refresh-token-never-logged' };
    const store = { findBySessionToken: vi.fn(async () => record), update: vi.fn() } as unknown as GoogleOAuthAuthStore;
    const post = vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('invalid_grant'));

    await expect(refreshGoogleToken({ store, clientId: 'cid', clientSecret: 'secret', sessionToken: SESSION_TOKEN })).rejects.toThrow('invalid_grant');
    post.mockRestore();

    expect([authEvents(), received.at(-1)?.meta?.userId, JSON.stringify(received).includes('refresh-token-never-logged')]).toEqual([['token-refresh failure refresh-failed'], 'g1', false]);
  });

  it('logs a One Tap token issued for another app as an audience mismatch', async () => {
    const config = { clientId: 'cid', store: {} as GoogleOAuthAuthStore } as unknown as GoogleOAuthAuthConfig;
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { sub: 'g1', email: 'a@b.c', name: 'A', aud: 'someone-else' } });

    await expect(handleGoogleOneTap({ config, req: { credential: 'id-token-never-logged' }, setCookie: vi.fn() })).rejects.toThrow('Invalid One Tap token audience');
    get.mockRestore();

    expect([authEvents(), received.at(-1)?.meta?.securityEvent]).toEqual([['sign-in failure oauth-audience-mismatch'], 'auth-blocked']);
  });

  it('logs an invite link that has already been used as invite-used, with the user', async () => {
    const used = { requestId: 'inv1', userId: 'u1', isEnabled: true, credentialId: 'cred' } as WebAuthnAuthRecord;
    const store = { findById: vi.fn(async () => used), update: vi.fn() } as unknown as WebAuthnAuthStore;

    await expect(handleWebAuthnInvite(store, vi.fn(), { requestId: 'inv1' })).rejects.toThrow('Invite already used');

    expect([authEvents(), received.at(-1)?.meta?.userId]).toEqual([['invite failure invite-used'], 'u1']);
  });

  it('logs registering a passkey another device already holds as passkey-already-registered', async () => {
    const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    const invite = { requestId: 'inv1', userId: 'u1', isEnabled: false, registrationToken: 'reg-token' } as WebAuthnAuthRecord;
    const store = {
      findByRegistrationToken: vi.fn(async () => invite),
      findByCredentialId: vi.fn(async () => ({ requestId: 'other', userId: 'u2' })),
      update: vi.fn(),
    } as unknown as WebAuthnAuthStore;

    await expect(handleWebAuthnRegister(store, verification, { registrationToken: 'reg-token', credential: passkey.register(new TextEncoder().encode('reg-token')), deviceDetails, installationId }, vi.fn())).rejects.toThrow('Passkey already registered');

    expect([authEvents(), received.at(-1)?.meta?.userId]).toEqual([['sign-in failure passkey-already-registered'], 'u1']);
  });

  it('never delivers a token, cookie, challenge, credential key or OAuth code to a listener', async () => {
    const { passkey, store, record } = await registeredDevice();
    const challenge = signer.issue(NOW);
    const credential = passkey.signIn(challenge);
    const forged = { ...credential, response: { ...credential.response, signature: 'AAAA' } };
    await handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId }, vi.fn(), NOW + 1_000);
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: forged, deviceDetails, installationId }, vi.fn(), NOW + 1_000)).rejects.toThrow();
    await validateSessionCookie(socketWithCookie(), sessionStore(undefined), async () => undefined, vi.fn());
    const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x/cb', baseScopes: [], store: {} as GoogleOAuthAuthStore, onCreateUser: vi.fn() } as unknown as GoogleOAuthAuthConfig;
    await handleGoogleCallback({ config, req: { code: OAUTH_CODE, state: 'forged.state' }, utils: { setCookie: vi.fn(), redirect: vi.fn(), setHeaders: vi.fn() } }).catch(() => undefined);

    const delivered = JSON.stringify(received);
    const secrets = [SESSION_TOKEN, OAUTH_CODE, challenge, record.credentialPublicKey!, credential.response.signature, credential.response.clientDataJSON];
    expect([received.length > 0, secrets.filter(secret => delivered.includes(secret))]).toEqual([true, []]);
  });
});
