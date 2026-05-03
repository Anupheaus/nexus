import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performWebAuthnReauth } from './webauthnReauth';

// Stub browser-level dependencies so tests run in jsdom without real hardware.
vi.mock('./collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test-agent', platform: 'test-platform', language: 'en-GB',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test-vendor',
    screenWidth: 1280, screenHeight: 720, viewportWidth: 1280, viewportHeight: 720,
    colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

const fakePrfBuffer = new Uint8Array([1, 2, 3, 4]).buffer;

vi.mock('./webauthnUtils', () => ({
  getPrfResult: vi.fn(() => fakePrfBuffer),
  computeKeyHash: vi.fn(async () => 'abc123keyhash'),
  getRpId: vi.fn(() => 'test-rp-id'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredential(): PublicKeyCredential {
  return {
    type: 'public-key',
    id: 'cred-id',
    rawId: new ArrayBuffer(8),
    response: {} as AuthenticatorResponse,
    authenticatorAttachment: null,
    getClientExtensionResults: () => ({ prf: { results: { first: fakePrfBuffer } } }),
  } as unknown as PublicKeyCredential;
}

function mockNavigatorCredentials(result: PublicKeyCredential | null) {
  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: { get: vi.fn().mockResolvedValue(result) },
    configurable: true,
    writable: true,
  });
}

function getLastGetOptions() {
  return (navigator.credentials.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as
    { publicKey: PublicKeyCredentialRequestOptions & { extensions: { prf: { eval: { first: BufferSource } } } } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performWebAuthnReauth', () => {
  const mockCallReauth = vi.fn(async () => ({ userId: 'user-99', accountId: undefined as string | undefined }));
  const reconnect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigatorCredentials(makeCredential());
  });

  it('calls the reauth action with keyHash and deviceDetails', async () => {
    await performWebAuthnReauth(mockCallReauth, reconnect, undefined);

    expect(mockCallReauth).toHaveBeenCalledOnce();
    const req = mockCallReauth.mock.calls[0][0] as Record<string, unknown>;
    expect(req.keyHash).toBe('abc123keyhash');
    expect((req.deviceDetails as any).userAgent).toBe('test-agent');
  });

  it('calls reconnect after a successful reauth', async () => {
    await performWebAuthnReauth(mockCallReauth, reconnect, undefined);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('calls onPrf with the userId, PRF ArrayBuffer, and accountId when provided', async () => {
    const onPrf = vi.fn();
    await performWebAuthnReauth(mockCallReauth, reconnect, onPrf);
    expect(onPrf).toHaveBeenCalledOnce();
    expect(onPrf).toHaveBeenCalledWith('user-99', fakePrfBuffer, undefined);
  });

  it('passes accountId to onPrf when the reauth response includes one', async () => {
    mockCallReauth.mockResolvedValueOnce({ userId: 'user-99', accountId: 'acct-42' });
    const onPrf = vi.fn();
    await performWebAuthnReauth(mockCallReauth, reconnect, onPrf);
    expect(onPrf).toHaveBeenCalledWith('user-99', fakePrfBuffer, 'acct-42');
  });

  it('awaits an async onPrf before calling reconnect', async () => {
    const callOrder: string[] = [];
    const onPrf = vi.fn(async () => { callOrder.push('onPrf'); });
    const localReconnect = vi.fn(() => { callOrder.push('reconnect'); });

    await performWebAuthnReauth(mockCallReauth, localReconnect, onPrf);

    expect(callOrder).toEqual(['onPrf', 'reconnect']);
  });

  it('does not call onPrf when onPrf is undefined', async () => {
    await expect(performWebAuthnReauth(mockCallReauth, reconnect, undefined)).resolves.toBeUndefined();
  });

  // --- Error paths ---

  it('throws when navigator.credentials.get returns null (cancelled)', async () => {
    mockNavigatorCredentials(null);
    await expect(performWebAuthnReauth(mockCallReauth, reconnect, undefined))
      .rejects.toThrow('Passkey authentication cancelled or failed');
  });

  it('does not call reconnect when the credential is null', async () => {
    mockNavigatorCredentials(null);
    await expect(performWebAuthnReauth(mockCallReauth, reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('throws when getPrfResult returns undefined (PRF not supported)', async () => {
    const { getPrfResult } = await import('./webauthnUtils');
    vi.mocked(getPrfResult).mockReturnValueOnce(undefined);
    await expect(performWebAuthnReauth(mockCallReauth, reconnect, undefined))
      .rejects.toThrow('WebAuthn PRF extension not supported by this authenticator');
  });

  it('does not call reconnect when callReauth throws', async () => {
    mockCallReauth.mockRejectedValueOnce(new Error('re-authentication failed'));
    await expect(performWebAuthnReauth(mockCallReauth, reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('propagates errors from callReauth', async () => {
    mockCallReauth.mockRejectedValueOnce(new Error('Network error'));
    await expect(performWebAuthnReauth(mockCallReauth, reconnect, undefined))
      .rejects.toThrow('Network error');
  });

  // --- Consistency with registration ---

  it('uses getRpId() as rpId — consistent with the registration ceremony', async () => {
    const { getRpId } = await import('./webauthnUtils');
    vi.mocked(getRpId).mockReturnValueOnce('custom-rp-id');

    await performWebAuthnReauth(mockCallReauth, reconnect, undefined);

    const opts = getLastGetOptions();
    expect(opts.publicKey.rpId).toBe('custom-rp-id');
  });

  it('uses "socket-api-auth" as the PRF extension eval label — consistent with registration', async () => {
    await performWebAuthnReauth(mockCallReauth, reconnect, undefined);

    const opts = getLastGetOptions();
    const label = new TextDecoder().decode(opts.publicKey.extensions.prf.eval.first as ArrayBuffer);
    expect(label).toBe('socket-api-auth');
  });
});
