import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performJwtSignIn } from './jwtAuth';

// Stub browser-level dependencies so tests run in jsdom without real hardware.
vi.mock('./collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test-agent', platform: 'test-platform', language: 'en-GB',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test-vendor',
    screenWidth: 1280, screenHeight: 720, viewportWidth: 1280, viewportHeight: 720,
    colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

describe('performJwtSignIn', () => {
  const mockCallSignIn = vi.fn(async () => undefined);
  const reconnect = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('calls the signIn action with credentials nested under credentials and deviceDetails', async () => {
    await performJwtSignIn(mockCallSignIn, { email: 'a@b.com', password: 'secret' }, reconnect);

    expect(mockCallSignIn).toHaveBeenCalledOnce();
    const [req] = mockCallSignIn.mock.calls[0] as unknown as [Record<string, unknown>];
    expect((req.credentials as any).email).toBe('a@b.com');
    expect((req.credentials as any).password).toBe('secret');
    expect((req.deviceDetails as any).userAgent).toBe('test-agent');
  });

  it('calls reconnect after a successful sign-in', async () => {
    await performJwtSignIn(mockCallSignIn, { email: 'a@b.com', password: 'p' }, reconnect);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('does not call reconnect when callSignIn throws', async () => {
    mockCallSignIn.mockRejectedValueOnce(new Error('Authentication failed'));
    await expect(performJwtSignIn(mockCallSignIn, { email: 'bad@b.com', password: 'p' }, reconnect))
      .rejects.toThrow('Authentication failed');
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by callSignIn', async () => {
    mockCallSignIn.mockRejectedValueOnce(new Error('Network error'));
    await expect(performJwtSignIn(mockCallSignIn, {}, reconnect)).rejects.toThrow('Network error');
  });
});
