import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockOnExclusive, mockOff } = vi.hoisted(() => ({
  mockOnExclusive: vi.fn(),
  mockOff: vi.fn(),
}));

vi.mock('../providers', () => ({
  useSocket: () => ({
    onExclusive: mockOnExclusive,
    off: mockOff,
    on: vi.fn(),
    emit: vi.fn(),
    getIsConnected: vi.fn(() => false),
    getRawSocket: vi.fn(() => null),
    onConnected: vi.fn(),
    onConnectionStateChanged: vi.fn(),
  }),
}));

beforeEach(() => { vi.clearAllMocks(); });

import { defineAction } from '../../common';
import { useServerActionHandler } from './useServerActionHandler';
import { actionPrefix } from '../../common/internalModels';

const pingAction = defineAction<{ msg: string }, { reply: string }>()('ping');

describe('useServerActionHandler', () => {
  it('registers an exclusive listener on mount with the correct event name', () => {
    renderHook(() => useServerActionHandler(pingAction));
    expect(mockOnExclusive).toHaveBeenCalledWith(
      `${actionPrefix}.${pingAction.name}`,
      expect.any(Function),
    );
  });

  it('deregisters the listener on unmount', () => {
    const { unmount } = renderHook(() => useServerActionHandler(pingAction));
    unmount();
    expect(mockOff).toHaveBeenCalledWith(`${actionPrefix}.${pingAction.name}`);
  });

  it('returned setter updates the handler ref so latest handler is invoked', async () => {
    const { result } = renderHook(() => useServerActionHandler(pingAction));

    const replies: string[] = [];
    act(() => {
      result.current(({ msg }) => { replies.push(`v1:${msg}`); return { reply: `v1:${msg}` }; });
    });

    // The socket handler passed to onExclusive wraps handlerRef.current via wrapAckHandler
    const socketHandler = mockOnExclusive.mock.calls[0][1];
    await act(async () => { await socketHandler({ msg: 'hi' }); });
    expect(replies).toContain('v1:hi');

    // Replace handler
    act(() => {
      result.current(({ msg }) => { replies.push(`v2:${msg}`); return { reply: `v2:${msg}` }; });
    });
    await act(async () => { await socketHandler({ msg: 'bye' }); });
    expect(replies).toContain('v2:bye');
    // Old handler not called again
    expect(replies.filter(r => r.startsWith('v1'))).toHaveLength(1);
  });

  it('encodes a thrown error as an { error } ack payload rather than propagating the throw', async () => {
    const { result } = renderHook(() => useServerActionHandler(pingAction));
    act(() => {
      result.current(() => { throw new Error('handler-blew-up'); });
    });

    const socketHandler = mockOnExclusive.mock.calls[0][1];

    // The socket handler must not throw — wrapAckHandler catches and encodes the error.
    let response: unknown;
    await expect(act(async () => { response = await socketHandler({ msg: 'hi' }); })).resolves.not.toThrow();

    // The ack payload must carry an error property so the server can surface it to the caller.
    expect(response).toMatchObject({ error: expect.anything() });
  });
});
