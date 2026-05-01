import { describe, it, expect, vi } from 'vitest';
import { validateRestSession } from './validateRestSession';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

const user: SocketAPIUser = { id: 'user-1' };
const record: SocketAPIAuthRecord = {
  requestId: 'req-1', sessionToken: 'valid-token', userId: 'user-1',
  deviceId: 'dev-1', isEnabled: true,
};

function makeStore(overrides?: Partial<SocketAPIAuthRecord | undefined>): SocketAPIAuthStore {
  const r = overrides === undefined ? undefined : { ...record, ...overrides };
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionToken: vi.fn(async () => r),
    findByDevice: vi.fn(),
    update: vi.fn(async () => {}),
  };
}

const onGetUser = vi.fn(async () => user);

describe('validateRestSession', () => {
  it('returns undefined when no session cookie present', async () => {
    const store = makeStore(undefined);
    const result = await validateRestSession('other=foo', store, onGetUser);
    expect(result).toBeUndefined();
    expect(store.findBySessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined when session token not found in store', async () => {
    const store = makeStore(undefined);
    const result = await validateRestSession('socketapi_session=bad-token', store, onGetUser);
    expect(result).toBeUndefined();
  });

  it('returns undefined when record is disabled', async () => {
    const store = makeStore({ isEnabled: false });
    const result = await validateRestSession('socketapi_session=valid-token', store, onGetUser);
    expect(result).toBeUndefined();
  });

  it('returns user and token, updates lastConnectedAt for valid session', async () => {
    const store = makeStore({});
    const result = await validateRestSession('socketapi_session=valid-token', store, onGetUser);
    expect(result?.user).toBe(user);
    expect(result?.token).toBe('valid-token');
    expect(store.update).toHaveBeenCalledWith('req-1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('parses cookie correctly when multiple cookies are present', async () => {
    const store = makeStore({});
    await validateRestSession('other=val; socketapi_session=valid-token; another=x', store, onGetUser);
    expect(store.findBySessionToken).toHaveBeenCalledWith('valid-token');
  });

  it('returns undefined when onGetUser returns undefined for valid session', async () => {
    const store = makeStore({});
    const result = await validateRestSession(
      'socketapi_session=valid-token',
      store,
      async () => undefined, // user deleted from DB
    );
    expect(result).toBeUndefined();
  });

  it('propagates error when onGetUser throws', async () => {
    const store = makeStore({});
    await expect(
      validateRestSession(
        'socketapi_session=valid-token',
        store,
        async () => { throw new Error('db-error'); },
      ),
    ).rejects.toThrow('db-error');
  });
});
