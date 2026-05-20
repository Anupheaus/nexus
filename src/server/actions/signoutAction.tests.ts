import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';

const { mockUseAuthData } = vi.hoisted(() => ({
  mockUseAuthData: vi.fn<() => { token?: string } | undefined>(),
}));

vi.mock('../async-context/nexusContext', () => ({
  useAuthData: mockUseAuthData,
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
});
