import { isAuthKey, type WebAuthnAuthRecord } from '../../common/auth';

/** Longer than any id a client creates (a UUID is 36 characters), so a client cannot fill the store with one. */
const MAX_INSTALLATION_ID_LENGTH = 128;

/** Whether a client's installation id is one to store and look up: a non-empty string (never a query operator), and short. */
export function isInstallationId(value: unknown): value is string {
  return isAuthKey(value) && value.length <= MAX_INSTALLATION_ID_LENGTH;
}

/** What a passkey's devices share, and what an installation it has not signed in on before is registered from (sc-645). */
export interface PasskeyInstallationTemplate {
  userId: string;
  accountId?: string;
  credentialId: string;
  credentialPublicKey: string;
  /** The highest counter any installation has recorded: a synced authenticator counts once for all of them. */
  credentialCounter: number;
  /** The latest challenge any installation has answered: a new installation must answer a later one, so no sign-in
   *  already used by another installation can be replayed to register a new one. */
  lastChallengeIssuedAt: number;
}

/** Why a passkey may not register a new installation, for the server's log. */
export type PasskeyInstallationRefusal = 'no-device' | 'device-disabled' | 'devices-disagree';

/** The template for a new installation, or why the passkey may not register one. */
export type PasskeyInstallationResult =
  | { isAllowed: true; template: PasskeyInstallationTemplate; }
  | { isAllowed: false; reason: PasskeyInstallationRefusal; };

/**
 * The device this installation is for, among the devices of one passkey (sc-645): the one with this installation id, else
 * one registered before installations were told apart (no installation id), which this installation then adopts.
 */
export function findInstallationDevice(devices: WebAuthnAuthRecord[], installationId: string): WebAuthnAuthRecord | undefined {
  return devices.find(device => device.installationId === installationId) ?? devices.find(device => device.installationId == null);
}

/**
 * Whether a passkey may register an installation it has not signed in on before, and from what (sc-645). It may only when
 * every device it already has is enabled: a signed-out or disabled device means someone revoked it, and a synced copy of
 * the same passkey must not get round that by signing in somewhere new. That passkey then needs a fresh invite.
 */
export function planNewInstallation(devices: WebAuthnAuthRecord[]): PasskeyInstallationResult {
  const [first] = devices;
  if (first == null || first.credentialId == null || first.credentialPublicKey == null) return { isAllowed: false, reason: 'no-device' };
  if (devices.some(({ isEnabled }) => isEnabled !== true)) return { isAllowed: false, reason: 'device-disabled' };
  const isSamePasskey = devices.every(device => device.userId === first.userId && device.accountId === first.accountId && device.credentialPublicKey === first.credentialPublicKey);
  if (!isSamePasskey) return { isAllowed: false, reason: 'devices-disagree' };
  return {
    isAllowed: true,
    template: {
      userId: first.userId,
      accountId: first.accountId,
      credentialId: first.credentialId,
      credentialPublicKey: first.credentialPublicKey,
      credentialCounter: Math.max(...devices.map(({ credentialCounter }) => credentialCounter ?? 0)),
      lastChallengeIssuedAt: Math.max(...devices.map(({ lastChallengeIssuedAt }) => lastChallengeIssuedAt ?? 0)),
    },
  };
}
