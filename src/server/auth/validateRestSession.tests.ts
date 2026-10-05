import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setConfig, setLogger } from '../async-context/nexusContext';
import { validateRestSession } from './validateRestSession';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';

const user: NexusUser = { id: 'user-1' };
const record: NexusAuthRecord = {
  requestId: 'req-1', sessionToken: 'valid-token', userId: 'user-1',
  deviceId: 'dev-1', isEnabled: true,
};

function makeStore(overrides?: Partial<NexusAuthRecord | undefined>): NexusAuthStore {
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
    const result = await validateRestSession('nexus_session=bad-token', store, onGetUser);
    expect(result).toBeUndefined();
  });

  it('returns undefined when record is disabled', async () => {
    const store = makeStore({ isEnabled: false });
    const result = await validateRestSession('nexus_session=valid-token', store, onGetUser);
    expect(result).toBeUndefined();
  });

  it('returns user and token, updates lastConnectedAt for valid session', async () => {
    const store = makeStore({});
    const result = await validateRestSession('nexus_session=valid-token', store, onGetUser);
    expect(result?.user).toBe(user);
    expect(result?.token).toBe('valid-token');
    expect(store.update).toHaveBeenCalledWith('req-1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('parses cookie correctly when multiple cookies are present', async () => {
    const store = makeStore({});
    await validateRestSession('other=val; nexus_session=valid-token; another=x', store, onGetUser);
    expect(store.findBySessionToken).toHaveBeenCalledWith('valid-token');
  });

  it('returns undefined when onGetUser returns undefined for valid session', async () => {
    const store = makeStore({});
    const result = await validateRestSession(
      'nexus_session=valid-token',
      store,
      async () => undefined, // user deleted from DB
    );
    expect(result).toBeUndefined();
  });

  it('propagates error when onGetUser throws', async () => {
    const store = makeStore({});
    await expect(
      validateRestSession(
        'nexus_session=valid-token',
        store,
        async () => { throw new Error('db-error'); },
      ),
    ).rejects.toThrow('db-error');
  });
});

// sc-378: every refused REST session is one [Auth] warn with its reason; a request without a session logs nothing.
describe('validateRestSession — [Auth] events', () => {
  const failures: unknown[][] = [];
  const logger = { warn: vi.fn((...args: unknown[]) => { failures.push(args); }), debug: vi.fn(), info: vi.fn() };

  beforeEach(() => {
    failures.length = 0;
    setConfig({ name: 'test', server: {} as never, security: { trustedProxyHops: 0 } });
    setLogger({ ...logger, createSubLogger: () => ({ ...logger, createSubLogger: () => logger }) } as never);
  });

  const authFailures = () => failures.filter(([message]) => typeof message === 'string' && message.startsWith('[Auth]')).map(([, meta]) => meta);

  it.each([
    ['an empty session cookie', 'nexus_session=', undefined, 'invalid-request', undefined],
    ['a stale session token', 'nexus_session=stale', undefined, 'stale-session', undefined],
    ['a disabled device', 'nexus_session=valid-token', { isEnabled: false }, 'device-disabled', 'user-1'],
  ] as const)('logs %s as %s', async (_label, cookie, overrides, reason, userId) => {
    await validateRestSession(cookie, makeStore(overrides as Partial<NexusAuthRecord> | undefined), onGetUser);

    expect(authFailures()).toEqual([expect.objectContaining({ event: 'session', outcome: 'failure', method: 'rest-session', reason, userId })]);
  });

  it('logs a session whose user no longer exists as unknown-user', async () => {
    await validateRestSession('nexus_session=valid-token', makeStore({}), async () => undefined);

    expect(authFailures()).toEqual([expect.objectContaining({ method: 'rest-session', reason: 'unknown-user', userId: 'user-1' })]);
  });

  it('logs nothing for a request with no session cookie', async () => {
    await validateRestSession('other=foo', makeStore(undefined), onGetUser);

    expect(authFailures()).toEqual([]);
  });
});
