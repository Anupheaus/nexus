import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as WebAuthnUtils from './webauthnUtils';
import { performWebAuthnReauth } from './webauthnReauth';
import { getInstallationId } from './installationId';

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

vi.mock('./webauthnUtils', async importOriginal => ({
  ...(await importOriginal<typeof WebAuthnUtils>()),
  getPrfResult: vi.fn(() => fakePrfBuffer),
  getRpId: vi.fn(() => 'test-rp-id'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredential(): PublicKeyCredential {
  return {
    type: 'public-key',
    id: 'cred-id',
    rawId: new Uint8Array([1, 2]).buffer,
    response: { clientDataJSON: new Uint8Array([3]).buffer, authenticatorData: new Uint8Array([5]).buffer, signature: new Uint8Array([6]).buffer, userHandle: null } as unknown as AuthenticatorResponse,
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
  return (navigator.credentials.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as
    { publicKey: PublicKeyCredentialRequestOptions & { extensions: { prf: { eval: { first: BufferSource } } } } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performWebAuthnReauth', () => {
  const mockCallReauth = vi.fn(async () => ({ userId: 'user-99', accountId: undefined as string | undefined }));
  /** The server's signed challenge: the bytes 'challenge-1', base64url-encoded. */
  const ISSUED_CHALLENGE = Buffer.from('challenge-1').toString('base64url');
  const mockCallChallenge = vi.fn(async () => ({ challenge: ISSUED_CHALLENGE }));
  const reconnect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigatorCredentials(makeCredential());
  });

  // sc-627: the passkey signs the server's challenge, and the server verifies that signature. No key hash is sent.
  it('signs the challenge the server issued, and sends the signed response (never a key hash) with the device details', async () => {
    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined);

    const [req] = mockCallReauth.mock.calls[0] as unknown as [Record<string, any>];
    expect({
      challenge: new TextDecoder().decode(getLastGetOptions().publicKey.challenge as ArrayBuffer),
      credential: req.credential,
      keyHash: req.keyHash,
      userAgent: req.deviceDetails.userAgent,
      installationId: req.installationId,
    }).toEqual({
      challenge: 'challenge-1',
      credential: { id: 'cred-id', rawId: 'AQI', type: 'public-key', response: { clientDataJSON: 'Aw', authenticatorData: 'BQ', signature: 'Bg' }, clientExtensionResults: {} },
      keyHash: undefined,
      userAgent: 'test-agent',
      // sc-645: the installation's own id, so a synced passkey signing in here is this installation's device.
      installationId: getInstallationId(),
    });
  });

  it('does not start the ceremony when the server gives no challenge', async () => {
    mockCallChallenge.mockRejectedValueOnce(new Error('Server unavailable'));
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined)).rejects.toThrow('Server unavailable');
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });

  it('calls reconnect after a successful reauth', async () => {
    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('calls onPrf with the userId, PRF ArrayBuffer, and accountId when provided', async () => {
    const onPrf = vi.fn();
    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, onPrf);
    expect(onPrf).toHaveBeenCalledOnce();
    expect(onPrf).toHaveBeenCalledWith('user-99', fakePrfBuffer, undefined);
  });

  it('passes accountId to onPrf when the reauth response includes one', async () => {
    mockCallReauth.mockResolvedValueOnce({ userId: 'user-99', accountId: 'acct-42' });
    const onPrf = vi.fn();
    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, onPrf);
    expect(onPrf).toHaveBeenCalledWith('user-99', fakePrfBuffer, 'acct-42');
  });

  it('reconnects (authenticating the socket) before invoking onPrf, so MXDB sync starts on the authenticated socket', async () => {
    // Regression: onPrf applies the encryption key, which mounts the MXDB sync engine and triggers
    // its first sync dispatch. If that happens before reconnect() authenticates the socket, the
    // dispatch 401s and the client wedges on "Authenticating, please wait...". reconnect() must run
    // first so the only socket sync can start on is the authenticated one.
    const callOrder: string[] = [];
    const onPrf = vi.fn(async () => { callOrder.push('onPrf'); });
    const localReconnect = vi.fn(() => { callOrder.push('reconnect'); });

    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, localReconnect, onPrf);

    expect(callOrder).toEqual(['reconnect', 'onPrf']);
  });

  it('does not call onPrf when onPrf is undefined', async () => {
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined)).resolves.toBeUndefined();
  });

  // --- Error paths ---

  it('throws when navigator.credentials.get returns null (cancelled)', async () => {
    mockNavigatorCredentials(null);
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined))
      .rejects.toThrow('Passkey authentication cancelled or failed');
  });

  it('does not call reconnect when the credential is null', async () => {
    mockNavigatorCredentials(null);
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('throws when getPrfResult returns undefined (PRF not supported)', async () => {
    const { getPrfResult } = await import('./webauthnUtils');
    vi.mocked(getPrfResult).mockReturnValueOnce(undefined);
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined))
      .rejects.toThrow('WebAuthn PRF extension not supported by this authenticator');
  });

  it('does not call reconnect when callReauth throws', async () => {
    mockCallReauth.mockRejectedValueOnce(new Error('re-authentication failed'));
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('propagates errors from callReauth', async () => {
    mockCallReauth.mockRejectedValueOnce(new Error('Network error'));
    await expect(performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined))
      .rejects.toThrow('Network error');
  });

  // --- Consistency with registration ---

  it('uses getRpId() as rpId — consistent with the registration ceremony', async () => {
    const { getRpId } = await import('./webauthnUtils');
    vi.mocked(getRpId).mockReturnValueOnce('custom-rp-id');

    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined);

    const opts = getLastGetOptions();
    expect(opts.publicKey.rpId).toBe('custom-rp-id');
  });

  it('passes the configured relying party to getRpId', async () => {
    const { getRpId } = await import('./webauthnUtils');
    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined, 'my-app', 'vision.lintex.co.uk');
    expect(vi.mocked(getRpId)).toHaveBeenLastCalledWith('vision.lintex.co.uk');
  });

  it('uses "nexus-auth" as the PRF extension eval label — consistent with registration', async () => {
    await performWebAuthnReauth(mockCallChallenge as never, mockCallReauth, reconnect, undefined);

    const opts = getLastGetOptions();
    const label = new TextDecoder().decode(opts.publicKey.extensions.prf.eval.first as ArrayBuffer);
    expect(label).toBe('nexus-auth');
  });
});
