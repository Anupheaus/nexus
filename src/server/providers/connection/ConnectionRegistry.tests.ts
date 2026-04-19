import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'socket.io';
import { ConnectionRegistry } from './ConnectionRegistry';
import { createAsyncContext } from '../../async-context/createAsyncContext';
import { optional } from '../../async-context/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function mockRequest(cookie?: string): IncomingMessage {
  return { headers: { cookie } } as IncomingMessage;
}

function mockResponse() {
  return { setHeader: vi.fn() } as unknown as ServerResponse & { setHeader: ReturnType<typeof vi.fn>; };
}

function mockSocket(socketId: string, cookie?: string): Socket {
  return { id: socketId, handshake: { headers: { cookie } } } as unknown as Socket;
}

function extractId(res: ReturnType<typeof mockResponse>): string {
  const header = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
  return header.split(';')[0]!.split('=')[1]!;
}

// ─── Connection unit ─────────────────────────────────────────────────────────

describe('ConnectionRegistry.fromRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new Connection when no cookie is present', () => {
    const registry = new ConnectionRegistry();
    const conn = registry.fromRequest(mockRequest(), mockResponse());
    expect(conn).toBeDefined();
    expect(conn.id).toBeTruthy();
  });

  it('sets Set-Cookie header on the response for a new connection', () => {
    const registry = new ConnectionRegistry();
    const res = mockResponse();
    registry.fromRequest(mockRequest(), res);
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socket-api-conn='));
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  });

  it('returns the same Connection and skips Set-Cookie when a valid cookie is present', () => {
    const registry = new ConnectionRegistry();
    const res1 = mockResponse();
    const conn1 = registry.fromRequest(mockRequest(), res1);
    const id = extractId(res1);

    const res2 = mockResponse();
    const conn2 = registry.fromRequest(mockRequest(`socket-api-conn=${id}`), res2);

    expect(conn2).toBe(conn1);
    expect(res2.setHeader).not.toHaveBeenCalled();
  });

  it('creates a new Connection (and new cookie) when the stored connection has expired', () => {
    const registry = new ConnectionRegistry(100);
    const res1 = mockResponse();
    const conn1 = registry.fromRequest(mockRequest(), res1);
    const id = extractId(res1);

    vi.advanceTimersByTime(200); // conn1 TTL expires and is destroyed

    const res2 = mockResponse();
    const conn2 = registry.fromRequest(mockRequest(`socket-api-conn=${id}`), res2);

    expect(conn2).not.toBe(conn1);
    expect(res2.setHeader).toHaveBeenCalled(); // new cookie issued
  });

  it('resets the TTL on each REST request (touch)', () => {
    const registry = new ConnectionRegistry(500);
    const res1 = mockResponse();
    registry.fromRequest(mockRequest(), res1);
    const id = extractId(res1);

    vi.advanceTimersByTime(400);
    // touch via another request
    registry.fromRequest(mockRequest(`socket-api-conn=${id}`), mockResponse());

    vi.advanceTimersByTime(400); // only 400ms since last touch — should still be alive
    const res3 = mockResponse();
    const conn3 = registry.fromRequest(mockRequest(`socket-api-conn=${id}`), res3);
    expect(res3.setHeader).not.toHaveBeenCalled(); // same connection, no new cookie
    expect(conn3.id).toBe(id);
  });
});

describe('ConnectionRegistry.fromSocket', () => {
  it('uses socket.id as the connection id when no cookie is present', () => {
    const registry = new ConnectionRegistry();
    const conn = registry.fromSocket(mockSocket('sid-abc'));
    expect(conn.id).toBe('sid-abc');
  });

  it('uses the cookie id when a valid cookie is present', () => {
    const registry = new ConnectionRegistry();
    const conn = registry.fromSocket(mockSocket('sid-abc', 'socket-api-conn=cookie-id-123'));
    expect(conn.id).toBe('cookie-id-123');
  });

  it('returns the same Connection on repeated calls (idempotent)', () => {
    const registry = new ConnectionRegistry();
    const socket = mockSocket('sid-abc');
    expect(registry.fromSocket(socket)).toBe(registry.fromSocket(socket));
  });
});

// ─── Integration: cross-protocol scope sharing ───────────────────────────────

describe('ConnectionRegistry — cross-protocol scope sharing', () => {
  it('fromRequest and fromSocket return the same Connection when the cookie matches', () => {
    const registry = new ConnectionRegistry();
    const wsConn = registry.fromSocket(mockSocket('sid-1', 'socket-api-conn=shared-id'));
    const restConn = registry.fromRequest(mockRequest('socket-api-conn=shared-id'), mockResponse());
    expect(restConn).toBe(wsConn);
  });

  it('value set in WebSocket scope is readable in REST scope via the same Connection', () => {
    const registry = new ConnectionRegistry();
    const { wrap, setUser, useUser } = createAsyncContext({ user: optional<string>() });

    const socket = mockSocket('sid-1', 'socket-api-conn=conn-scope-test');

    // WebSocket handler sets user
    wrap(registry.fromSocket(socket), () => {
      setUser('alice');
    })();

    // REST request reads user
    let readUser: string | undefined;
    wrap(registry.fromRequest(mockRequest('socket-api-conn=conn-scope-test'), mockResponse()), () => {
      readUser = useUser();
    })();

    expect(readUser).toBe('alice');
  });

  it('different connections do not share scoped values', () => {
    const registry = new ConnectionRegistry();
    const { wrap, setUser, useUser } = createAsyncContext({ user: optional<string>() });

    wrap(registry.fromSocket(mockSocket('sid-1', 'socket-api-conn=conn-A')), () => {
      setUser('alice');
    })();

    let readUser: string | undefined;
    wrap(registry.fromSocket(mockSocket('sid-2', 'socket-api-conn=conn-B')), () => {
      readUser = useUser();
    })();

    expect(readUser).toBeUndefined();
  });
});
