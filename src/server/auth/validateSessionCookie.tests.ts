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

function makeSocket(cookieHeader?: string): Pick<Socket, 'handshake' | 'disconnect'> {
  return {
    handshake: { headers: { cookie: cookieHeader } } as any,
    disconnect: vi.fn(),
  };
}

const testUser: SocketAPIUser = { id: 'user-1' };

describe('validateSessionCookie', () => {
  it('disconnects socket when no cookie header is present', async () => {
    const store = makeStore();
    const socket = makeSocket(undefined);
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('disconnects socket when sessionToken not found in store', async () => {
    const store = makeStore(undefined); // findBySessionToken returns undefined
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('disconnects socket when record isEnabled is false', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('calls setUser and updates lastConnectedAt when valid', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(testUser);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('disconnects when onGetUser returns undefined', async () => {
    const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => undefined);
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });
});
