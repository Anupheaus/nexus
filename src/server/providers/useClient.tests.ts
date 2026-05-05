import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';

const mockSocket = { id: 'socket-1' } as unknown as Socket;
const mockGetClient = vi.fn<[], Socket | undefined>();

vi.mock('./socket', () => ({
  internalUseSocket: () => ({ getClient: mockGetClient }),
}));

import { useClient } from './useClient';

describe('useClient', () => {
  it('returns undefined when no client is active', () => {
    mockGetClient.mockReturnValue(undefined);
    expect(useClient()).toBeUndefined();
  });

  it('returns the active socket client', () => {
    mockGetClient.mockReturnValue(mockSocket);
    expect(useClient()).toBe(mockSocket);
  });
});
