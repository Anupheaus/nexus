import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isCapacitorNative,
  hasBiometricCredential,
  performBiometricUnlock,
  storeBiometricKey,
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

describe('performBiometricUnlock (socket already signed in)', () => {
  const onPrf = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setNative(true);
    mockGet.mockResolvedValue({ value: storedCredential });
    mockAuthenticate.mockResolvedValue(undefined);
  });
  afterEach(() => { delete (globalThis as any).window?.Capacitor; });

  it('prompts for biometrics, then delivers the stored key for the signed-in user and account', async () => {
    const callOrder: string[] = [];
    mockAuthenticate.mockImplementation(async () => { callOrder.push('authenticate'); });
    onPrf.mockImplementation(async () => { callOrder.push('onPrf'); });

    const isUnlocked = await performBiometricUnlock({ name: APP_NAME, userId: USER_ID, accountId: 'account-9', onPrf });

    expect(isUnlocked).toBe(true);
    expect(callOrder).toEqual(['authenticate', 'onPrf']);
    const [userId, prfOutput, accountId] = onPrf.mock.calls[0] as [string, ArrayBuffer, string | undefined];
    expect(userId).toBe(USER_ID);
    expect(accountId).toBe('account-9');
    expect(Array.from(new Uint8Array(prfOutput))).toEqual([10, 20, 30, 40]);
  });

  it('returns false WITHOUT prompting when the stored key belongs to a different user', async () => {
    mockGet.mockResolvedValue({ value: JSON.stringify({ userId: 'someone-else', keyBase64: fakeKeyBase64 }) });

    const isUnlocked = await performBiometricUnlock({ name: APP_NAME, userId: USER_ID, onPrf });

    expect(isUnlocked).toBe(false);
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(onPrf).not.toHaveBeenCalled();
  });

  it('throws "no credentials" when nothing is stored', async () => {
    mockGet.mockResolvedValue({ value: null });
    await expect(performBiometricUnlock({ name: APP_NAME, userId: USER_ID, onPrf })).rejects.toThrow('no credentials');
  });

  it('does not deliver the key when biometric authentication fails', async () => {
    mockAuthenticate.mockRejectedValue(new Error('Cancel button was pressed'));
    await expect(performBiometricUnlock({ name: APP_NAME, userId: USER_ID, onPrf })).rejects.toThrow('Cancel button was pressed');
    expect(onPrf).not.toHaveBeenCalled();
  });
});

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
    const [{ key, value }] = mockSet.mock.calls[0] as unknown as [{ key: string; value: string }];
    expect(key).toBe(STORAGE_KEY);
    const parsed = JSON.parse(value);
    expect(parsed.userId).toBe(USER_ID);
    expect(typeof parsed.keyBase64).toBe('string');
  });
});
