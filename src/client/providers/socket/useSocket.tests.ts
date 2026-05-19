import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { Socket } from 'socket.io-client';

// ── mock SocketContext ─────────────────────────────────────────────────────────

const { mockContextValue } = vi.hoisted(() => {
  const mockContextValue = {
    name: 'test',
    getSocket: vi.fn(() => undefined as Socket | undefined),
    getRawSocket: vi.fn(() => undefined as Socket | undefined),
    onConnectionStateChanged: vi.fn(),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    reconnect: vi.fn(),
    waitForAuthCheck: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    onExclusive: vi.fn(),
    off: vi.fn(),
  };
  return { mockContextValue };
});

vi.mock('./SocketContext', () => ({
  SocketContext: React.createContext(mockContextValue),
}));

vi.mock('@anupheaus/react-ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    useBound: vi.fn((fn: Function) => fn),
    useId: vi.fn(() => 'hook-id-1'),
    useLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn() })),
  };
});

import { useSocket } from './useSocket';

// ── fake connected socket ──────────────────────────────────────────────────────

function makeConnectedSocket(id = 'sock-1'): Socket {
  return { id, connected: true } as unknown as Socket;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextValue.getSocket.mockReturnValue(undefined);
    mockContextValue.getRawSocket.mockReturnValue(undefined);
  });

  it('reactive isConnected is false when socket is not connected', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.isConnected).toBe(false);
  });

  it('getIsConnected() returns false when getSocket() returns undefined', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.getIsConnected()).toBe(false);
  });

  it('getIsConnected() returns true when getSocket() returns a connected socket', () => {
    mockContextValue.getSocket.mockReturnValue(makeConnectedSocket());
    const { result } = renderHook(() => useSocket());
    expect(result.current.getIsConnected()).toBe(true);
  });

  it('delegates emit to the socket emitWithAck when connected', async () => {
    const fakeSocket = makeConnectedSocket() as any;
    fakeSocket.emitWithAck = vi.fn().mockResolvedValue({ value: 'pong' });
    mockContextValue.getSocket.mockReturnValue(fakeSocket);

    const { result } = renderHook(() => useSocket());
    let response: unknown;
    await act(async () => {
      response = await result.current.emit('testEvent', { ping: true });
    });

    expect(fakeSocket.emitWithAck).toHaveBeenCalledWith('testEvent', { ping: true });
    expect(response).toEqual({ value: 'pong' });
  });

  it('throws when emit is called but socket returns undefined', async () => {
    mockContextValue.getSocket.mockReturnValue(undefined);
    const { result } = renderHook(() => useSocket());
    await expect(result.current.emit('testEvent', {})).rejects.toThrow();
  });

  it('delegates on() to the context with the hook id', () => {
    const { result } = renderHook(() => useSocket());
    const handler = vi.fn();
    result.current.on('myEvent', handler);
    expect(mockContextValue.on).toHaveBeenCalledWith('hook-id-1', 'myEvent', handler);
  });

  it('delegates off() to the context with the hook id', () => {
    const { result } = renderHook(() => useSocket());
    result.current.off('myEvent');
    expect(mockContextValue.off).toHaveBeenCalledWith('hook-id-1', 'myEvent');
  });

  it('delegates connect to the context', async () => {
    const { result } = renderHook(() => useSocket());
    await result.current.connect();
    expect(mockContextValue.connect).toHaveBeenCalled();
  });

  it('delegates disconnect to the context', async () => {
    const { result } = renderHook(() => useSocket());
    await result.current.disconnect();
    expect(mockContextValue.disconnect).toHaveBeenCalled();
  });

  it('calls onConnected callback immediately when socket is already connected', () => {
    const fakeSocket = makeConnectedSocket();
    mockContextValue.getSocket.mockReturnValue(fakeSocket);

    const { result } = renderHook(() => useSocket());
    const callback = vi.fn();
    result.current.onConnected(callback);

    expect(callback).toHaveBeenCalledWith(fakeSocket);
  });

  it('calls onDisconnected callback immediately when socket is not connected', () => {
    mockContextValue.getSocket.mockReturnValue(undefined);
    const { result } = renderHook(() => useSocket());
    const callback = vi.fn();
    result.current.onDisconnected(callback);
    expect(callback).toHaveBeenCalled();
  });
});
