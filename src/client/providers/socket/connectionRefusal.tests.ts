import { describe, it, expect } from 'vitest';
import { getConnectionRefusalReason } from './connectionRefusal';

/** A `connect_error` as socket.io-client raises it for an error the server's middleware passed to `next`. */
function refusal(data: unknown): Error {
  return Object.assign(new Error('The connection was refused'), { data });
}

describe('getConnectionRefusalReason', () => {
  it('reads the reason the server refused the connection with', () => {
    expect(getConnectionRefusalReason(refusal({ reason: 'device-disabled' }))).toBe('device-disabled');
  });

  it('answers nothing for a connection error that is not a refusal (the server is unreachable)', () => {
    expect(getConnectionRefusalReason(new Error('websocket error'))).toBeUndefined();
    expect(getConnectionRefusalReason(refusal(undefined))).toBeUndefined();
  });

  it('answers nothing for a refusal whose reason is missing, empty or not text', () => {
    expect(getConnectionRefusalReason(refusal({}))).toBeUndefined();
    expect(getConnectionRefusalReason(refusal({ reason: '' }))).toBeUndefined();
    expect(getConnectionRefusalReason(refusal({ reason: 42 }))).toBeUndefined();
    expect(getConnectionRefusalReason(refusal('device-disabled'))).toBeUndefined();
  });

  it('answers nothing for something that is not an error at all', () => {
    expect(getConnectionRefusalReason(undefined)).toBeUndefined();
    expect(getConnectionRefusalReason('device-disabled')).toBeUndefined();
  });
});
