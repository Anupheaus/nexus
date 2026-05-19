import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { NexusUser } from '../../common';

const { mockReconnect, mockCallSignOut } = vi.hoisted(() => ({
  mockReconnect: vi.fn(),
  mockCallSignOut: vi.fn(() => Promise.resolve()),
}));

// Capture event handlers by full event name so tests can invoke them directly.
const eventHandlers = new Map<string, (...args: any[]) => void>();

vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
    useBound: (fn: unknown) => fn,
    useDistributedState: () => ({ state: {} as any, set: vi.fn() }),
  };
});

vi.mock('react', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    useContext: () => ({ reconnect: mockReconnect }),
  };
});

// Mock the hooks barrel to prevent real socket wiring; capture useEvent handlers by name.
vi.mock('../hooks', () => ({
  useAction: () => ({ signOut: mockCallSignOut }),
  useEvent: (event: any) => (handler: any) => {
    eventHandlers.set(`socket-api.events.${event.name}`, handler);
  },
}));

import { AuthenticationProvider } from './AuthenticationProvider';

function getHandler(eventName: string): (...args: any[]) => void {
  const h = eventHandlers.get(eventName);
  if (!h) throw new Error(`No handler registered for ${eventName}`);
  return h;
}

describe('AuthenticationProvider', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); eventHandlers.clear(); });

  it('calls onDeviceDisabled when socketAPIDeviceDisabled event fires', () => {
    const onDeviceDisabled = vi.fn();
    render(<AuthenticationProvider onDeviceDisabled={onDeviceDisabled}><span /></AuthenticationProvider>);
    act(() => getHandler('nexus.events.socketAPIDeviceDisabled')());
    expect(onDeviceDisabled).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onDeviceDisabled is not provided', () => {
    render(<AuthenticationProvider><span /></AuthenticationProvider>);
    expect(() => act(() => getHandler('nexus.events.socketAPIDeviceDisabled')())).not.toThrow();
  });

  it('calls onSignedIn(user) when user transitions undefined → defined', () => {
    const onSignedIn = vi.fn();
    render(<AuthenticationProvider onSignedIn={onSignedIn}><span /></AuthenticationProvider>);
    const user: NexusUser = { id: 'u1' };
    act(() => getHandler('nexus.events.socketAPIUserChanged')({ user }));
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(onSignedIn).toHaveBeenCalledWith(user);
  });

  it('does not re-fire onSignedIn on user update (already signed in)', () => {
    const onSignedIn = vi.fn();
    render(<AuthenticationProvider onSignedIn={onSignedIn}><span /></AuthenticationProvider>);
    const handler = getHandler('nexus.events.socketAPIUserChanged');
    act(() => handler({ user: { id: 'u1' } }));
    act(() => handler({ user: { id: 'u1-updated' } }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('calls onSignedOut when user transitions defined → undefined', () => {
    const onSignedOut = vi.fn();
    render(<AuthenticationProvider onSignedOut={onSignedOut}><span /></AuthenticationProvider>);
    const handler = getHandler('nexus.events.socketAPIUserChanged');
    act(() => handler({ user: { id: 'u1' } }));
    act(() => handler({ user: undefined }));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('does not call onSignedOut when there was no prior user', () => {
    const onSignedOut = vi.fn();
    render(<AuthenticationProvider onSignedOut={onSignedOut}><span /></AuthenticationProvider>);
    act(() => getHandler('nexus.events.socketAPIUserChanged')({ user: undefined }));
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
