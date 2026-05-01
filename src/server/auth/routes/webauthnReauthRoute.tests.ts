import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, SocketAPIDeviceDetails } from '../../../common/auth';

const { mockSetResponseHeader } = vi.hoisted(() => ({ mockSetResponseHeader: vi.fn() }));

vi.mock('../../async-context/socketApiContext', () => ({
  setResponseHeader: mockSetResponseHeader,
}));

import { handleWebAuthnReauth } from './webauthnReauthRoute';

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
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    update: vi.fn(),
  };
}

describe('handleWebAuthnReauth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for keyHash', async () => {
    await expect(
      handleWebAuthnReauth(makeStore(undefined), { keyHash: 'unknown', deviceDetails }),
    ).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('throws when record exists but is disabled', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    await expect(
      handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }),
    ).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('issues a fresh session token and updates the record on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const result = await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails });
    expect(result.userId).toBe('u1');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      sessionToken: expect.any(String),
      lastConnectedAt: expect.any(Number),
      deviceDetails,
    }));
    const newToken = (store.update as ReturnType<typeof vi.fn>).mock.calls[0][1].sessionToken;
    expect(newToken).not.toBe('old');
  });

  it('sets HttpOnly session cookie on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails });
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socketapi_session='));
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  });
});
