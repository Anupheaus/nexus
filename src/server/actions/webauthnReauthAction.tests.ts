import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnReauth } from './webauthnReauthAction';

const deviceDetails: NexusDeviceDetails = {
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
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    update: vi.fn(),
  };
}

describe('handleWebAuthnReauth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for keyHash', async () => {
    const setCookie = vi.fn();
    await expect(
      handleWebAuthnReauth(makeStore(undefined), { keyHash: 'unknown', deviceDetails }, setCookie),
    ).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('throws when record exists but is disabled', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    await expect(
      handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie),
    ).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('issues a fresh session token and updates the record on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    const result = await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie);
    expect(result.userId).toBe('u1');
    expect(result.accountId).toBeUndefined();
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      sessionToken: expect.any(String),
      lastConnectedAt: expect.any(Number),
      deviceDetails,
    }));
    const newToken = (store.update as ReturnType<typeof vi.fn>).mock.calls[0][1].sessionToken;
    expect(newToken).not.toBe('old');
  });

  it('returns accountId from the stored record when provided at invite time', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', accountId: 'acct-77', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    const result = await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie);
    expect(result.userId).toBe('u1');
    expect(result.accountId).toBe('acct-77');
  });

  it('calls setCookie with HttpOnly session cookie on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'nexus_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
