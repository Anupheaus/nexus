import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../async-context', () => ({
  useClient: vi.fn(),
}));

import { useClient } from '../../async-context';
import { internalUseSocket } from './internalUseSocket';

const mockSocket = { id: 'sock-1', emit: vi.fn() } as any;

describe('internalUseSocket', () => {
  beforeEach(() => {
    vi.mocked(useClient).mockReturnValue(undefined as any);
  });

  it('exposes a getClient function', () => {
    const { getClient } = internalUseSocket();
    expect(typeof getClient).toBe('function');
  });

  describe('getClient() — no client available', () => {
    it('returns undefined when called with no argument', () => {
      const { getClient } = internalUseSocket();
      expect(getClient()).toBeUndefined();
    });

    it('returns undefined when called with false', () => {
      const { getClient } = internalUseSocket();
      expect(getClient(false)).toBeUndefined();
    });

    it('throws a descriptive error when called with true', () => {
      const { getClient } = internalUseSocket();
      expect(() => getClient(true)).toThrow('Socket client is not available at this location.');
    });
  });

  describe('getClient() — client available', () => {
    beforeEach(() => {
      vi.mocked(useClient).mockReturnValue(mockSocket);
    });

    it('returns the socket when called with no argument', () => {
      const { getClient } = internalUseSocket();
      expect(getClient()).toBe(mockSocket);
    });

    it('returns the socket when called with false', () => {
      const { getClient } = internalUseSocket();
      expect(getClient(false)).toBe(mockSocket);
    });

    it('returns the socket when called with true', () => {
      const { getClient } = internalUseSocket();
      expect(getClient(true)).toBe(mockSocket);
    });
  });

  describe('each call to internalUseSocket() uses the current client value', () => {
    it('reflects the client set at call time, not at internalUseSocket() construction time', () => {
      const { getClient } = internalUseSocket();

      vi.mocked(useClient).mockReturnValue(undefined as any);
      expect(getClient()).toBeUndefined();

      vi.mocked(useClient).mockReturnValue(mockSocket);
      expect(getClient()).toBe(mockSocket);
    });
  });
});
