import { describe, it, expect, vi } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnChallenge, handleWebAuthnReauth } from './webauthnReauthAction';
import { createSoftwarePasskey } from '../auth/softwarePasskey.testing';
import { createChallengeSigner } from '../auth/webauthnChallenge';
import { verifyPasskeyRegistration, type PasskeyVerificationConfig } from '../auth/passkeyVerification';

// A device signs in by its passkey signing a fresh challenge (sc-627), checked against the public key it registered.

const RP_ID = 'vision.lintex.co.uk';
const ORIGIN = 'https://acme.vision.lintex.co.uk';
const NOW = 1_800_000_000_000;
const verification: PasskeyVerificationConfig = { rpIds: [RP_ID], isAllowedOrigin: origin => origin === ORIGIN };
const signer = createChallengeSigner('a-long-shared-secret-for-tests');
const deviceDetails: NexusDeviceDetails = {
  id: 'device-1', userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

/** A registered device (its passkey and record) in a store that finds it by its credential id. */
async function registeredDevice(overrides: Partial<WebAuthnAuthRecord> = {}) {
  const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
  const stored = await verifyPasskeyRegistration(verification, passkey.register(new TextEncoder().encode('tok')), 'tok');
  const record = { requestId: 'r1', userId: 'u1', accountId: 'a1', sessionToken: 'old', deviceId: 'd', isEnabled: true, ...stored!, ...overrides } as WebAuthnAuthRecord;
  const store = {
    create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(), findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
    findByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? record : undefined)),
    update: vi.fn(),
  } as unknown as WebAuthnAuthStore;
  return { passkey, record, store };
}

describe('handleWebAuthnChallenge', () => {
  it('issues a challenge the signer accepts', () => {
    expect(signer.verify(handleWebAuthnChallenge(signer, NOW).challenge, NOW)).toEqual({ issuedAt: NOW });
  });
});

describe('handleWebAuthnReauth', () => {
  it('signs a device in by its passkey\'s signature: a new session, the counter and the challenge time recorded', async () => {
    const { passkey, store } = await registeredDevice();
    const setCookie = vi.fn();
    const credential = passkey.signIn(signer.issue(NOW));

    const result = await handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails }, setCookie, NOW + 1_000);

    expect({ result, update: vi.mocked(store.update).mock.calls[0], cookie: setCookie.mock.calls[0]?.[0] }).toEqual({
      result: { userId: 'u1', accountId: 'a1' },
      update: ['r1', { sessionToken: expect.not.stringMatching(/^old$/), lastConnectedAt: NOW + 1_000, deviceDetails, credentialCounter: 0, lastChallengeIssuedAt: NOW }],
      cookie: 'nexus_session',
    });
  });

  it('refuses the same sign-in sent again, once the device has answered that challenge', async () => {
    const { passkey, store, record } = await registeredDevice();
    const credential = passkey.signIn(signer.issue(NOW));
    await handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails }, vi.fn(), NOW + 1_000);
    record.lastChallengeIssuedAt = NOW;

    await expect(handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails }, vi.fn(), NOW + 2_000)).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it.each([
    ['a disabled device', { isEnabled: false }],
  ])('refuses %s, however valid its signature', async (_label, overrides) => {
    const { passkey, store } = await registeredDevice(overrides);
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(store.update).not.toHaveBeenCalled();
  });

  it('refuses a passkey no device registered', async () => {
    const { store } = await registeredDevice();
    const stranger = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: stranger.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('refuses a bare key hash, which no longer signs anyone in', async () => {
    const { store } = await registeredDevice();
    const setCookie = vi.fn();
    await expect(handleWebAuthnReauth(store, verification, signer, { keyHash: 'abc', deviceDetails } as never, setCookie, NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect({ lookups: vi.mocked(store.findByCredentialId).mock.calls.length, cookies: setCookie.mock.calls.length }).toEqual({ lookups: 0, cookies: 0 });
  });

  // sc-620: { "id": { "$ne": null } } would find the first registered device in a MongoDB store.
  it.each([{ $ne: null }, { $gt: '' }, ['k'], 1, '', null])('refuses a credential id that is not a non-empty string (%j) without looking it up', async id => {
    const { passkey, store } = await registeredDevice();
    const credential = { ...passkey.signIn(signer.issue(NOW)), id };
    await expect(handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails } as never, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(store.findByCredentialId).not.toHaveBeenCalled();
  });
});

// #21 review: the replay check and the write must be one step, or two sign-ins sent together both pass the check.
describe('handleWebAuthnReauth with an atomic store (recordSignIn)', () => {
  /** A store whose recordSignIn only writes when the challenge is newer than the device's last, as one atomic step. */
  async function atomicDevice() {
    const device = await registeredDevice();
    const { record, store } = device;
    (store as WebAuthnAuthStore).recordSignIn = vi.fn(async (_requestId: string, challengeIssuedAt: number, patch: Partial<WebAuthnAuthRecord>) => {
      if ((record.lastChallengeIssuedAt ?? 0) >= challengeIssuedAt) return false;
      Object.assign(record, patch, { lastChallengeIssuedAt: challengeIssuedAt });
      return true;
    });
    return device;
  }

  it('signs in through recordSignIn, with no plain update', async () => {
    const { passkey, store } = await atomicDevice();

    await handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails }, vi.fn(), NOW);

    expect({ recorded: vi.mocked(store.recordSignIn!).mock.calls.length, updated: vi.mocked(store.update).mock.calls.length }).toEqual({ recorded: 1, updated: 0 });
  });

  it('lets only one of two identical sign-ins sent together through, and sets one session cookie', async () => {
    const { passkey, store } = await atomicDevice();
    const credential = passkey.signIn(signer.issue(NOW));
    const setCookie = vi.fn();

    const results = await Promise.allSettled([
      handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails }, setCookie, NOW),
      handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails }, setCookie, NOW),
    ]);

    expect({ accepted: results.filter(result => result.status === 'fulfilled').length, cookies: setCookie.mock.calls.length }).toEqual({ accepted: 1, cookies: 1 });
  });
});
