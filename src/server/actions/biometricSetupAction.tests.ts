import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationError } from '@anupheaus/common';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleBiometricSetup } from './biometricSetupAction';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const deviceDetails: NexusDeviceDetails = {
  id: 'device-1',
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

const validSession: WebAuthnAuthRecord = {
  requestId: 'session-r1',
  sessionToken: 'valid-token',
  userId: 'user-42',
  accountId: 'acct-7',
  deviceId: 'device-1',
  isEnabled: true,
};

function makeStore({ session, existingKey }: { session?: WebAuthnAuthRecord; existingKey?: WebAuthnAuthRecord } = {}): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => session),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => existingKey),
    update: vi.fn(),
  };
}

const baseReq = { keyHash: 'hash-abc', deviceDetails };

describe('handleBiometricSetup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws AuthenticationError when no session record is found for the token', async () => {
    const store = makeStore({ session: undefined });
    await expect(handleBiometricSetup(store, baseReq, 'missing-token'))
      .rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws AuthenticationError when the session record is disabled', async () => {
    const disabledSession: WebAuthnAuthRecord = { ...validSession, isEnabled: false };
    const store = makeStore({ session: disabledSession });
    await expect(handleBiometricSetup(store, baseReq, 'valid-token'))
      .rejects.toBeInstanceOf(AuthenticationError);
  });

  it('error message identifies the reason for rejection', async () => {
    const store = makeStore({ session: undefined });
    await expect(handleBiometricSetup(store, baseReq, 'missing-token'))
      .rejects.toThrow('Invalid session for biometric setup');
  });

  it('does nothing when the key hash is already registered (idempotent)', async () => {
    const store = makeStore({ session: validSession, existingKey: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    expect(store.create).not.toHaveBeenCalled();
  });

  it('creates a new record when the session is valid and key is not yet registered', async () => {
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    expect(store.create).toHaveBeenCalledOnce();
  });

  it('creates the record with a fresh UUID requestId', async () => {
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    const [record] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [WebAuthnAuthRecord];
    expect(record.requestId).toMatch(UUID_REGEX);
  });

  it('creates the record with an empty sessionToken', async () => {
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    const [record] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [WebAuthnAuthRecord];
    expect(record.sessionToken).toBe('');
  });

  it('creates the record with userId and accountId copied from the session', async () => {
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    const [record] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [WebAuthnAuthRecord];
    expect(record.userId).toBe('user-42');
    expect(record.accountId).toBe('acct-7');
  });

  it('creates the record with the keyHash and deviceDetails from the request', async () => {
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    const [record] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [WebAuthnAuthRecord];
    expect(record.keyHash).toBe('hash-abc');
    expect(record.deviceDetails).toEqual(deviceDetails);
    expect(record.deviceId).toBe('device-1');
  });

  it('creates the record with isEnabled true', async () => {
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    const [record] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [WebAuthnAuthRecord];
    expect(record.isEnabled).toBe(true);
  });

  it('records lastConnectedAt as a recent timestamp', async () => {
    const before = Date.now();
    const store = makeStore({ session: validSession });
    await handleBiometricSetup(store, baseReq, 'valid-token');
    const after = Date.now();
    const [record] = (store.create as ReturnType<typeof vi.fn>).mock.calls[0] as [WebAuthnAuthRecord];
    expect(record.lastConnectedAt).toBeGreaterThanOrEqual(before);
    expect(record.lastConnectedAt).toBeLessThanOrEqual(after);
  });
});
