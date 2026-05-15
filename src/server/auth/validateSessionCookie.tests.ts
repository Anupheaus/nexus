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

function makeSocket(cookieHeader?: string): Pick<Socket, 'handshake' | 'disconnect' | 'emit'> {
  return {
    handshake: { headers: { cookie: cookieHeader } } as any,
    disconnect: vi.fn(),
    emit: vi.fn(),
  };
}

const testUser: SocketAPIUser = { id: 'user-1' };

describe('validateSessionCookie', () => {
  it('does NOT disconnect and returns false when no cookie header is present', async () => {
    const socket = makeSocket(undefined);
    const result = await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT disconnect and returns false when sessionToken not found in store', async () => {
    const socket = makeSocket('socketapi_session=abc123');
    const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('disconnects socket when record isEnabled is false', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket('socketapi_session=abc123');
    await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('emits socketAPIDeviceDisabled before disconnecting when record isEnabled is false', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket('socketapi_session=abc123');
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('socket-api.events.socketAPIDeviceDisabled', undefined);
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-token case', async () => {
    const socket = makeSocket(undefined);
    await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-record case', async () => {
    const socket = makeSocket('socketapi_session=abc123');
    await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('calls setUser with user and sessionToken when record is valid', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, vi.fn(async () => testUser), setUser);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(testUser, 'abc123');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('does NOT disconnect and returns false when onGetUser returns undefined', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket('socketapi_session=abc123');
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => undefined), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
