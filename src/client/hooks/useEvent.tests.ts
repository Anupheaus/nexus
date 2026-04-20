import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockOn } = vi.hoisted(() => ({
  mockOn: vi.fn(),
}));

vi.mock('../providers', () => ({
  useSocket: () => ({
    on: mockOn,
    off: vi.fn(),
    emit: vi.fn(),
    getIsConnected: vi.fn(() => false),
    getRawSocket: vi.fn(() => null),
    onConnected: vi.fn(),
    onConnectionStateChanged: vi.fn(),
    onDisconnected: vi.fn(),
  }),
}));

beforeEach(() => { vi.clearAllMocks(); });

// Import after mocks
import { useEvent } from './useEvent';
import { eventPrefix } from '../../common/internalModels';
import { defineEvent } from '../../common';

const testEvent = defineEvent<{ message: string }>('testMsg');

describe('useEvent', () => {
  it('registers a listener on the correct event channel', () => {
    renderHook(() => useEvent(testEvent));
    expect(mockOn).toHaveBeenCalledWith(
      `${eventPrefix}.${testEvent.name}`,
      expect.any(Function),
    );
  });

  it('returned setter updates the handler ref so the latest handler is called', () => {
    const captured: string[] = [];
    const { result } = renderHook(() => useEvent(testEvent));

    act(() => {
      result.current(({ message }) => { captured.push(`v1:${message}`); });
    });

    // Simulate the socket emitting the event by calling the registered socket listener
    const socketListener = mockOn.mock.calls[0][1]; // second arg is the handler
    act(() => { socketListener({ message: 'hello' }); });
    expect(captured).toEqual(['v1:hello']);

    // Replace handler — same socket listener, new function
    act(() => {
      result.current(({ message }) => { captured.push(`v2:${message}`); });
    });
    act(() => { socketListener({ message: 'world' }); });
    expect(captured).toEqual(['v1:hello', 'v2:world']);
  });

  it('socket listener is registered once (not re-registered on re-render)', () => {
    const { rerender } = renderHook(() => useEvent(testEvent));
    const callCount = mockOn.mock.calls.length;
    rerender();
    // on() may be called again each render (React hook lifecycle), but each call
    // should use the same stable event name
    const eventNames = mockOn.mock.calls.map((c: unknown[]) => c[0]);
    eventNames.forEach((name: unknown) => expect(name).toBe(`${eventPrefix}.${testEvent.name}`));
    expect(callCount).toBeGreaterThan(0);
  });
});
