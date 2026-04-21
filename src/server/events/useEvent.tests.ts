import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmitWithAck = vi.fn();
const mockGetClient = vi.fn().mockReturnValue({ emitWithAck: mockEmitWithAck });

vi.mock('../providers', () => ({
  useSocketAPI: () => ({ getClient: mockGetClient }),
}));

import { useEvent } from './useEvent';
import { defineEvent } from '../../common/defineEvent';

describe('useEvent', () => {
  const pingEvent = defineEvent<{ tag: string }>('unitPing');

  beforeEach(() => {
    mockEmitWithAck.mockReset().mockResolvedValue(undefined);
    mockGetClient.mockReset();
    mockGetClient.mockReturnValue({ emitWithAck: mockEmitWithAck });
  });

  it('returns a function', () => {
    const fn = useEvent(pingEvent);
    expect(typeof fn).toBe('function');
  });

  it('calls getClient(true) when the returned function is invoked', async () => {
    const fn = useEvent(pingEvent);
    await fn({ tag: 'hello' });
    expect(mockGetClient).toHaveBeenCalledWith(true);
  });

  it('emits on the correct channel (eventPrefix + event.name)', async () => {
    const fn = useEvent(pingEvent);
    await fn({ tag: 'hello' });
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      'socket-api.events.unitPing',
      { tag: 'hello' },
    );
  });

  it('passes the payload to emitWithAck', async () => {
    const fn = useEvent(pingEvent);
    await fn({ tag: 'specific-tag' });
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      expect.any(String),
      { tag: 'specific-tag' },
    );
  });

  it('resolves without error when emitWithAck resolves', async () => {
    const fn = useEvent(pingEvent);
    await expect(fn({ tag: 'ok' })).resolves.toBeUndefined();
  });

  it('propagates rejection when emitWithAck rejects', async () => {
    mockEmitWithAck.mockRejectedValue(new Error('socket write failed'));
    const fn = useEvent(pingEvent);
    await expect(fn({ tag: 'fail' })).rejects.toThrow('socket write failed');
  });
});
