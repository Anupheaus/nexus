import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { runSocketAuthMiddleware } from './socketAuthMiddleware';
import type { AuthConfig, JwtAuthConfig } from './auth';
import type { JwtAuthStore, NexusAuthRecord } from '../common/auth';
import type { NexusAccount, NexusUser } from '../common';
import type { useAuthentication } from './providers/authentication/useAuthentication';
import type { SessionCookieOutcome } from './auth/sessionCookieModels';
import type { SocketConnectionRefusalData } from './socketAuthMiddleware';

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

/** What the browser's connection already holds when the socket arrives (from an earlier socket or REST request). */
interface HeldAuthentication {
  user?: NexusUser;
  account?: NexusAccount;
}

function makeDeps(auth: AuthConfig, { user, account }: HeldAuthentication = {}) {
  const setClient = vi.fn();
  const setUser = vi.fn(async () => {});
  const signOut = vi.fn(async () => {});
  // Only `user`, `account`, `setUser` and `signOut` are exercised by the middleware; stub the rest of the hook's
  // return shape so the mock satisfies `typeof useAuthentication` without `any`.
  const useAuthenticationMock = vi.fn(() => ({
    user,
    account,
    setUser,
    setAccount: vi.fn(async () => {}),
    signOut,
    impersonateUser: vi.fn(),
    createInvite: vi.fn(async () => ''),
    getGoogleToken: vi.fn(async () => ''),
  })) as unknown as typeof useAuthentication;
  const validateSessionCookie = vi.fn(async (
    _socket: Socket,
    store: JwtAuthStore,
    onGetUser: (userId: string) => Promise<NexusUser | undefined>,
    onValidated: (user: NexusUser, sessionToken: string) => Promise<void>,
  ): Promise<SessionCookieOutcome> => {
    const record = await store.findBySessionToken('abc123');
    if (!record) return { status: 'rejected', reason: 'stale-session' };
    if (!record.isEnabled) return { status: 'rejected', reason: 'device-disabled' };
    const user = await onGetUser(record.userId);
    if (!user) return { status: 'rejected', reason: 'unknown-user' };
    await onValidated(user, record.sessionToken);
    return { status: 'restored' };
  });
  return { auth, setClient, useAuthentication: useAuthenticationMock, validateSessionCookie, setUser, signOut };
}

describe('runSocketAuthMiddleware', () => {
  it('calls setClient before onResolveConnection and validateSessionCookie', async () => {
    const callOrder: string[] = [];
    const auth = makeAuth({ onResolveConnection: vi.fn(async () => { callOrder.push('onResolveConnection'); }) });
    const deps = makeDeps(auth);
    deps.setClient.mockImplementation(() => callOrder.push('setClient'));
    deps.validateSessionCookie.mockImplementation(async () => { callOrder.push('validateSessionCookie'); return { status: 'restored' }; });

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
      if (!record) return { status: 'rejected', reason: 'stale-session' };
      await onGetUser(record.userId);
      return { status: 'restored' };
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

  // The user is kept on the browser's connection (the `nexus-conn` cookie), which outlives its sockets: a refused
  // session that leaves it there lets this socket carry on as whoever an earlier socket signed in (Vision: a disabled
  // device got straight back in after a reload).
  describe('when the session is refused', () => {
    it('refuses the connection of a disabled device and clears the user an earlier socket signed in', async () => {
      const auth = makeAuth({ store: makeStore({ ...testRecord, isEnabled: false }) });
      const deps = makeDeps(auth);

      const refusal = await runSocketAuthMiddleware(makeSocket(), deps).then(() => undefined, (error: unknown) => error);

      expect(refusal, 'the connection is refused').toBeInstanceOf(Error);
      expect((refusal as { data?: SocketConnectionRefusalData }).data, 'the client is told why').toEqual({ reason: 'device-disabled' });
      expect(deps.signOut).toHaveBeenCalledTimes(1);
      expect(deps.setUser).not.toHaveBeenCalled();
    });

    it.each(['stale-session', 'unknown-user', 'invalid-request'] as const)('clears the user and lets a %s connection carry on signed out', async reason => {
      const deps = makeDeps(makeAuth());
      deps.validateSessionCookie.mockImplementation(async () => ({ status: 'rejected', reason }));

      await expect(runSocketAuthMiddleware(makeSocket(), deps)).resolves.toBeUndefined();

      expect(deps.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves a restored session signed in', async () => {
    const deps = makeDeps(makeAuth());

    await expect(runSocketAuthMiddleware(makeSocket(), deps)).resolves.toBeUndefined();

    expect(deps.setUser).toHaveBeenCalledWith(testUser, 'abc123');
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  // No session on a connection holding nobody is an ordinary signed-out socket: it is not told it signed out.
  it('leaves a connection holding nobody as it is when no session is offered', async () => {
    const deps = makeDeps(makeAuth());
    deps.validateSessionCookie.mockImplementation(async () => ({ status: 'no-session' }));

    await expect(runSocketAuthMiddleware(makeSocket(), deps)).resolves.toBeUndefined();

    expect(deps.signOut).not.toHaveBeenCalled();
  });

  // The browser signed out (its session cookie cleared) or its session cookie expired, but its connection (the
  // `nexus-conn` cookie) still holds the user an earlier socket signed in: this socket must not carry on as them.
  it.each([
    ['a user', { user: testUser }],
    ['an account', { account: { id: 'account-1' } }],
  ] as const)('clears %s the connection still holds when no session is offered, and connects signed out', async (_held, held) => {
    const deps = makeDeps(makeAuth(), held);
    deps.validateSessionCookie.mockImplementation(async () => ({ status: 'no-session' }));

    await expect(runSocketAuthMiddleware(makeSocket(), deps)).resolves.toBeUndefined();

    expect(deps.signOut).toHaveBeenCalledTimes(1);
    expect(deps.setUser).not.toHaveBeenCalled();
  });
});
