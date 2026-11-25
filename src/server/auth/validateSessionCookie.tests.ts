import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { validateSessionCookie } from './validateSessionCookie';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';

function makeStore(record?: NexusAuthRecord): NexusAuthStore<NexusAuthRecord> {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

interface MakeSocketOptions {
  cookieHeader?: string;
  auth?: Record<string, unknown>;
}

function makeSocket({ cookieHeader, auth }: MakeSocketOptions = {}): Pick<Socket, 'handshake' | 'disconnect' | 'emit'> {
  return {
    handshake: { headers: { cookie: cookieHeader }, auth: auth ?? {} } as any,
    disconnect: vi.fn(),
    emit: vi.fn(),
  };
}

const testUser: NexusUser = { id: 'user-1' };

describe('validateSessionCookie', () => {
  // sc-620: the handshake's auth is client JSON; { sessionToken: { $gt: '' } } would match someone's session in MongoDB.
  it.each([{ $ne: null }, { $gt: '' }, { $exists: true }, ['k'], 1, true])('refuses a handshake session token that is not a string (%j) without looking it up', async sessionToken => {
    const store = makeStore({ requestId: 'r1', userId: 'user-1', sessionToken: 's', deviceId: 'd', isEnabled: true } as NexusAuthRecord);
    const setUser = vi.fn();

    const result = await validateSessionCookie(makeSocket({ auth: { sessionToken } }) as unknown as Socket, store, async () => testUser, setUser);

    expect({ result, found: vi.mocked(store.findBySessionToken).mock.calls.length, setUser: setUser.mock.calls.length }).toEqual({ result: { status: 'rejected', reason: 'invalid-request' }, found: 0, setUser: 0 });
  });

  it('answers no-session (and does NOT disconnect) when no cookie header is present', async () => {
    const socket = makeSocket();
    const result = await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'no-session' });
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('rejects a stale session (and does NOT disconnect) when sessionToken not found in store', async () => {
    const socket = makeSocket({ cookieHeader: 'nexus_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'rejected', reason: 'stale-session' });
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  // The socket is not connected yet (this runs in the auth middleware), so a disconnect() here would do nothing: the
  // middleware refuses the connection on this answer instead.
  it('rejects a disabled device\'s session without setting its user', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket({ cookieHeader: 'nexus_session=abc123' });
    const setUser = vi.fn(async () => {});
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), setUser);
    expect(result).toEqual({ status: 'rejected', reason: 'device-disabled' });
    expect(setUser).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith('nexus:sessionToken', expect.anything());
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-token case', async () => {
    const socket = makeSocket();
    await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-record case', async () => {
    const socket = makeSocket({ cookieHeader: 'nexus_session=abc123' });
    await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('calls setUser with user and sessionToken when record is valid', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket({ cookieHeader: 'nexus_session=abc123' });
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, vi.fn(async () => testUser), setUser);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(testUser, 'abc123');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('rejects an unknown user (and does NOT disconnect) when onGetUser returns undefined', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket({ cookieHeader: 'nexus_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => undefined), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'rejected', reason: 'unknown-user' });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  // --- New tests for auth.sessionToken path ---

  it('emits nexus:sessionInvalid and rejects a stale session when auth.sessionToken is supplied but not found in store', async () => {
    // Client supplied a persisted token (e.g. from Capacitor storage) but it is
    // no longer in the store — treat it as stale and signal the client to clear it.
    const socket = makeSocket({ auth: { sessionToken: 'stale-token' } });
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'rejected', reason: 'stale-session' });
    expect(socket.emit).toHaveBeenCalledWith('nexus:sessionInvalid');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('does NOT emit nexus:sessionInvalid when no auth.sessionToken is supplied and cookie lookup fails', async () => {
    // Fresh connection with no stored token — not a stale-token scenario, so the
    // client should not be told to clear anything.
    const socket = makeSocket();
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'no-session' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('emits nexus:sessionToken with the token value when validation succeeds via cookie', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket({ cookieHeader: 'nexus_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'restored' });
    expect(socket.emit).toHaveBeenCalledWith('nexus:sessionToken', 'abc123');
  });

  it('emits nexus:sessionToken with the token value when validation succeeds via auth.sessionToken', async () => {
    // Capacitor/mobile path: no cookie header; token is supplied via socket auth
    // object instead and was found in the store.
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'mobile-tok', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket({ auth: { sessionToken: 'mobile-tok' } });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toEqual({ status: 'restored' });
    expect(socket.emit).toHaveBeenCalledWith('nexus:sessionToken', 'mobile-tok');
  });
});
