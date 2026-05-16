import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { validateSessionCookie } from './validateSessionCookie';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

function makeStore(record?: SocketAPIAuthRecord): SocketAPIAuthStore<SocketAPIAuthRecord> {
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

const testUser: SocketAPIUser = { id: 'user-1' };

describe('validateSessionCookie', () => {
  it('does NOT disconnect and returns false when no cookie header is present', async () => {
    const socket = makeSocket();
    const result = await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT disconnect and returns false when sessionToken not found in store', async () => {
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('disconnects socket when record isEnabled is false', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('emits socketAPIDeviceDisabled before disconnecting when record isEnabled is false', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('socket-api.events.socketAPIDeviceDisabled', undefined);
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-token case', async () => {
    const socket = makeSocket();
    await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-record case', async () => {
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('calls setUser with user and sessionToken when record is valid', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, vi.fn(async () => testUser), setUser);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(testUser, 'abc123');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('does NOT disconnect and returns false when onGetUser returns undefined', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => undefined), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  // --- New tests for auth.sessionToken path ---

  it('emits socketapi:sessionInvalid and returns false when auth.sessionToken is supplied but not found in store', async () => {
    // Client supplied a persisted token (e.g. from Capacitor storage) but it is
    // no longer in the store — treat it as stale and signal the client to clear it.
    const socket = makeSocket({ auth: { sessionToken: 'stale-token' } });
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('socketapi:sessionInvalid');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('does NOT emit socketapi:sessionInvalid when no auth.sessionToken is supplied and cookie lookup fails', async () => {
    // Fresh connection with no stored token — not a stale-token scenario, so the
    // client should not be told to clear anything.
    const socket = makeSocket();
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('emits socketapi:sessionToken with the token value when validation succeeds via cookie', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket({ cookieHeader: 'socketapi_session=abc123' });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(true);
    expect(socket.emit).toHaveBeenCalledWith('socketapi:sessionToken', 'abc123');
  });

  it('emits socketapi:sessionToken with the token value when validation succeeds via auth.sessionToken', async () => {
    // Capacitor/mobile path: no cookie header; token is supplied via socket auth
    // object instead and was found in the store.
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'mobile-tok', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket({ auth: { sessionToken: 'mobile-tok' } });
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(true);
    expect(socket.emit).toHaveBeenCalledWith('socketapi:sessionToken', 'mobile-tok');
  });
});
