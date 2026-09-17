import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { runSocketAuthMiddleware } from './socketAuthMiddleware';
import type { AuthConfig, JwtAuthConfig } from './auth';
import type { JwtAuthStore, NexusAuthRecord } from '../common/auth';
import type { NexusUser } from '../common';
import type { useAuthentication } from './providers/authentication/useAuthentication';

const testUser: NexusUser = { id: 'user-1' };
const testRecord: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };

function makeStore(record: NexusAuthRecord | undefined = testRecord): JwtAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(),
    update: vi.fn(async () => {}),
  };
}

function makeAuth(overrides: Partial<JwtAuthConfig> = {}): AuthConfig {
  return {
    mode: 'jwt',
    store: makeStore(),
    onAuthenticate: vi.fn(async () => undefined),
    onGetUser: vi.fn(async () => testUser),
    syncUserToClient: true,
    ...overrides,
  };
}

function makeSocket(): Socket {
  return {
    handshake: { headers: { cookie: 'nexus_session=abc123' }, auth: {} },
    disconnect: vi.fn(),
    emit: vi.fn(),
  } as unknown as Socket;
}

function makeDeps(auth: AuthConfig) {
  const setClient = vi.fn();
  const setUser = vi.fn(async () => {});
  // Only `setUser` is exercised by the middleware; stub the rest of the hook's
  // return shape so the mock satisfies `typeof useAuthentication` without `any`.
  const useAuthenticationMock = vi.fn(() => ({
    user: undefined,
    account: undefined,
    setUser,
    setAccount: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    impersonateUser: vi.fn(),
    createInvite: vi.fn(async () => ''),
    getGoogleToken: vi.fn(async () => ''),
  })) as unknown as typeof useAuthentication;
  const validateSessionCookie = vi.fn(async (
    _socket: Socket,
    store: JwtAuthStore,
    onGetUser: (userId: string) => Promise<NexusUser | undefined>,
    onValidated: (user: NexusUser, sessionToken: string) => Promise<void>,
  ) => {
    const record = await store.findBySessionToken('abc123');
    if (!record) return false;
    const user = await onGetUser(record.userId);
    if (!user) return false;
    await onValidated(user, record.sessionToken);
    return true;
  });
  return { auth, setClient, useAuthentication: useAuthenticationMock, validateSessionCookie, setUser };
}

describe('runSocketAuthMiddleware', () => {
  it('calls setClient before onResolveConnection and validateSessionCookie', async () => {
    const callOrder: string[] = [];
    const auth = makeAuth({ onResolveConnection: vi.fn(async () => { callOrder.push('onResolveConnection'); }) });
    const deps = makeDeps(auth);
    deps.setClient.mockImplementation(() => callOrder.push('setClient'));
    deps.validateSessionCookie.mockImplementation(async () => { callOrder.push('validateSessionCookie'); return true; });

    await runSocketAuthMiddleware(makeSocket(), deps);

    expect(callOrder).toEqual(['setClient', 'onResolveConnection', 'validateSessionCookie']);
  });

  it('awaits onResolveConnection before querying the auth store', async () => {
    const callOrder: string[] = [];
    const store = makeStore();
    (store.findBySessionToken as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('findBySessionToken');
      return testRecord;
    });
    const auth = makeAuth({
      store,
      onResolveConnection: vi.fn(async () => { callOrder.push('onResolveConnection'); }),
    });
    const deps = makeDeps(auth);
    deps.validateSessionCookie.mockImplementation(async (_socket, storeArg: JwtAuthStore, onGetUser) => {
      const record = await storeArg.findBySessionToken('abc123');
      if (!record) return false;
      await onGetUser(record.userId);
      return true;
    });

    await runSocketAuthMiddleware(makeSocket(), deps);

    expect(callOrder).toEqual(['onResolveConnection', 'findBySessionToken']);
  });

  it('calls onResolveConnection exactly once per connection', async () => {
    const onResolveConnection = vi.fn(async () => {});
    const auth = makeAuth({ onResolveConnection });
    const deps = makeDeps(auth);

    await runSocketAuthMiddleware(makeSocket(), deps);

    expect(onResolveConnection).toHaveBeenCalledTimes(1);
    expect(onResolveConnection).toHaveBeenCalledWith(expect.anything());
  });

  it('is a no-op and still authenticates normally when onResolveConnection is not supplied', async () => {
    const auth = makeAuth();
    const deps = makeDeps(auth);

    await runSocketAuthMiddleware(makeSocket(), deps);

    expect(deps.setClient).toHaveBeenCalledTimes(1);
    expect(deps.validateSessionCookie).toHaveBeenCalledTimes(1);
    expect(deps.setUser).toHaveBeenCalledWith(testUser, 'abc123');
  });

  it('propagates an error thrown by onResolveConnection without calling validateSessionCookie', async () => {
    const auth = makeAuth({ onResolveConnection: vi.fn(async () => { throw new Error('resolve failed'); }) });
    const deps = makeDeps(auth);

    await expect(runSocketAuthMiddleware(makeSocket(), deps)).rejects.toThrow('resolve failed');
    expect(deps.validateSessionCookie).not.toHaveBeenCalled();
  });
});
