import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnRegister } from './webauthnRegisterAction';

const deviceDetails: NexusDeviceDetails = {
  id: 'device-1', userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findByKeyHash: vi.fn(async () => undefined),
    update: vi.fn(),
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
