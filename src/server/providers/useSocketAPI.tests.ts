import { describe, it, expect, vi } from 'vitest';

const mockConfig = { name: 'test-socket' };
const mockClient = { id: 'socket-id-1', emit: vi.fn(), emitWithAck: vi.fn() };
const mockGetClient = vi.fn().mockReturnValue(mockClient);
const mockAuthentication = { user: null as null, impersonateUser: vi.fn() };
const mockWrap = vi.fn().mockImplementation((_client: unknown, fn: unknown) => fn);

vi.mock('./authentication', () => ({
  useAuthentication: () => mockAuthentication,
}));

vi.mock('./socket', () => ({
  internalUseSocket: () => ({ getClient: mockGetClient }),
}));

vi.mock('../async-context', () => ({
  useConfig: () => mockConfig,
  wrap: (client: unknown, fn: unknown) => mockWrap(client, fn),
}));

import { useSocketAPI } from './useSocketAPI';

describe('useSocketAPI', () => {
  it('returns config from useConfig', () => {
    const api = useSocketAPI();
    expect(api.config).toBe(mockConfig);
  });

  it('returns getClient from internalUseSocket', () => {
    const api = useSocketAPI();
    expect(api.getClient).toBe(mockGetClient);
  });

  it('spreads user from authentication onto the return value', () => {
    const api = useSocketAPI();
    expect(api.user).toBe(mockAuthentication.user);
  });

  it('spreads impersonateUser from authentication onto the return value', () => {
    const api = useSocketAPI();
    expect(api.impersonateUser).toBe(mockAuthentication.impersonateUser);
  });

  it('returns a wrapWithSocketAPI function', () => {
    const api = useSocketAPI();
    expect(typeof api.wrapWithSocketAPI).toBe('function');
  });

  it('wrapWithSocketAPI calls getClient(true)', () => {
    const api = useSocketAPI();
    const handler = vi.fn();
    api.wrapWithSocketAPI(handler);
    expect(mockGetClient).toHaveBeenCalledWith(true);
  });

  it('wrapWithSocketAPI passes the client and handler to wrap()', () => {
    const api = useSocketAPI();
    const handler = vi.fn();
    api.wrapWithSocketAPI(handler);
    expect(mockWrap).toHaveBeenCalledWith(mockClient, handler);
  });

  it('wrapWithSocketAPI returns the result produced by wrap()', () => {
    const wrapped = vi.fn();
    mockWrap.mockReturnValueOnce(wrapped);

    const api = useSocketAPI();
    const result = api.wrapWithSocketAPI(vi.fn());

    expect(result).toBe(wrapped);
  });
});
