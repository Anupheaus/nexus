import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';

const { mockUseAuthData, mockSignOut } = vi.hoisted(() => ({
  mockUseAuthData: vi.fn<() => { token?: string } | undefined>(),
  mockSignOut: vi.fn(async () => {}),
}));

vi.mock('../async-context/nexusContext', () => ({
  useAuthData: mockUseAuthData,
}));

vi.mock('../providers/authentication', () => ({
  useAuthentication: () => ({ signOut: mockSignOut }),
}));

import { handleSignOut } from './signoutAction';

function makeStore(record?: NexusAuthRecord): NexusAuthStore<NexusAuthRecord> {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

describe('handleSignOut', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls removeCookie even when no session token is present', async () => {
    mockUseAuthData.mockReturnValueOnce(undefined);
    const removeCookie = vi.fn();
    await handleSignOut(makeStore(undefined), removeCookie);
    expect(removeCookie).toHaveBeenCalledWith('nexus_session');
    expect(makeStore().update).not.toHaveBeenCalled();
  });

  it('disables the store record when a valid session token is in auth context', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    const store = makeStore(record);
    const removeCookie = vi.fn();
    await handleSignOut(store, removeCookie);
    expect(store.update).toHaveBeenCalledWith('r1', { isEnabled: false });
    expect(removeCookie).toHaveBeenCalledWith('nexus_session');
  });

  // The user, account and token are kept on the browser's connection (the `nexus-conn` cookie), shared by its sockets
  // and outliving them: disabling the session record alone leaves an open socket, and the next one, signed in.
  it('clears the user, account and token the browser\'s connection holds', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    await handleSignOut(makeStore(record), vi.fn());
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // Fail closed: the browser is signed out on the server even when the store cannot be reached.
  it('clears the connection before the store is touched', async () => {
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    const store = makeStore();
    vi.mocked(store.findBySessionToken).mockRejectedValueOnce(new Error('store unavailable'));
    await expect(handleSignOut(store, vi.fn())).rejects.toThrow('store unavailable');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('clears the connection even when there is no session to revoke', async () => {
    mockUseAuthData.mockReturnValueOnce(undefined);
    await handleSignOut(makeStore(undefined), vi.fn());
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
