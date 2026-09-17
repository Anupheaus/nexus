import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage } from 'http';
import { runRestAuth } from './restAuthMiddleware';
import type { AuthConfig, JwtAuthConfig } from '../auth';
import type { JwtAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';

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

function makeReq(cookie = 'nexus_session=abc123'): IncomingMessage {
  return { headers: { cookie } } as unknown as IncomingMessage;
}

function makeDeps(auth: AuthConfig) {
  const setAuthData = vi.fn();
  const validateRestSession = vi.fn(async (
    cookieHeader: string,
    store: JwtAuthStore,
    onGetUser: (userId: string) => Promise<NexusUser | undefined>,
  ) => {
    if (!cookieHeader.includes('nexus_session=')) return undefined;
    const record = await store.findBySessionToken('abc123');
    if (!record?.isEnabled) return undefined;
    const user = await onGetUser(record.userId);
    if (!user) return undefined;
    return { user, token: record.sessionToken };
  });
  return { auth, setAuthData, validateRestSession };
}

describe('runRestAuth', () => {
  it('calls onResolveRestConnection before validateRestSession, for a non-public action', async () => {
    const callOrder: string[] = [];
    const store = makeStore();
    (store.findBySessionToken as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('findBySessionToken');
      return testRecord;
    });
    const auth = makeAuth({
      store,
      onResolveRestConnection: vi.fn(async () => { callOrder.push('onResolveRestConnection'); }),
    });
    const deps = makeDeps(auth);
    deps.validateRestSession.mockImplementation(async (_cookie, storeArg: JwtAuthStore, onGetUser) => {
      callOrder.push('validateRestSession');
      const record = await storeArg.findBySessionToken('abc123');
      if (!record) return undefined;
      const user = await onGetUser(record.userId);
      return user ? { user, token: record.sessionToken } : undefined;
    });

    const result = await runRestAuth(makeReq(), auth, false, deps);

    expect(callOrder).toEqual(['onResolveRestConnection', 'validateRestSession', 'findBySessionToken']);
    expect(result).toEqual({ authorized: true });
  });

  it('calls onResolveRestConnection for a public action too, without calling validateRestSession', async () => {
    const onResolveRestConnection = vi.fn(async () => {});
    const auth = makeAuth({ onResolveRestConnection });
    const deps = makeDeps(auth);

    const result = await runRestAuth(makeReq(), auth, true, deps);

    expect(onResolveRestConnection).toHaveBeenCalledTimes(1);
    expect(onResolveRestConnection).toHaveBeenCalledWith(expect.anything());
    expect(deps.validateRestSession).not.toHaveBeenCalled();
    expect(result).toEqual({ authorized: true });
  });

  it('is a no-op and does not call onResolveRestConnection when no auth is configured', async () => {
    const result = await runRestAuth(makeReq(), undefined, false, makeDeps(makeAuth()));
    expect(result).toEqual({ authorized: true });
  });

  it('is a no-op and still authenticates normally when onResolveRestConnection is not supplied', async () => {
    const auth = makeAuth();
    const deps = makeDeps(auth);

    const result = await runRestAuth(makeReq(), auth, false, deps);

    expect(deps.validateRestSession).toHaveBeenCalledTimes(1);
    expect(deps.setAuthData).toHaveBeenCalledWith({ user: testUser, token: 'abc123' });
    expect(result).toEqual({ authorized: true });
  });

  it('calls onResolveRestConnection exactly once per request', async () => {
    const onResolveRestConnection = vi.fn(async () => {});
    const auth = makeAuth({ onResolveRestConnection });
    const deps = makeDeps(auth);

    await runRestAuth(makeReq(), auth, false, deps);

    expect(onResolveRestConnection).toHaveBeenCalledTimes(1);
  });

  it('propagates an error thrown by onResolveRestConnection without calling validateRestSession', async () => {
    const auth = makeAuth({ onResolveRestConnection: vi.fn(async () => { throw new Error('resolve failed'); }) });
    const deps = makeDeps(auth);

    await expect(runRestAuth(makeReq(), auth, false, deps)).rejects.toThrow('resolve failed');
    expect(deps.validateRestSession).not.toHaveBeenCalled();
  });

  it('returns unauthorized when validateRestSession finds no valid session', async () => {
    const auth = makeAuth();
    const deps = makeDeps(auth);

    const result = await runRestAuth(makeReq('other=nope'), auth, false, deps);

    expect(result).toEqual({ authorized: false });
    expect(deps.setAuthData).not.toHaveBeenCalled();
  });
});
