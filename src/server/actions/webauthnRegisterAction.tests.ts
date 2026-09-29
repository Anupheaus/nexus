import { describe, it, expect, vi } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnRegister } from './webauthnRegisterAction';
import { createSoftwarePasskey } from '../auth/softwarePasskey.testing';
import type { PasskeyVerificationConfig } from '../auth/passkeyVerification';

// Registering a device's passkey on a pending invite. The passkey's registration is verified (sc-627), and its credential
// id and public key are what later sign-ins are checked against.

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const verification: PasskeyVerificationConfig = { rpIds: [RP_ID], isAllowedOrigin: origin => origin === ORIGIN };
const deviceDetails: NexusDeviceDetails = {
  id: 'device-1', userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};
const pending = { requestId: 'r1', userId: 'u1', accountId: 'a1', isEnabled: false, sessionToken: '', deviceId: '', registrationToken: 'tok' };

function makeStore(record?: Partial<WebAuthnAuthRecord>, claim?: WebAuthnAuthStore['claimRegistration']): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findByCredentialId: vi.fn(async () => undefined),
    update: vi.fn(),
    ...(claim != null ? { claimRegistration: vi.fn(claim) } : {}),
  };
}

/** A genuine registration for `token`, from a software passkey. */
function registrationFor(token = 'tok', overrides: Parameters<ReturnType<typeof createSoftwarePasskey>['register']>[1] = {}) {
  const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
  return { passkey, credential: passkey.register(new TextEncoder().encode(token), overrides) };
}

describe('handleWebAuthnRegister', () => {
  it('registers a verified passkey on the pending invite: its credential, the device, a session, and no token left', async () => {
    const store = makeStore(pending, async () => pending);
    const setCookie = vi.fn();
    const { passkey, credential } = registrationFor();

    const result = await handleWebAuthnRegister(store, verification, { registrationToken: 'tok', credential, deviceDetails }, setCookie);

    const [token, patch] = vi.mocked(store.claimRegistration!).mock.calls[0]!;
    expect({ result, token, patch, cookie: setCookie.mock.calls[0]?.[0] }).toEqual({
      result: { userId: 'u1', accountId: 'a1' },
      token: 'tok',
      patch: {
        credentialId: passkey.credentialId, credentialPublicKey: expect.any(String), credentialCounter: 0,
        deviceDetails, sessionToken: expect.any(String), isEnabled: true, registrationToken: undefined,
      },
      cookie: 'nexus_session',
    });
    expect(patch).not.toHaveProperty('keyHash');
  });

  it('sets the session cookie HttpOnly, Secure and SameSite=Strict', async () => {
    const setCookie = vi.fn();
    await handleWebAuthnRegister(makeStore(pending, async () => pending), verification, { registrationToken: 'tok', credential: registrationFor().credential, deviceDetails }, setCookie);
    expect(setCookie.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'Strict' }));
  });

  it.each([
    ['answers another registration token', () => registrationFor('other-token').credential],
    ['comes from an origin the app does not allow', () => registrationFor('tok', { origin: 'https://evil.example' }).credential],
    ['did not verify the user', () => registrationFor('tok', { withoutUserVerification: true }).credential],
    ['is not a registration at all (a bare key hash)', () => ({ keyHash: 'abc' }) as never],
  ])('refuses a passkey that %s, registering nothing and setting no cookie', async (_label, credential) => {
    const store = makeStore(pending, async () => pending);
    const setCookie = vi.fn();

    await expect(handleWebAuthnRegister(store, verification, { registrationToken: 'tok', credential: credential(), deviceDetails }, setCookie)).rejects.toThrow('Passkey could not be verified');
    expect({ claimed: vi.mocked(store.claimRegistration!).mock.calls.length, cookies: setCookie.mock.calls.length }).toEqual({ claimed: 0, cookies: 0 });
  });

  it('refuses a passkey another device already holds', async () => {
    const store = makeStore(pending, async () => pending);
    vi.mocked(store.findByCredentialId).mockResolvedValue({ requestId: 'r-other' } as WebAuthnAuthRecord);

    await expect(handleWebAuthnRegister(store, verification, { registrationToken: 'tok', credential: registrationFor().credential, deviceDetails }, vi.fn())).rejects.toThrow('Passkey already registered');
    expect(store.claimRegistration).not.toHaveBeenCalled();
  });

  // sc-620: parsed JSON can carry an object, which a MongoDB store would treat as a query operator.
  it.each([{ $ne: null }, { $gt: '' }, ['k'], 1, '', null])('refuses a registration token that is not a non-empty string (%j) without looking it up', async registrationToken => {
    const store = makeStore(pending, async () => pending);
    await expect(handleWebAuthnRegister(store, verification, { registrationToken, credential: registrationFor().credential, deviceDetails } as never, vi.fn())).rejects.toThrow('Invalid registration token');
    expect(store.findByRegistrationToken).not.toHaveBeenCalled();
  });

  it('refuses a token no invite holds', async () => {
    await expect(handleWebAuthnRegister(makeStore(undefined), verification, { registrationToken: 'tok', credential: registrationFor().credential, deviceDetails }, vi.fn())).rejects.toThrow('Invalid registration token');
  });

  // A registered device keeps its invite's requestId; after sign-out or an admin disable only isEnabled is false again.
  it.each([
    ['signed out (credential and device details kept)', { credentialId: 'old', deviceDetails }],
    ['disabled by an admin (credential only)', { credentialId: 'old' }],
    ['registered before sc-627 (a key hash only)', { keyHash: 'old' }],
    ['enabled', { isEnabled: true, credentialId: 'old' }],
  ])('refuses to register over a device that is %s, changing nothing', async (_label, registration) => {
    const store = makeStore({ ...pending, ...registration }, async () => pending);
    const setCookie = vi.fn();

    await expect(handleWebAuthnRegister(store, verification, { registrationToken: 'tok', credential: registrationFor().credential, deviceDetails }, setCookie)).rejects.toThrow('Invalid registration token');
    expect({ claimed: vi.mocked(store.claimRegistration!).mock.calls.length, cookies: setCookie.mock.calls.length }).toEqual({ claimed: 0, cookies: 0 });
  });

  it('loses the race cleanly: when another registration claimed the token first, it fails and sets no session cookie', async () => {
    const setCookie = vi.fn();
    await expect(handleWebAuthnRegister(makeStore(pending, async () => undefined), verification, { registrationToken: 'tok', credential: registrationFor().credential, deviceDetails }, setCookie)).rejects.toThrow('Invalid registration token');
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('updates the invite in place when the store has no atomic claim', async () => {
    const store = makeStore(pending);
    await handleWebAuthnRegister(store, verification, { registrationToken: 'tok', credential: registrationFor().credential, deviceDetails }, vi.fn());
    expect(vi.mocked(store.update).mock.calls[0]).toEqual(['r1', expect.objectContaining({ isEnabled: true, credentialId: expect.any(String) })]);
  });
});
