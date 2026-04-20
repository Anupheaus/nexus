import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockEmit, mockGetIsConnected, mockGetRawSocket, mockOnConnected } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockGetIsConnected: vi.fn(() => false),
  mockGetRawSocket: vi.fn(() => null),
  mockOnConnected: vi.fn(),
}));

vi.mock('../providers', () => ({
  useSocket: () => ({
    emit: mockEmit,
    getIsConnected: mockGetIsConnected,
    getRawSocket: mockGetRawSocket,
    onConnected: mockOnConnected,
    on: vi.fn(),
    off: vi.fn(),
    onConnectionStateChanged: vi.fn(),
  }),
}));

vi.mock('../providers/socket/SocketContext', () => {
  const ctx = React.createContext({ name: 'test' } as any);
  return { SocketContext: ctx };
});

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIsConnected.mockReturnValue(false);
  mockGetRawSocket.mockReturnValue(null);
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

import { defineAction } from '../../common/defineAction';
import { useAction } from './useAction';

const echoAction = defineAction<{ value: string }, { value: string }>()('echo');
const getAction = defineAction<{ id: string }, { name: string }>()('getUser', {
  rest: { method: 'GET', url: '/users/:id' },
});
const postAction = defineAction<{ title: string }, { id: string }>()('createPost', {
  rest: { method: 'POST', url: '/posts' },
});

describe('useAction — REST catch-all (POST /name/actions/:actionName)', () => {
  it('calls the catch-all REST endpoint when socket is not connected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ value: 'world' }),
    });

    const { result } = renderHook(() => useAction(echoAction));
    let response: { value: string } | undefined;
    await act(async () => {
      response = await (result.current as any).echo({ value: 'world' });
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/test/actions/echo');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ value: 'world' });
    expect(response).toEqual({ value: 'world' });
  });

  it('throws on 401 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useAction(echoAction));
    await expect(
      act(async () => { await (result.current as any).echo({ value: 'x' }); }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws on error body from server', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'bad request' } }),
    });

    const { result } = renderHook(() => useAction(echoAction));
    await expect(
      act(async () => { await (result.current as any).echo({ value: 'x' }); }),
    ).rejects.toThrow('bad request');
  });
});

describe('useAction — explicit REST route (GET with path + query params)', () => {
  it('builds GET URL with path param and no extra query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ name: 'Alice' }),
    });

    const { result } = renderHook(() => useAction(getAction));
    await act(async () => {
      await (result.current as any).getUser({ id: 'u-1' });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/users/u-1');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('builds GET URL with remaining props as query string', async () => {
    const searchAction = defineAction<{ id: string; q: string }, void>()('search', {
      rest: { method: 'GET', url: '/items/:id' },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });

    const { result } = renderHook(() => useAction(searchAction));
    await act(async () => {
      await (result.current as any).search({ id: 'x', q: 'hello world' });
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/items/x');
    expect(url).toContain('q=hello+world');
  });
});

describe('useAction — explicit REST route (POST with body)', () => {
  it('sends POST body and excludes path param from body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'p-1' }) });

    const { result } = renderHook(() => useAction(postAction));
    await act(async () => {
      await (result.current as any).createPost({ title: 'Hello' });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/posts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ title: 'Hello' });
  });
});

describe('useAction — uses socket when connected', () => {
  it('emits over socket instead of fetch when connected', async () => {
    mockGetIsConnected.mockReturnValue(true);
    mockEmit.mockResolvedValueOnce({ response: { value: 'pong' } });

    const { result } = renderHook(() => useAction(echoAction));
    let response: unknown;
    await act(async () => {
      response = await (result.current as any).echo({ value: 'ping' });
    });

    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    // throwIfAckError returns the payload as-is when there is no 'error' key
    expect(response).toEqual({ response: { value: 'pong' } });
  });
});
