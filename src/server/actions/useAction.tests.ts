// src/server/actions/useAction.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmitWithAck = vi.fn();
const mockGetClient = vi.fn().mockReturnValue({ emitWithAck: mockEmitWithAck });
const mockThrowIfAckError = vi.fn((v: unknown) => v);

vi.mock('../providers', () => ({
  useSocketAPI: () => ({ getClient: mockGetClient }),
}));

vi.mock('../../common/ackResponse', () => ({
  throwIfAckError: (v: unknown) => mockThrowIfAckError(v),
}));

import { useAction } from './useAction';
import { defineAction } from '../../common/defineAction';

describe('useAction', () => {
  const echoAction = defineAction<{ msg: string }, { reply: string }>()('unitEcho');

  beforeEach(() => {
    mockEmitWithAck.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockReturnValue({ emitWithAck: mockEmitWithAck });
    mockThrowIfAckError.mockImplementation((v: unknown) => v);
  });

  it('returns a function', () => {
    const fn = useAction(echoAction);
    expect(typeof fn).toBe('function');
  });

  it('calls getClient(true) when the returned function is invoked', async () => {
    mockEmitWithAck.mockResolvedValue({ reply: 'pong' });
    const fn = useAction(echoAction);
    await fn({ msg: 'ping' });
    expect(mockGetClient).toHaveBeenCalledWith(true);
  });

  it('emits on the correct channel (actionPrefix + action.name)', async () => {
    mockEmitWithAck.mockResolvedValue({ reply: 'pong' });
    const fn = useAction(echoAction);
    await fn({ msg: 'ping' });
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      'socket-api.actions.unitEcho',
      { msg: 'ping' },
    );
  });

  it('passes the raw ack result through throwIfAckError', async () => {
    const rawResponse = { reply: 'world' };
    mockEmitWithAck.mockResolvedValue(rawResponse);
    const fn = useAction(echoAction);
    await fn({ msg: 'hello' });
    expect(mockThrowIfAckError).toHaveBeenCalledWith(rawResponse);
  });

  it('resolves with the value returned by throwIfAckError', async () => {
    mockEmitWithAck.mockResolvedValue({ reply: 'ok' });
    mockThrowIfAckError.mockReturnValue({ reply: 'ok' });
    const fn = useAction(echoAction);
    const result = await fn({ msg: 'hi' });
    expect(result).toEqual({ reply: 'ok' });
  });

  it('propagates error when throwIfAckError throws', async () => {
    mockEmitWithAck.mockResolvedValue({ error: new Error('client-side failure') });
    mockThrowIfAckError.mockImplementation(() => { throw new Error('client-side failure'); });
    const fn = useAction(echoAction);
    await expect(fn({ msg: 'hi' })).rejects.toThrow('client-side failure');
  });
});
