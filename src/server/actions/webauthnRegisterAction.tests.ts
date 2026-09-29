import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnRegister } from './webauthnRegisterAction';

const deviceDetails: NexusDeviceDetails = {
  id: 'device-1', userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(record?: Partial<WebAuthnAuthRecord>, claim?: WebAuthnAuthStore['claimRegistration']): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findByKeyHash: vi.fn(async () => undefined),
    update: vi.fn(),
    ...(claim != null ? { claimRegistration: vi.fn(claim) } : {}),
  };
}

describe('handleWebAuthnRegister', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for registrationToken', async () => {
    const setCookie = vi.fn();
    await expect(
      handleWebAuthnRegister(makeStore(undefined), { registrationToken: 'bad', keyHash: 'abc', deviceDetails }, setCookie),
    ).rejects.toThrow('Invalid registration token');
  });

  it.each([
    ['signed out (key hash and device details kept)', { keyHash: 'old', deviceDetails }],
    ['disabled by an admin (key hash only)', { keyHash: 'old' }],
    ['enabled', { isEnabled: true, keyHash: 'old' }],
  ])('refuses to register over a device that is %s, changing nothing', async (_label, registration) => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: '', deviceId: '', registrationToken: 'tok', ...registration });
    const setCookie = vi.fn();

    await expect(handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'new', deviceDetails }, setCookie)).rejects.toThrow('Invalid registration token');
    expect({ updated: vi.mocked(store.update).mock.calls.length, cookies: setCookie.mock.calls.length }).toEqual({ updated: 0, cookies: 0 });
  });

  it('claims the token atomically when the store can: the claim carries the registration, and no plain update runs', async () => {
    const pending = { requestId: 'r1', userId: 'u1', accountId: 'a1', isEnabled: false, sessionToken: '', deviceId: '', registrationToken: 'tok' };
    const store = makeStore(pending, async () => pending);
    const setCookie = vi.fn();

    const result = await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);

    expect({
      result,
      claimedWith: vi.mocked(store.claimRegistration!).mock.calls[0],
      updated: vi.mocked(store.update).mock.calls.length,
    }).toEqual({
      result: { userId: 'u1', accountId: 'a1' },
      claimedWith: ['tok', expect.objectContaining({ keyHash: 'hash1', deviceDetails, isEnabled: true, registrationToken: undefined })],
      updated: 0,
    });
  });

  it('loses the race cleanly: when another registration claimed the token first, it fails and sets no session cookie', async () => {
    const pending = { requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: '', deviceId: '', registrationToken: 'tok' };
    const store = makeStore(pending, async () => undefined);
    const setCookie = vi.fn();

    await expect(handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie)).rejects.toThrow('Invalid registration token');
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('updates record with keyHash, deviceDetails, sessionToken, clears registrationToken', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const setCookie = vi.fn();
    const result = await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);
    expect(result.userId).toBe('u1');
    expect(result.accountId).toBeUndefined();
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      keyHash: 'hash1',
      deviceDetails,
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      isEnabled: true,
      registrationToken: undefined,
    }));
  });

  it('returns accountId from the stored record when provided at invite time', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', accountId: 'acct-99', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const setCookie = vi.fn();
    const result = await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);
    expect(result.userId).toBe('u1');
    expect(result.accountId).toBe('acct-99');
  });

  it('calls setCookie with HttpOnly session cookie on success', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const setCookie = vi.fn();
    await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'nexus_session',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
