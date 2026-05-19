import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useContext } from 'react';
import type { Socket } from 'socket.io-client';
import { InternalError } from '@anupheaus/common';

// ── fake socket ───────────────────────────────────────────────────────────────

class FakeSocket {
  public id = 'fake-socket-1';
  public connected = false;
  private _handlers: Map<string, Function[]> = new Map();
  public io = { opts: {} };

  on(event: string, fn: Function) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(fn);
    return this;
  }

  off(event: string, fn: Function) {
    const list = this._handlers.get(event) ?? [];
    this._handlers.set(event, list.filter(h => h !== fn));
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    (this._handlers.get(event) ?? []).forEach(fn => fn(...args));
  }

  connect() {
    this.connected = true;
    this.emit('connect');
    return this;
  }

  disconnect() {
    this.connected = false;
    this.emit('disconnect', 'io client disconnect');
    return this;
  }

  removeListener = this.off.bind(this);
  listeners = (event: string) => this._handlers.get(event) ?? [];
}

// ── mocks ─────────────────────────────────────────────────────────────────────

const { mockCreateClientSocket, currentFakeSocket } = vi.hoisted(() => {
  let _socket: FakeSocket | null = null;
  const mockCreateClientSocket = vi.fn(() => {
    _socket = new FakeSocket();
    return _socket as unknown as Socket;
  });
  const currentFakeSocket = () => _socket!;
  return { mockCreateClientSocket, currentFakeSocket };
});

vi.mock('./createClientSocket', () => ({ createClientSocket: mockCreateClientSocket }));
vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
    useBound: vi.fn((fn: Function) => fn),
    useId: vi.fn(() => 'test-id'),
    useLogger: vi.fn(() => ({
      info: vi.fn(), debug: vi.fn(), error: vi.fn(), silly: vi.fn(),
      warn: vi.fn(), always: vi.fn(),
    })),
    useMap: vi.fn(() => new Map()),
    useOnUnmount: vi.fn(),
  };
});

import { SocketContext } from './SocketContext';
import { SocketProvider } from './SocketProvider';

// ── helpers ───────────────────────────────────────────────────────────────────

type CapturedContext = typeof SocketContext extends React.Context<infer T> ? T : never;

function CaptureContext({ onCapture }: { onCapture: (ctx: CapturedContext) => void }) {
  const ctx = useContext(SocketContext);
  React.useEffect(() => { onCapture(ctx); }, [ctx]);
  return null;
}

function renderProvider(props: Partial<React.ComponentProps<typeof SocketProvider>> = {}) {
  let capturedCtx: CapturedContext | undefined;
  render(
    React.createElement(SocketProvider as any, { name: 'test', autoConnect: false, ...props },
      React.createElement(CaptureContext, { onCapture: ctx => { capturedCtx = ctx; } }),
    ),
  );
  return { getCtx: () => capturedCtx! };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SocketProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('provides a context with name matching the prop', async () => {
    const { getCtx } = renderProvider({ name: 'my-api' });
    await act(async () => {});
    expect(getCtx().name).toBe('my-api');
  });

  it('does not call createClientSocket when autoConnect is false and connect() has not been called', async () => {
    renderProvider({ autoConnect: false });
    await act(async () => {});
    expect(mockCreateClientSocket).not.toHaveBeenCalled();
  });

  it('getSocket() returns undefined before connect()', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});
    expect(getCtx().getSocket()).toBeUndefined();
  });

  it('connect() resolves when the socket emits "connect"', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    let resolved = false;
    act(() => {
      getCtx().connect().then(() => { resolved = true; });
    });

    await act(async () => {
      currentFakeSocket()?.connect();
    });

    expect(resolved).toBe(true);
  });

  it('waitForAuthCheck() resolves immediately when authCheck already completed', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    act(() => { getCtx().connect(); });
    await act(async () => {
      const socket = currentFakeSocket();
      socket?.connect();
      socket?.emit('nexus:authCheckComplete');
    });

    const p = getCtx().waitForAuthCheck();
    await expect(p).resolves.toBeUndefined();
  });

  it('waitForAuthCheck() resolves after timeout when authCheckComplete is never emitted', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    act(() => { getCtx().connect(); });
    await act(async () => { currentFakeSocket()?.connect(); });

    let resolved = false;
    act(() => { getCtx().waitForAuthCheck().then(() => { resolved = true; }); });

    await act(async () => { vi.advanceTimersByTime(11_000); });

    expect(resolved).toBe(true);
  });

  it('exclusive handler conflict throws when registering two useServerActionHandler for same event', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    const ctx = getCtx();
    ctx.onExclusive('hook-a', 'myEvent', vi.fn());
    expect(() => ctx.onExclusive('hook-b', 'myEvent', vi.fn())).toThrow(InternalError);
  });

  it('exclusive and multicast conflict throws when adding a multicast listener to an exclusive event', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    const ctx = getCtx();
    ctx.onExclusive('hook-a', 'exclusiveEvent', vi.fn());
    expect(() => ctx.on('hook-b', 'exclusiveEvent', vi.fn())).toThrow(InternalError);
  });
});
