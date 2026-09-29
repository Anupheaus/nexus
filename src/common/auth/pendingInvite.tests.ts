import { describe, expect, it } from 'vitest';
import { isPendingWebAuthnInvite } from './pendingInvite';

// A registered device keeps its invite's requestId; after sign-out or an admin disable only isEnabled is false again. So
// "pending" must mean never registered at all, or an old invite link could register over a disabled device (sc-605).

describe('isPendingWebAuthnInvite', () => {
  it('is true for an invite nobody has registered', () => {
    expect(isPendingWebAuthnInvite({ isEnabled: false })).toBe(true);
  });

  it.each([
    ['enabled', { isEnabled: true }],
    ['signed out, keeping its key hash and device details', { isEnabled: false, keyHash: 'k1', deviceDetails: { id: 'd1' } as never }],
    ['disabled by an admin, with only its key hash', { isEnabled: false, keyHash: 'k1' }],
    ['one that has connected', { isEnabled: false, lastConnectedAt: 1 }],
  ])('is false for a device that is %s', (_label, record) => {
    expect(isPendingWebAuthnInvite(record)).toBe(false);
  });
});
