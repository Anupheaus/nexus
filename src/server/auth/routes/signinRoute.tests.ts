import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JwtAuthStore, JwtAuthRecord } from '../../../common/auth';
import type { SocketAPIUser } from '../../../common';

const { mockSetResponseHeader } = vi.hoisted(() => ({ mockSetResponseHeader: vi.fn() }));

vi.mock('../../async-context/socketApiContext', () => ({
  setResponseHeader: mockSetResponseHeader,
  useAuthData: vi.fn(),
}));

import { handleSignIn } from './signinRoute';

const testUser: SocketAPIUser = { id: 'user-1' };

function makeStore(existingRecord?: JwtAuthRecord): JwtAuthStore {
  return {
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => existingRecord),
    findBySessionToken: vi.fn(async () => existingRecord),
    findByDevice: vi.fn(async () => existingRecord),
    update: vi.fn(async () => {}),
  };
}

describe('handleSignIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when onAuthenticate returns undefined', async () => {
    const store = makeStore();
    await expect(
      handleSignIn(store, async () => undefined, { email: 'bad@test.com', password: 'wrong' }),
    ).rejects.toThrow('Authentication failed');
  });

  it('sets HttpOnly session cookie when credentials are valid (new device)', async () => {
    const store = makeStore(undefined);
    await handleSignIn(store, async () => testUser, { email: 'good@test.com', password: 'correct', deviceId: 'dev-1', deviceDetails: {} });
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socketapi_session='));
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('SameSite=Strict'));
    expect(store.create).toHaveBeenCalledOnce();
  });

  it('updates existing record when device already has a session', async () => {
    const existing: JwtAuthRecord = { requestId: 'r1', sessionToken: 'old', userId: 'user-1', deviceId: 'dev-1', isEnabled: true };
    const store = makeStore(existing);
    await handleSignIn(store, async () => testUser, { email: 'good@test.com', password: 'correct', deviceId: 'dev-1', deviceDetails: {} });
    expect(store.create).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ sessionToken: expect.any(String), isEnabled: true }));
  });

  it('sets the Secure flag on the session cookie', async () => {
    const store = makeStore(undefined);
    await handleSignIn(store, async () => testUser, { email: 'good@test.com', password: 'correct', deviceId: 'dev-1' });
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Secure'));
  });

  it('propagates error when onAuthenticate throws', async () => {
    const store = makeStore(undefined);
    await expect(
      handleSignIn(store, async () => { throw new Error('auth-service-down'); }, { email: 'any@test.com', password: 'any' }),
    ).rejects.toThrow('auth-service-down');
  });
});
