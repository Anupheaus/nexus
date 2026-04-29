import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performJwtSignIn } from './jwtAuth';

// ---------------------------------------------------------------------------
// performJwtSignIn
// ---------------------------------------------------------------------------
// Purpose: POST credentials (merged with device fingerprint) to the signin
// endpoint; throw a descriptive error on non-OK HTTP responses; call
// reconnect() on success.
// ---------------------------------------------------------------------------

// collectDeviceDetails and computeDeviceId are internal implementation details
// used by the function under test.  We stub them to keep tests deterministic
// and free from browser-API constraints in jsdom.
vi.mock('./collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test-agent', platform: 'test-platform', language: 'en-GB',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test-vendor',
    screenWidth: 1280, screenHeight: 720, viewportWidth: 1280, viewportHeight: 720,
    colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

vi.mock('./computeDeviceId', () => ({
  computeDeviceId: vi.fn(async () => 'stable-device-id'),
}));

describe('performJwtSignIn', () => {
  const globalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = globalFetch;
    vi.clearAllMocks();
  });

  it('POSTs to the correct signin URL with JSON content-type and credentials:include', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const reconnect = vi.fn();
    await performJwtSignIn('myApi', { email: 'a@b.com', password: 'secret' }, reconnect);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/myApi/socketAPI/signin');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('merges credentials with deviceId and deviceDetails in the request body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const reconnect = vi.fn();
    await performJwtSignIn('myApi', { email: 'a@b.com', password: 'secret' }, reconnect);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.email).toBe('a@b.com');
    expect(body.password).toBe('secret');
    expect(body.deviceId).toBe('stable-device-id');
    expect(body.deviceDetails).toBeDefined();
    expect(body.deviceDetails.userAgent).toBe('test-agent');
  });

  it('calls reconnect after a successful sign-in', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const reconnect = vi.fn();
    await performJwtSignIn('myApi', { email: 'a@b.com', password: 'p' }, reconnect);

    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('does not call reconnect when the server returns a non-OK status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const reconnect = vi.fn();
    await expect(performJwtSignIn('myApi', { email: 'a@b.com', password: 'p' }, reconnect))
      .rejects.toThrow('Sign in failed: 401');
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('throws an error whose message includes the HTTP status code on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(performJwtSignIn('myApi', {}, vi.fn()))
      .rejects.toThrow('Sign in failed: 403');
  });

  it('uses the api name in the URL path', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    await performJwtSignIn('otherName', {}, vi.fn());

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/otherName/socketAPI/signin');
  });

  it('propagates a network-level error thrown by fetch', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const reconnect = vi.fn();
    await expect(performJwtSignIn('myApi', {}, reconnect)).rejects.toThrow('Network error');
    expect(reconnect).not.toHaveBeenCalled();
  });
});
