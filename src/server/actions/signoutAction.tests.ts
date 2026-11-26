import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';
import type { NexusAuthStore, NexusAuthRecord, NexusDeviceDetails, PasskeySignInClaim, WebAuthnAuthRecord, WebAuthnAuthStore } from '../../common/auth';
import { createSoftwarePasskey } from '../auth/softwarePasskey.testing';
import { createChallengeSigner } from '../auth/webauthnChallenge';
import { verifyPasskeyRegistration, type PasskeyVerificationConfig } from '../auth/passkeyVerification';
import { validateSessionCookie } from '../auth/validateSessionCookie';
import { handleWebAuthnReauth } from './webauthnReauthAction';

const { mockUseAuthData, mockSignOut } = vi.hoisted(() => ({
  mockUseAuthData: vi.fn<() => { token?: string } | undefined>(),
  mockSignOut: vi.fn(async () => {}),
}));

vi.mock('../async-context/nexusContext', () => ({
  useAuthData: mockUseAuthData,
}));

vi.mock('../providers/authentication', () => ({
  useAuthentication: () => ({ signOut: mockSignOut }),
}));

import { handleSignOut } from './signoutAction';

/** 32 random bytes in base64url, as every session token is. */
const SESSION_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function makeStore(record?: NexusAuthRecord): NexusAuthStore<NexusAuthRecord> {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

describe('handleSignOut', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls removeCookie even when no session token is present', async () => {
    mockUseAuthData.mockReturnValueOnce(undefined);
    const removeCookie = vi.fn();
    await handleSignOut(makeStore(undefined), removeCookie);
    expect(removeCookie).toHaveBeenCalledWith('nexus_session');
    expect(makeStore().update).not.toHaveBeenCalled();
  });

  // The record is the device's registration as well as its session: signing out ends the session, never the device.
  it('replaces the session\'s token and leaves the device enabled', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    const store = makeStore(record);
    const removeCookie = vi.fn();
    await handleSignOut(store, removeCookie);
    const [requestId, patch] = vi.mocked(store.update).mock.calls[0] ?? [];
    expect({ requestId, patch }).toEqual({ requestId: 'r1', patch: { sessionToken: expect.stringMatching(SESSION_TOKEN_SHAPE) } });
    expect(patch?.sessionToken).not.toBe('tok');
    expect(removeCookie).toHaveBeenCalledWith('nexus_session');
  });

  // The user, account and token are kept on the browser's connection (the `nexus-conn` cookie), shared by its sockets
  // and outliving them: disabling the session record alone leaves an open socket, and the next one, signed in.
  it('clears the user, account and token the browser\'s connection holds', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    await handleSignOut(makeStore(record), vi.fn());
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // Fail closed: the browser is signed out on the server even when the store cannot be reached.
  it('clears the connection before the store is touched', async () => {
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    const store = makeStore();
    vi.mocked(store.findBySessionToken).mockRejectedValueOnce(new Error('store unavailable'));
    await expect(handleSignOut(store, vi.fn())).rejects.toThrow('store unavailable');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('clears the connection even when there is no session to revoke', async () => {
    mockUseAuthData.mockReturnValueOnce(undefined);
    await handleSignOut(makeStore(undefined), vi.fn());
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

// ─── A passkey device signing out, then back in ───

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const NOW = 1_800_000_000_000;
const INSTALLATION = 'installation-laptop';
const OLD_SESSION = 'session-before-sign-out';
const USER_ID = 'u1';
const verification: PasskeyVerificationConfig = { rpIds: [RP_ID], isAllowedOrigin: origin => origin === ORIGIN };
const signer = createChallengeSigner('a-long-shared-secret-for-tests');
const deviceDetails: NexusDeviceDetails = {
  id: 'device-1', userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

type SoftwarePasskey = ReturnType<typeof createSoftwarePasskey>;

/** A signed-in passkey device, in an in-memory store whose lookups read what its updates wrote, as a real store's do. */
async function signedInPasskeyDevice() {
  const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
  const stored = await verifyPasskeyRegistration(verification, passkey.register(new TextEncoder().encode('tok')), 'tok');
  let record = { requestId: 'r1', userId: USER_ID, sessionToken: OLD_SESSION, deviceId: 'd1', isEnabled: true, installationId: INSTALLATION, ...stored! } as WebAuthnAuthRecord;
  const claimed = new Set<string>();
  const store = {
    create: vi.fn(), findById: vi.fn(async () => record), findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
    findBySessionToken: vi.fn(async (token: string) => (token === record.sessionToken ? record : undefined)),
    findByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? record : undefined)),
    findAllByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? [record] : [])),
    // Check and record in one synchronous step, as a store's atomic write does.
    claimPasskeySignIn: vi.fn(async ({ challenge }: PasskeySignInClaim) => (claimed.has(challenge) ? false : (claimed.add(challenge), true))),
    isPasskeyRevoked: vi.fn(async () => false),
    update: vi.fn(async (_requestId: string, patch: Partial<WebAuthnAuthRecord>) => { record = { ...record, ...patch }; }),
  } as unknown as WebAuthnAuthStore;
  return { passkey, store, current: () => record };
}

/** A socket handshake that offers this session cookie. */
function socketWithSession(sessionToken: string): Socket {
  return { handshake: { headers: { cookie: `nexus_session=${sessionToken}` }, auth: {} }, emit: vi.fn(), disconnect: vi.fn() } as unknown as Socket;
}

function restoreSession(store: WebAuthnAuthStore, sessionToken: string) {
  return validateSessionCookie(socketWithSession(sessionToken), store, async userId => ({ id: userId }), vi.fn());
}

function signInWithPasskey(store: WebAuthnAuthStore, passkey: SoftwarePasskey, setCookie = vi.fn()) {
  return handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId: INSTALLATION }, setCookie, NOW + 1_000);
}

async function signOutOf(store: WebAuthnAuthStore): Promise<void> {
  mockUseAuthData.mockReturnValueOnce({ token: OLD_SESSION });
  await handleSignOut(store, vi.fn());
}

describe('a passkey device after signing out', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays enabled and signs back in with the same passkey, on a new session', async () => {
    const { passkey, store, current } = await signedInPasskeyDevice();
    await signOutOf(store);
    expect(current().isEnabled).toBe(true);

    const setCookie = vi.fn();
    await expect(signInWithPasskey(store, passkey, setCookie)).resolves.toEqual({ userId: USER_ID, accountId: undefined });

    const [cookieName, newSession] = setCookie.mock.calls[0] ?? [];
    expect({ cookieName, isNewSession: newSession !== OLD_SESSION, isStored: newSession === current().sessionToken })
      .toEqual({ cookieName: 'nexus_session', isNewSession: true, isStored: true });
    expect(await restoreSession(store, newSession)).toEqual({ status: 'restored' });
  });

  it('refuses the old session cookie, replayed, as a stale session', async () => {
    const { store } = await signedInPasskeyDevice();
    expect(await restoreSession(store, OLD_SESSION)).toEqual({ status: 'restored' });

    await signOutOf(store);

    expect(await restoreSession(store, OLD_SESSION)).toEqual({ status: 'rejected', reason: 'stale-session' });
  });

  it('refuses the old session cookie after the device has signed back in, too', async () => {
    const { passkey, store } = await signedInPasskeyDevice();
    await signOutOf(store);
    await signInWithPasskey(store, passkey);

    expect(await restoreSession(store, OLD_SESSION)).toEqual({ status: 'rejected', reason: 'stale-session' });
  });

  // Disabling a device stays an admin's action, and still shuts its passkey out.
  it('is refused as a disabled device once an admin disables it', async () => {
    const { passkey, store } = await signedInPasskeyDevice();
    await signOutOf(store);
    await store.update('r1', { isEnabled: false });

    await expect(signInWithPasskey(store, passkey)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(store.claimPasskeySignIn).not.toHaveBeenCalled();
  });
});
