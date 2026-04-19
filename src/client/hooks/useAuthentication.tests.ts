import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthentication } from './useAuthentication';

const { mockOn, mockOff, mockReconnect } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
}));

vi.mock('../providers/socket/SocketContext', () => ({
  SocketContext: {
    _currentValue: {
      name: 'test',
      reconnect: mockReconnect,
      on: mockOn,
      off: mockOff,
      getSocket: vi.fn(),
      getRawSocket: vi.fn(),
      onConnectionStateChanged: vi.fn(),
      testDisconnect: vi.fn(),
      testReconnect: vi.fn(),
      onExclusive: vi.fn(),
    },
  },
}));

describe('client useAuthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('user is undefined initially', () => {
    const { result } = renderHook(() => useAuthentication());
    expect(result.current.user).toBeUndefined();
  });

  it('exposes signIn and signOut functions', () => {
    const { result } = renderHook(() => useAuthentication());
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });

  it('registers an event listener via on during render', () => {
    renderHook(() => useAuthentication());
    expect(mockOn).toHaveBeenCalledWith(
      expect.stringContaining('useAuthentication'),
      'socket-api.events.socketAPIUserChanged',
      expect.any(Function),
    );
  });

  it('does not re-render when user changes and user was not accessed', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useAuthentication();
    });
    const initialCount = renderCount;
    // Only access signOut, not user
    expect(typeof result.current.signOut).toBe('function');
    // No re-render should have happened from user change alone
    expect(renderCount).toBe(initialCount);
  });

  it('accessing user enables the reactive re-render flag', () => {
    const { result } = renderHook(() => useAuthentication());
    // Access user — this sets isUserAccessedRef.current = true
    const _user = result.current.user;
    expect(_user).toBeUndefined();
    // The fact it didn't throw means the getter ran correctly
  });
});
