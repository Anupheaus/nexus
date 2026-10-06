import { describe, it, expect, vi } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails, PasskeySignInClaim } from '../../common/auth';
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
/** The installation the device registered on (sc-645). */
const INSTALLATION = 'installation-phone';
const deviceDetails: NexusDeviceDetails = {
  id: 'device-1', userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

/** A registered device (its passkey and record) in a store that finds it by its credential id. */
async function registeredDevice(overrides: Partial<WebAuthnAuthRecord> = {}) {
  const passkey = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
  const stored = await verifyPasskeyRegistration(verification, passkey.register(new TextEncoder().encode('tok')), 'tok');
  const record = { requestId: 'r1', userId: 'u1', accountId: 'a1', sessionToken: 'old', deviceId: 'd', isEnabled: true, installationId: INSTALLATION, ...stored!, ...overrides } as WebAuthnAuthRecord;
  const claimed = new Set<string>();
  const store = {
    create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(), findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
    findByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? record : undefined)),
    findAllByCredentialId: vi.fn(async (id: string) => (id === record.credentialId ? [record] : [])),
    // Check and record in one synchronous step, as a store's atomic write does.
    claimPasskeySignIn: vi.fn(async ({ challenge }: PasskeySignInClaim) => (claimed.has(challenge) ? false : (claimed.add(challenge), true))),
    isPasskeyRevoked: vi.fn(async () => false),
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

    const result = await handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: INSTALLATION }, setCookie, NOW + 1_000);

    expect({ result, update: vi.mocked(store.update).mock.calls[0], cookie: setCookie.mock.calls[0]?.[0] }).toEqual({
      result: { userId: 'u1', accountId: 'a1' },
      update: ['r1', { sessionToken: expect.not.stringMatching(/^old$/), lastConnectedAt: NOW + 1_000, deviceDetails, credentialCounter: 0, installationId: INSTALLATION, lastChallengeIssuedAt: NOW }],
      cookie: 'nexus_session',
    });
  });

  it('refuses the same sign-in sent again, once the device has answered that challenge', async () => {
    const { passkey, store, record } = await registeredDevice();
    const credential = passkey.signIn(signer.issue(NOW));
    await handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: INSTALLATION }, vi.fn(), NOW + 1_000);
    record.lastChallengeIssuedAt = NOW;

    await expect(handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: INSTALLATION }, vi.fn(), NOW + 2_000)).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it.each([
    ['a disabled device', { isEnabled: false }],
  ])('refuses %s, however valid its signature', async (_label, overrides) => {
    const { passkey, store } = await registeredDevice(overrides);
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId: INSTALLATION }, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(store.update).not.toHaveBeenCalled();
  });

  it('refuses a passkey no device registered', async () => {
    const { store } = await registeredDevice();
    const stranger = createSoftwarePasskey({ rpId: RP_ID, origin: ORIGIN });
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: stranger.signIn(signer.issue(NOW)), deviceDetails, installationId: INSTALLATION }, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('refuses a bare key hash, which no longer signs anyone in', async () => {
    const { store } = await registeredDevice();
    const setCookie = vi.fn();
    await expect(handleWebAuthnReauth(store, verification, signer, { keyHash: 'abc', deviceDetails, installationId: INSTALLATION } as never, setCookie, NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect({ lookups: vi.mocked(store.findAllByCredentialId).mock.calls.length, cookies: setCookie.mock.calls.length }).toEqual({ lookups: 0, cookies: 0 });
  });

  // sc-620: { "id": { "$ne": null } } would find the first registered device in a MongoDB store.
  it.each([{ $ne: null }, { $gt: '' }, ['k'], 1, '', null])('refuses a credential id that is not a non-empty string (%j) without looking it up', async id => {
    const { passkey, store } = await registeredDevice();
    const credential = { ...passkey.signIn(signer.issue(NOW)), id };
    await expect(handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: INSTALLATION } as never, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(store.findAllByCredentialId).not.toHaveBeenCalled();
  });

  it.each([{ $ne: null }, ['k'], 1, '', null, undefined, 'x'.repeat(129)])('refuses an installation id that is not a short non-empty string (%j) without looking it up', async installationId => {
    const { passkey, store } = await registeredDevice();
    await expect(handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId } as never, vi.fn(), NOW)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(store.findAllByCredentialId).not.toHaveBeenCalled();
  });

  it('adopts a device registered before installations were told apart: the first installation to sign in becomes it', async () => {
    const { passkey, store } = await registeredDevice({ installationId: undefined });

    await handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId: INSTALLATION }, vi.fn(), NOW);

    expect({ updated: vi.mocked(store.update).mock.calls[0]?.[1], created: vi.mocked(store.create).mock.calls.length })
      .toEqual({ updated: expect.objectContaining({ installationId: INSTALLATION }), created: 0 });
  });
});

// sc-645: Google Password Manager and iCloud Keychain sync a passkey, so one credential signs in on several installations.
describe('handleWebAuthnReauth with a synced passkey', () => {
  const LAPTOP = 'installation-laptop';

  /**
   * A store keeping the WebAuthnAuthStore contract the way mxdb's does: a unique (credential id, installation id) index,
   * recordSignIn, a passkey-level claim per signed challenge, and a passkey revoked whenever one of its devices is
   * disabled or deleted (kept after the delete). Every check-and-write is one synchronous step, as an atomic write is.
   */
  async function syncedPasskeyStore(overrides: Partial<WebAuthnAuthRecord> = {}) {
    const { passkey, record } = await registeredDevice(overrides);
    const records: WebAuthnAuthRecord[] = [record];
    const claimedChallenges = new Set<string>();
    const revokedPasskeys = new Set<string>(record.isEnabled ? [] : [record.credentialId!]);
    const store = {
      findAllByCredentialId: vi.fn(async (id: string) => records.filter(({ credentialId }) => credentialId === id).map(found => ({ ...found }))),
      create: vi.fn(async (created: WebAuthnAuthRecord) => {
        if (records.some(({ credentialId, installationId }) => credentialId === created.credentialId && installationId === created.installationId)) throw new Error('Passkey already registered');
        records.push({ ...created });
      }),
      recordSignIn: vi.fn(async (requestId: string, challengeIssuedAt: number, patch: Partial<WebAuthnAuthRecord>) => {
        const found = records.find(candidate => candidate.requestId === requestId);
        if (found == null || !found.isEnabled || (found.lastChallengeIssuedAt ?? 0) >= challengeIssuedAt) return false;
        Object.assign(found, patch);
        return true;
      }),
      claimPasskeySignIn: vi.fn(async ({ credentialId, challenge, isNewDevice }: PasskeySignInClaim) => {
        const key = `${credentialId}:${challenge}`;
        if (claimedChallenges.has(key) || (isNewDevice && revokedPasskeys.has(credentialId))) return false;
        claimedChallenges.add(key);
        return true;
      }),
      isPasskeyRevoked: vi.fn(async (credentialId: string) => revokedPasskeys.has(credentialId)),
      update: vi.fn(async (requestId: string, patch: Partial<WebAuthnAuthRecord>) => {
        const found = records.find(candidate => candidate.requestId === requestId);
        if (found == null) return;
        Object.assign(found, patch);
        if (patch.isEnabled === false && found.credentialId != null) revokedPasskeys.add(found.credentialId);
      }),
    } as unknown as WebAuthnAuthStore;
    /** Deletes a device, as an admin does from the device list: its passkey stays revoked. */
    const deleteDevice = (requestId: string) => {
      const index = records.findIndex(candidate => candidate.requestId === requestId);
      const [deleted] = records.splice(index, 1);
      if (deleted?.credentialId != null) revokedPasskeys.add(deleted.credentialId);
    };
    return { passkey, records, store, deleteDevice };
  }

  const signInOn = (store: WebAuthnAuthStore, credential: ReturnType<ReturnType<typeof createSoftwarePasskey>['signIn']>, installationId: string, setCookie = vi.fn(), now = NOW) =>
    handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails: { ...deviceDetails, id: installationId }, installationId }, setCookie, now);

  it('registers a second installation as a new device, and leaves the first signed in', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    const laptopCookie = vi.fn();

    const result = await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, laptopCookie);

    const [phone, laptop] = records;
    expect({
      result,
      count: records.length,
      phone: { sessionToken: phone?.sessionToken, installationId: phone?.installationId },
      laptop: { ...laptop, requestId: typeof laptop?.requestId, deviceId: typeof laptop?.deviceId },
      cookie: laptopCookie.mock.calls[0]?.slice(0, 2),
    }).toEqual({
      result: { userId: 'u1', accountId: 'a1' },
      count: 2,
      phone: { sessionToken: 'old', installationId: INSTALLATION },
      laptop: {
        requestId: 'string', deviceId: 'string', userId: 'u1', accountId: 'a1', isEnabled: true, sessionToken: laptopCookie.mock.calls[0]?.[1],
        credentialId: passkey.credentialId, credentialPublicKey: phone?.credentialPublicKey, credentialCounter: 0, lastChallengeIssuedAt: NOW,
        installationId: LAPTOP, deviceDetails: { ...deviceDetails, id: LAPTOP }, lastConnectedAt: NOW, createdAt: NOW,
      },
      cookie: ['nexus_session', expect.any(String)],
    });
    expect(laptop?.requestId).not.toBe(phone?.requestId);
  });

  it('keeps both installations signed in: each signs in again on its own device, with its own session', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, vi.fn(), NOW);
    const laptopSession = records[1]?.sessionToken;

    await signInOn(store, passkey.signIn(signer.issue(NOW + 1_000)), INSTALLATION, vi.fn(), NOW + 1_000);

    expect({ count: records.length, laptopSession: records[1]?.sessionToken, phoneSession: records[0]?.sessionToken })
      .toEqual({ count: 2, laptopSession, phoneSession: expect.not.stringMatching(/^old$/) });
    expect(records[0]?.sessionToken).not.toBe(laptopSession);
  });

  it('signs a returning second installation in on the device it registered, without creating another', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, vi.fn(), NOW);

    await signInOn(store, passkey.signIn(signer.issue(NOW + 1_000)), LAPTOP, vi.fn(), NOW + 1_000);

    expect({ count: records.length, laptopChallenge: records[1]?.lastChallengeIssuedAt }).toEqual({ count: 2, laptopChallenge: NOW + 1_000 });
  });

  it('refuses a sign-in another installation already used, sent again from a new installation', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    const credential = passkey.signIn(signer.issue(NOW));
    await signInOn(store, credential, INSTALLATION, vi.fn(), NOW);

    await expect(signInOn(store, credential, LAPTOP, vi.fn(), NOW + 1_000)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records).toHaveLength(1);
  });

  it('lets only one of two identical new-installation sign-ins sent together register, and sets one session cookie', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    const credential = passkey.signIn(signer.issue(NOW));
    const setCookie = vi.fn();

    const results = await Promise.allSettled([signInOn(store, credential, LAPTOP, setCookie), signInOn(store, credential, LAPTOP, setCookie)]);

    expect({ accepted: results.filter(({ status }) => status === 'fulfilled').length, count: records.length, cookies: setCookie.mock.calls.length })
      .toEqual({ accepted: 1, count: 2, cookies: 1 });
  });

  it('refuses a new installation once one of the passkey\'s devices is signed out or disabled: it needs a fresh invite', async () => {
    const { passkey, records, store } = await syncedPasskeyStore({ isEnabled: false });

    await expect(signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records).toHaveLength(1);
  });

  it('refuses a new installation whose signature does not verify against the passkey\'s public key', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    const forged = { ...passkey.signIn(signer.issue(NOW)), response: { ...passkey.signIn(signer.issue(NOW)).response, signature: Buffer.from('forged').toString('base64url') } };

    await expect(signInOn(store, forged, LAPTOP)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records).toHaveLength(1);
  });

  // QA round 1, hole 1: the passkey is shared, so a sign-in is single-use across every device it is synced to.
  it('refuses a sign-in one device used when it is sent again with a sibling device\'s installation id, leaving the sibling signed in', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, vi.fn(), NOW);
    const laptopSignIn = passkey.signIn(signer.issue(NOW + 200));
    await signInOn(store, laptopSignIn, LAPTOP, vi.fn(), NOW + 300);

    await expect(signInOn(store, laptopSignIn, INSTALLATION, vi.fn(), NOW + 400)).rejects.toThrow('WebAuthn re-authentication failed');
    expect({ phoneSession: records[0]?.sessionToken, devices: records.length }).toEqual({ phoneSession: 'old', devices: 2 });
  });

  // QA round 1, hole 2: one signed sign-in creates at most one device, whatever installation ids it is sent with.
  it('registers one device when one sign-in is sent at the same moment with three different new installation ids', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    const credential = passkey.signIn(signer.issue(NOW));
    const setCookie = vi.fn();

    const results = await Promise.allSettled(['NEW-1', 'NEW-2', 'NEW-3'].map(installationId => signInOn(store, credential, installationId, setCookie)));

    expect({ accepted: results.filter(({ status }) => status === 'fulfilled').length, devices: records.length, cookies: setCookie.mock.calls.length })
      .toEqual({ accepted: 1, devices: 2, cookies: 1 });
  });

  // QA round 1, hole 3: a revoke is recorded for the passkey, so deleting the revoked device does not lift it.
  it('still refuses a new installation after the disabled device is deleted, while a sibling remains', async () => {
    const { passkey, records, store, deleteDevice } = await syncedPasskeyStore();
    await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, vi.fn(), NOW);
    await store.update('r1', { isEnabled: false });
    deleteDevice('r1');

    await expect(signInOn(store, passkey.signIn(signer.issue(NOW + 1_000)), 'installation-tablet', vi.fn(), NOW + 1_000)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records.map(({ installationId }) => installationId)).toEqual([LAPTOP]);
  });

  it('refuses a new installation after an enabled device is deleted: removing a device revokes it too', async () => {
    const { passkey, records, store, deleteDevice } = await syncedPasskeyStore();
    await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, vi.fn(), NOW);
    deleteDevice('r1');

    await expect(signInOn(store, passkey.signIn(signer.issue(NOW + 1_000)), 'installation-tablet', vi.fn(), NOW + 1_000)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records).toHaveLength(1);
  });

  it('keeps the remaining sibling signing in after the passkey is revoked: it only stops new installations', async () => {
    const { passkey, records, store, deleteDevice } = await syncedPasskeyStore();
    await signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP, vi.fn(), NOW);
    await store.update('r1', { isEnabled: false });
    deleteDevice('r1');

    await signInOn(store, passkey.signIn(signer.issue(NOW + 1_000)), LAPTOP, vi.fn(), NOW + 1_000);

    expect(records[0]?.lastChallengeIssuedAt).toBe(NOW + 1_000);
  });

  it('keeps refusing new installations after the disabled device is re-enabled: the passkey needs a fresh invite', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    await store.update('r1', { isEnabled: false });
    await store.update('r1', { isEnabled: true });

    await expect(signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records).toHaveLength(1);
  });

  it('disables a new device whose passkey was revoked while it was being registered', async () => {
    const { passkey, records, store } = await syncedPasskeyStore();
    const create = vi.mocked(store.create).getMockImplementation()!;
    vi.mocked(store.create).mockImplementationOnce(async created => {
      await store.update('r1', { isEnabled: false });
      await create(created);
    });

    await expect(signInOn(store, passkey.signIn(signer.issue(NOW)), LAPTOP)).rejects.toThrow('WebAuthn re-authentication failed');
    expect(records.map(({ installationId, isEnabled }) => ({ installationId, isEnabled }))).toEqual([{ installationId: INSTALLATION, isEnabled: false }, { installationId: LAPTOP, isEnabled: false }]);
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

    await handleWebAuthnReauth(store, verification, signer, { credential: passkey.signIn(signer.issue(NOW)), deviceDetails, installationId: INSTALLATION }, vi.fn(), NOW);

    expect({ recorded: vi.mocked(store.recordSignIn!).mock.calls.length, updated: vi.mocked(store.update).mock.calls.length }).toEqual({ recorded: 1, updated: 0 });
    // The patch carries the challenge time, so a store that just writes the patch still advances the replay guard.
    expect(vi.mocked(store.recordSignIn!).mock.calls[0]).toEqual(['r1', NOW, expect.objectContaining({ lastChallengeIssuedAt: NOW })]);
  });

  it('lets only one of two identical sign-ins sent together through, and sets one session cookie', async () => {
    const { passkey, store } = await atomicDevice();
    const credential = passkey.signIn(signer.issue(NOW));
    const setCookie = vi.fn();

    const results = await Promise.allSettled([
      handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: INSTALLATION }, setCookie, NOW),
      handleWebAuthnReauth(store, verification, signer, { credential, deviceDetails, installationId: INSTALLATION }, setCookie, NOW),
    ]);

    expect({ accepted: results.filter(result => result.status === 'fulfilled').length, cookies: setCookie.mock.calls.length }).toEqual({ accepted: 1, cookies: 1 });
  });
});
