import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performWebAuthnReauth } from './webauthnReauth';

// ---------------------------------------------------------------------------
// performWebAuthnReauth
// ---------------------------------------------------------------------------
// Purpose: Run a WebAuthn get-credential ceremony against an existing passkey,
// derive a key hash from the PRF output, POST to the reauth endpoint (with
// device details), call onPrf with the userId and PRF ArrayBuffer if provided,
// and call reconnect() to re-establish the socket session.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performWebAuthnReauth', () => {
  const globalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ userId: 'user-99' }),
    });
    mockNavigatorCredentials(makeCredential());
  });

  afterEach(() => {
    globalThis.fetch = globalFetch;
    vi.clearAllMocks();
  });

  // --- Happy path ---

  it('POSTs to the correct reauth URL with JSON content-type and credentials:include', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    });
    globalThis.fetch = mockFetch;

    await performWebAuthnReauth('myApi', vi.fn(), undefined);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/myApi/socketAPI/webauthn/reauth');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('uses the api name in the URL path', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    });
    globalThis.fetch = mockFetch;

    await performWebAuthnReauth('otherName', vi.fn(), undefined);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/otherName/socketAPI/webauthn/reauth');
  });

  it('sends keyHash and deviceDetails in the request body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    });
    globalThis.fetch = mockFetch;

    await performWebAuthnReauth('myApi', vi.fn(), undefined);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.keyHash).toBe('abc123keyhash');
    expect(body.deviceDetails).toBeDefined();
    expect(body.deviceDetails.userAgent).toBe('test-agent');
  });

  it('calls reconnect after a successful reauth', async () => {
    const reconnect = vi.fn();
    await performWebAuthnReauth('myApi', reconnect, undefined);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('calls onPrf with the userId and PRF ArrayBuffer when provided', async () => {
    const onPrf = vi.fn();
    await performWebAuthnReauth('myApi', vi.fn(), onPrf);
    expect(onPrf).toHaveBeenCalledOnce();
    expect(onPrf).toHaveBeenCalledWith('user-99', fakePrfBuffer);
  });

  it('awaits an async onPrf before calling reconnect', async () => {
    const callOrder: string[] = [];
    const onPrf = vi.fn(async () => { callOrder.push('onPrf'); });
    const reconnect = vi.fn(() => { callOrder.push('reconnect'); });

    await performWebAuthnReauth('myApi', reconnect, onPrf);

    expect(callOrder).toEqual(['onPrf', 'reconnect']);
  });

  it('does not call onPrf when onPrf is undefined', async () => {
    // No assertion needed beyond the function not throwing — this exercises
    // the `if (onPrf)` guard.
    await expect(performWebAuthnReauth('myApi', vi.fn(), undefined)).resolves.toBeUndefined();
  });

  // --- Error paths ---

  it('throws when navigator.credentials.get returns null (cancelled)', async () => {
    mockNavigatorCredentials(null);

    await expect(performWebAuthnReauth('myApi', vi.fn(), undefined))
      .rejects.toThrow('Passkey authentication cancelled or failed');
  });

  it('does not call reconnect when the credential is null', async () => {
    mockNavigatorCredentials(null);

    const reconnect = vi.fn();
    await expect(performWebAuthnReauth('myApi', reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('throws when getPrfResult returns undefined (PRF not supported)', async () => {
    const { getPrfResult } = await import('./webauthnUtils');
    vi.mocked(getPrfResult).mockReturnValueOnce(undefined);

    await expect(performWebAuthnReauth('myApi', vi.fn(), undefined))
      .rejects.toThrow('WebAuthn PRF extension not supported by this authenticator');
  });

  it('throws when the server returns a non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(performWebAuthnReauth('myApi', vi.fn(), undefined))
      .rejects.toThrow('WebAuthn re-authentication failed: 401');
  });

  it('includes the HTTP status code in the error message on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(performWebAuthnReauth('myApi', vi.fn(), undefined))
      .rejects.toThrow('WebAuthn re-authentication failed: 403');
  });

  it('does not call reconnect when the server returns a non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const reconnect = vi.fn();
    await expect(performWebAuthnReauth('myApi', reconnect, undefined)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('propagates a network-level error thrown by fetch', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const reconnect = vi.fn();
    await expect(performWebAuthnReauth('myApi', reconnect, undefined)).rejects.toThrow('Network error');
    expect(reconnect).not.toHaveBeenCalled();
  });
});
