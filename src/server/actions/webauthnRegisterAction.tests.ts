import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, SocketAPIDeviceDetails } from '../../common/auth';
import { handleWebAuthnRegister } from './webauthnRegisterAction';

const deviceDetails: SocketAPIDeviceDetails = {
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
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
    expect(result.accountId).toBe('u1');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      keyHash: 'hash1',
      deviceDetails,
      sessionToken: expect.any(String),
      isEnabled: true,
      registrationToken: undefined,
    }));
  });

  it('calls setCookie with HttpOnly session cookie on success', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const setCookie = vi.fn();
    await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'socketapi_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
