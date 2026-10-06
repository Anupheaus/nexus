import { describe, it, expect } from 'vitest';
import type { WebAuthnAuthRecord } from '../../common/auth';
import { findInstallationDevice, isInstallationId, planNewInstallation } from './passkeyInstallations';

// sc-645: a synced passkey has one device per installation it signs in on.

const device = (overrides: Partial<WebAuthnAuthRecord> = {}): WebAuthnAuthRecord => ({
  requestId: 'r1', sessionToken: 's', userId: 'u1', accountId: 'a1', deviceId: 'd1', isEnabled: true,
  credentialId: 'cred', credentialPublicKey: 'key', credentialCounter: 0, lastChallengeIssuedAt: 100, installationId: 'phone',
  ...overrides,
});

describe('isInstallationId', () => {
  it.each([
    ['a UUID', '0f8fad5b-d9cb-469f-a165-70867728950e', true],
    ['128 characters', 'x'.repeat(128), true],
    ['129 characters', 'x'.repeat(129), false],
    ['an empty string', '', false],
    ['a query operator', { $ne: null }, false],
    ['a number', 1, false],
    ['nothing', undefined, false],
  ])('%s: %s', (_label, value, expected) => {
    expect(isInstallationId(value)).toBe(expected);
  });
});

describe('findInstallationDevice', () => {
  it('finds the device with this installation id', () => {
    const laptop = device({ requestId: 'r2', installationId: 'laptop' });
    expect(findInstallationDevice([device(), laptop], 'laptop')).toBe(laptop);
  });

  it('prefers this installation\'s own device over one registered before installations were told apart', () => {
    const legacy = device({ requestId: 'r0', installationId: undefined });
    const phone = device();
    expect(findInstallationDevice([legacy, phone], 'phone')).toBe(phone);
  });

  it('adopts a device registered before installations were told apart', () => {
    const legacy = device({ installationId: undefined });
    expect(findInstallationDevice([legacy], 'laptop')).toBe(legacy);
  });

  it('finds nothing for an installation the passkey has not signed in on', () => {
    expect(findInstallationDevice([device()], 'laptop')).toBeUndefined();
  });
});

describe('planNewInstallation', () => {
  it('registers from the passkey\'s devices: the highest counter and the latest challenge any of them recorded', () => {
    const devices = [device({ credentialCounter: 3, lastChallengeIssuedAt: 500 }), device({ requestId: 'r2', installationId: 'tablet', credentialCounter: 7, lastChallengeIssuedAt: 200 })];
    expect(planNewInstallation(devices)).toEqual({
      isAllowed: true,
      template: { userId: 'u1', accountId: 'a1', credentialId: 'cred', credentialPublicKey: 'key', credentialCounter: 7, lastChallengeIssuedAt: 500 },
    });
  });

  it('treats a device with no counter or challenge recorded as 0', () => {
    expect(planNewInstallation([device({ credentialCounter: undefined, lastChallengeIssuedAt: undefined })]))
      .toEqual({ isAllowed: true, template: expect.objectContaining({ credentialCounter: 0, lastChallengeIssuedAt: 0 }) });
  });

  it.each([
    ['no device has the passkey', [], 'no-device'],
    ['the device has no public key', [device({ credentialPublicKey: undefined })], 'no-device'],
    ['a device is signed out or disabled', [device(), device({ requestId: 'r2', installationId: 'tablet', isEnabled: false })], 'device-disabled'],
    ['the devices belong to different people', [device(), device({ requestId: 'r2', installationId: 'tablet', userId: 'u2' })], 'devices-disagree'],
    ['the devices hold different public keys', [device(), device({ requestId: 'r2', installationId: 'tablet', credentialPublicKey: 'other' })], 'devices-disagree'],
  ] as const)('refuses when %s', (_label, devices, reason) => {
    expect(planNewInstallation([...devices])).toEqual({ isAllowed: false, reason });
  });
});
