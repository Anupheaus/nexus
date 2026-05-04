import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmitWithAck = vi.fn();
const mockUseClient = vi.fn().mockReturnValue({ emitWithAck: mockEmitWithAck });

vi.mock('../providers', () => ({
  useClient: () => mockUseClient(),
}));

import { useEvent } from './useEvent';
import { defineEvent } from '../../common/defineEvent';

describe('useEvent', () => {
  const pingEvent = defineEvent<{ tag: string }>('unitPing');

  beforeEach(() => {
    mockEmitWithAck.mockReset().mockResolvedValue(undefined);
    mockUseClient.mockReset();
    mockUseClient.mockReturnValue({ emitWithAck: mockEmitWithAck });
  });

  it('returns a function', () => {
    const fn = useEvent(pingEvent);
    expect(typeof fn).toBe('function');
  });

  it('throws when useClient returns null (no active client connection)', async () => {
    mockUseClient.mockReturnValue(null);
    const fn = useEvent(pingEvent);
    await expect(fn({ tag: 'hello' })).rejects.toThrow('useEvent requires an active client connection');
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
