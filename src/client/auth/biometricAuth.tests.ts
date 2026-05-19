import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isCapacitorNative,
  hasBiometricCredential,
  performBiometricReauth,
  storeBiometricKey,
  performBiometricSetup,
} from './biometricAuth';

// ---------------------------------------------------------------------------
// Mock optional peer dependencies
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockAuthenticate = vi.fn();
const mockCheckBiometry = vi.fn();

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: mockGet, set: mockSet },
}));

vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { authenticate: mockAuthenticate, checkBiometry: mockCheckBiometry },
}));

vi.mock('./collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    id: 'device-id-1',
    userAgent: 'test-agent', platform: 'test-platform', language: 'en-GB',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test-vendor',
    screenWidth: 1280, screenHeight: 720, viewportWidth: 1280, viewportHeight: 720,
    colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

vi.mock('./webauthnUtils', () => ({
  computeKeyHash: vi.fn(async () => 'mocked-key-hash'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_NAME = 'fitter';
const USER_ID = 'user-123';
const STORAGE_KEY = `nexus:biometric:${APP_NAME}`;
const fakeKeyBytes = new Uint8Array([10, 20, 30, 40]).buffer;
const fakeKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(fakeKeyBytes)));
const storedCredential = JSON.stringify({ userId: USER_ID, keyBase64: fakeKeyBase64 });

function setNative(value: boolean) {
  (globalThis as any).window = {
    ...((globalThis as any).window ?? {}),
    Capacitor: { isNativePlatform: () => value },
  };
}

// ---------------------------------------------------------------------------
// isCapacitorNative
// ---------------------------------------------------------------------------

describe('isCapacitorNative', () => {
  afterEach(() => {
    delete (globalThis as any).window?.Capacitor;
  });

  it('returns true when Capacitor.isNativePlatform() returns true', () => {
    setNative(true);
    expect(isCapacitorNative()).toBe(true);
  });

  it('returns false when Capacitor.isNativePlatform() returns false', () => {
    setNative(false);
    expect(isCapacitorNative()).toBe(false);
  });

  it('returns false when window.Capacitor is absent', () => {
    delete (globalThis as any).window?.Capacitor;
    expect(isCapacitorNative()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasBiometricCredential
// ---------------------------------------------------------------------------

describe('hasBiometricCredential', () => {
  beforeEach(() => { vi.clearAllMocks(); setNative(true); });
  afterEach(() => { delete (globalThis as any).window?.Capacitor; });

  it('returns false on non-native platform without touching storage', async () => {
    setNative(false);
    const result = await hasBiometricCredential(APP_NAME);
    expect(result).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns true when a credential exists in storage', async () => {
    mockGet.mockResolvedValueOnce({ value: storedCredential });
    expect(await hasBiometricCredential(APP_NAME)).toBe(true);
  });

  it('returns false when storage throws (no credential)', async () => {
    mockGet.mockRejectedValueOnce(new Error('not found'));
    expect(await hasBiometricCredential(APP_NAME)).toBe(false);
  });

  it('reads the correct storage key', async () => {
    mockGet.mockResolvedValueOnce({ value: storedCredential });
    await hasBiometricCredential(APP_NAME);
    expect(mockGet).toHaveBeenCalledWith({ key: STORAGE_KEY });
  });
});

// ---------------------------------------------------------------------------
// performBiometricReauth
// ---------------------------------------------------------------------------

describe('performBiometricReauth', () => {
  const mockCallReauth = vi.fn(async () => ({ userId: USER_ID, accountId: undefined as string | undefined }));
  const reconnect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setNative(true);
    mockGet.mockResolvedValue({ value: storedCredential });
    mockAuthenticate.mockResolvedValue(undefined);
  });
  afterEach(() => { delete (globalThis as any).window?.Capacitor; });

  it('calls biometric authenticate before reading the stored key', async () => {
    const callOrder: string[] = [];
    mockAuthenticate.mockImplementation(async () => { callOrder.push('authenticate'); });
    mockCallReauth.mockImplementation(async () => { callOrder.push('reauth'); return { userId: USER_ID, accountId: undefined }; });

    await performBiometricReauth(mockCallReauth, reconnect, APP_NAME);

    expect(callOrder).toEqual(['authenticate', 'reauth']);
  });

  it('calls reauth with the computed keyHash', async () => {
    await performBiometricReauth(mockCallReauth, reconnect, APP_NAME);
    expect(mockCallReauth).toHaveBeenCalledOnce();
    const [req] = mockCallReauth.mock.calls[0] as [{ keyHash: string }];
    expect(req.keyHash).toBe('mocked-key-hash');
  });

  it('calls reconnect after a successful reauth', async () => {
    await performBiometricReauth(mockCallReauth, reconnect, APP_NAME);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('throws "no credentials" when storage returns nothing', async () => {
    mockGet.mockRejectedValueOnce(new Error('not found'));
    await expect(performBiometricReauth(mockCallReauth, reconnect, APP_NAME))
      .rejects.toThrow('no credentials');
  });

  it('does not call reconnect when callReauth throws', async () => {
    mockCallReauth.mockRejectedValueOnce(new Error('server error'));
    await expect(performBiometricReauth(mockCallReauth, reconnect, APP_NAME)).rejects.toThrow();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('does not call reauth when biometric authentication fails', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('cancelled'));
    await expect(performBiometricReauth(mockCallReauth, reconnect, APP_NAME)).rejects.toThrow('cancelled');
    expect(mockCallReauth).not.toHaveBeenCalled();
  });

  it('propagates errors from callReauth', async () => {
    mockCallReauth.mockRejectedValueOnce(new Error('Network error'));
    await expect(performBiometricReauth(mockCallReauth, reconnect, APP_NAME))
      .rejects.toThrow('Network error');
  });
});

// ---------------------------------------------------------------------------
// storeBiometricKey
// ---------------------------------------------------------------------------

describe('storeBiometricKey', () => {
  beforeEach(() => { vi.clearAllMocks(); setNative(true); });
  afterEach(() => { delete (globalThis as any).window?.Capacitor; });

  it('does nothing on non-native platform', async () => {
    setNative(false);
    await storeBiometricKey(APP_NAME, USER_ID, fakeKeyBytes);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('does nothing when a credential is already stored (does not overwrite)', async () => {
    mockGet.mockResolvedValueOnce({ value: storedCredential });
    await storeBiometricKey(APP_NAME, USER_ID, fakeKeyBytes);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('writes the credential to secure storage when none exists', async () => {
    mockGet.mockRejectedValueOnce(new Error('not found'));
    await storeBiometricKey(APP_NAME, USER_ID, fakeKeyBytes);
    expect(mockSet).toHaveBeenCalledOnce();
    const [{ key, value }] = mockSet.mock.calls[0] as [{ key: string; value: string }][];
    expect(key).toBe(STORAGE_KEY);
    const parsed = JSON.parse(value);
    expect(parsed.userId).toBe(USER_ID);
    expect(typeof parsed.keyBase64).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// performBiometricSetup
// ---------------------------------------------------------------------------

describe('performBiometricSetup', () => {
  const mockCallSetup = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    setNative(true);
    // Default: biometrics available, no credential stored yet
    mockCheckBiometry.mockResolvedValue({ isAvailable: true });
    mockGet.mockRejectedValue(new Error('not found'));
    mockAuthenticate.mockResolvedValue(undefined);
    mockSet.mockResolvedValue(undefined);
  });
  afterEach(() => { delete (globalThis as any).window?.Capacitor; });

  it('does nothing on non-native platform', async () => {
    setNative(false);
    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });
    expect(mockCallSetup).not.toHaveBeenCalled();
  });

  it('does nothing when biometrics are unavailable', async () => {
    mockCheckBiometry.mockResolvedValueOnce({ isAvailable: false });
    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });
    expect(mockCallSetup).not.toHaveBeenCalled();
  });

  it('does nothing when a credential is already stored', async () => {
    mockGet.mockResolvedValueOnce({ value: storedCredential });
    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });
    expect(mockCallSetup).not.toHaveBeenCalled();
  });

  it('calls biometric authenticate, then the setup action, then stores the credential', async () => {
    const callOrder: string[] = [];
    mockAuthenticate.mockImplementation(async () => { callOrder.push('authenticate'); });
    mockCallSetup.mockImplementation(async () => { callOrder.push('setup'); });
    mockSet.mockImplementation(async () => { callOrder.push('store'); });

    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });

    expect(callOrder).toEqual(['authenticate', 'setup', 'store']);
  });

  it('calls the setup action with the computed keyHash and device details', async () => {
    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });
    expect(mockCallSetup).toHaveBeenCalledOnce();
    const [req] = mockCallSetup.mock.calls[0] as [{ keyHash: string; deviceDetails: { id: string } }][];
    expect(req.keyHash).toBe('mocked-key-hash');
    expect(req.deviceDetails.id).toBe('device-id-1');
  });

  it('stores the credential under the correct key', async () => {
    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });
    expect(mockSet).toHaveBeenCalledOnce();
    const [{ key }] = mockSet.mock.calls[0] as [{ key: string; value: string }][];
    expect(key).toBe(STORAGE_KEY);
  });

  it('stores the userId with the credential', async () => {
    await performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID });
    const [{ value }] = mockSet.mock.calls[0] as [{ key: string; value: string }][];
    expect(JSON.parse(value).userId).toBe(USER_ID);
  });

  it('does not throw when biometric authenticate is rejected (non-fatal)', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('biometric failed'));
    await expect(
      performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID }),
    ).rejects.toThrow('biometric failed');
    expect(mockCallSetup).not.toHaveBeenCalled();
  });

  it('does not store a credential when callSetup throws', async () => {
    mockCallSetup.mockRejectedValueOnce(new Error('server error'));
    await expect(
      performBiometricSetup({ callSetup: mockCallSetup, name: APP_NAME, userId: USER_ID }),
    ).rejects.toThrow('server error');
    expect(mockSet).not.toHaveBeenCalled();
  });
});
