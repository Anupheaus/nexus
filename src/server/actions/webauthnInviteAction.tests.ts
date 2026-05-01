import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import { handleWebAuthnInvite } from './webauthnInviteAction';

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

const onGetUserDetails = vi.fn<[string], Promise<InviteDetails>>(
  async () => ({ id: 'example.com', appName: 'TestApp', userName: 'Alice' }),
);

describe('handleWebAuthnInvite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for requestId', async () => {
    await expect(
      handleWebAuthnInvite(makeStore(undefined), onGetUserDetails, { requestId: 'unknown' }),
    ).rejects.toThrow('Invite not found');
  });

  it('throws when record is already enabled (already registered)', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 't', deviceId: 'd' });
    await expect(
      handleWebAuthnInvite(store, onGetUserDetails, { requestId: 'r1' }),
    ).rejects.toThrow('Invite already used');
  });

  it('generates registrationToken, stores it, and returns inviteDetails on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: '', deviceId: '' });
    const result = await handleWebAuthnInvite(store, onGetUserDetails, { requestId: 'r1' });
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ registrationToken: expect.any(String) }));
    expect(result.registrationToken).toBeTruthy();
    expect(result.inviteDetails).toEqual({ id: 'example.com', appName: 'TestApp', userName: 'Alice' });
  });

  it('calls onGetUserDetails with the record userId', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'user-42', isEnabled: false, sessionToken: '', deviceId: '' });
    await handleWebAuthnInvite(store, onGetUserDetails, { requestId: 'r1' });
    expect(onGetUserDetails).toHaveBeenCalledWith('user-42');
  });
});
