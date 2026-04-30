import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { SocketAPIUser } from '../../common';

const { mockOn, mockOff, mockReconnect, mockSetUser } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
  mockSetUser: vi.fn(),
}));

vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
    useBound: (fn: unknown) => fn,
    useDistributedState: () => ({ state: {} as any, set: mockSetUser }),
  };
});

vi.mock('react', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    useContext: () => ({ on: mockOn, off: mockOff, name: 'test', reconnect: mockReconnect }),
  };
});

import { AuthenticationProvider } from './AuthenticationProvider';

function getHandler(eventName: string): (...args: any[]) => void {
  const call = mockOn.mock.calls.find(([, name]) => name === eventName);
  if (!call) throw new Error(`No handler registered for ${eventName}`);
  return call[2];
}

describe('AuthenticationProvider', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('calls onDeviceDisabled when socketAPIDeviceDisabled event fires', () => {
    const onDeviceDisabled = vi.fn();
    render(<AuthenticationProvider onDeviceDisabled={onDeviceDisabled}><span /></AuthenticationProvider>);
    act(() => getHandler('socket-api.events.socketAPIDeviceDisabled')());
    expect(onDeviceDisabled).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onDeviceDisabled is not provided', () => {
    render(<AuthenticationProvider><span /></AuthenticationProvider>);
    expect(() => act(() => getHandler('socket-api.events.socketAPIDeviceDisabled')())).not.toThrow();
  });

  it('calls onSignedIn(user) when user transitions undefined → defined', () => {
    const onSignedIn = vi.fn();
    render(<AuthenticationProvider onSignedIn={onSignedIn}><span /></AuthenticationProvider>);
    const user: SocketAPIUser = { id: 'u1' };
    act(() => getHandler('socket-api.events.socketAPIUserChanged')({ user }));
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(onSignedIn).toHaveBeenCalledWith(user);
  });

  it('does not re-fire onSignedIn on user update (already signed in)', () => {
    const onSignedIn = vi.fn();
    render(<AuthenticationProvider onSignedIn={onSignedIn}><span /></AuthenticationProvider>);
    const handler = getHandler('socket-api.events.socketAPIUserChanged');
    act(() => handler({ user: { id: 'u1' } }));
    act(() => handler({ user: { id: 'u1-updated' } }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('calls onSignedOut when user transitions defined → undefined', () => {
    const onSignedOut = vi.fn();
    render(<AuthenticationProvider onSignedOut={onSignedOut}><span /></AuthenticationProvider>);
    const handler = getHandler('socket-api.events.socketAPIUserChanged');
    act(() => handler({ user: { id: 'u1' } }));
    act(() => handler({ user: undefined }));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('does not call onSignedOut when there was no prior user', () => {
    const onSignedOut = vi.fn();
    render(<AuthenticationProvider onSignedOut={onSignedOut}><span /></AuthenticationProvider>);
    act(() => getHandler('socket-api.events.socketAPIUserChanged')({ user: undefined }));
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
