import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../../common/auth';

const { mockSetResponseHeader, mockUseAuthData } = vi.hoisted(() => ({
  mockSetResponseHeader: vi.fn(),
  mockUseAuthData: vi.fn<[], { token?: string } | undefined>(),
}));

vi.mock('../../async-context/socketApiContext', () => ({
  setResponseHeader: mockSetResponseHeader,
  useAuthData: mockUseAuthData,
}));

import { handleSignOut } from './signoutRoute';

function makeStore(record?: SocketAPIAuthRecord): SocketAPIAuthStore<SocketAPIAuthRecord> {
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

  it('clears the cookie even when no session token is present', async () => {
    mockUseAuthData.mockReturnValueOnce(undefined);
    const store = makeStore(undefined);
    await handleSignOut(store);
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
    expect(store.update).not.toHaveBeenCalled();
  });

  it('disables the store record when a valid session token is in auth context', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    const store = makeStore(record);
    await handleSignOut(store);
    expect(store.update).toHaveBeenCalledWith('r1', { isEnabled: false });
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
  });
});
