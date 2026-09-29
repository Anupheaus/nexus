import type { WebAuthnAuthRecord } from './authTypes';

/**
 * Whether an auth record is still a pending invite: created for an invite link and never registered. A registered device
 * keeps its invite's `requestId` (the `?requestId=` in the emailed link) and, after sign-out or an admin disable, only
 * `isEnabled` goes back to false, so `isEnabled` alone cannot tell a pending invite from a disabled device. A device that
 * has a key hash, a passkey credential, device details or a connection has registered, and its invite link must never work again.
 */
export function isPendingWebAuthnInvite(record: Pick<WebAuthnAuthRecord, 'isEnabled' | 'keyHash' | 'credentialId' | 'deviceDetails' | 'lastConnectedAt'>): boolean {
  return record.isEnabled !== true && record.keyHash == null && record.credentialId == null && record.deviceDetails == null && record.lastConnectedAt == null;
}
