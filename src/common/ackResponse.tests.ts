import { describe, it, expect } from 'vitest';
import { getErrorFromAckResponse, throwIfAckError, wrapAckHandler } from './ackResponse';

describe('getErrorFromAckResponse', () => {
  const nonErrorValues = [
    { result: 'ok' },
    { nested: { error: 'not at top level' } },
    'a string',
    42,
    true,
    null,
    undefined,
    [],
  ] as const;

  it.each(nonErrorValues as readonly unknown[])(
    'treats %p as a success response (no error key at top level)',
    (value) => {
      const { error, response } = getErrorFromAckResponse(value);
      expect(error).toBeUndefined();
      expect(response).toBe(value);
    },
  );

  it('detects a plain object with an error key as an error payload', () => {
    const payload = { error: new globalThis.Error('something went wrong') };
    const { error, response } = getErrorFromAckResponse(payload);
    expect(error).toBeDefined();
    expect(response).toBeUndefined();
  });

  it('reconstructed error preserves the original message', () => {
    const payload = { error: new globalThis.Error('oops') };
    const { error } = getErrorFromAckResponse(payload);
    expect(error?.message).toBe('oops');
  });
});

describe('throwIfAckError', () => {
  const passThroughValues = [
    { id: 'u1', name: 'Alice' },
    'hello',
    0,
    null,
    [],
  ] as const;

  it.each(passThroughValues as readonly unknown[])(
    'returns %p unchanged when there is no error',
    (value) => {
      expect(throwIfAckError(value)).toBe(value);
    },
  );

  it('throws when the response is an error payload', () => {
    const payload = { error: new globalThis.Error('bad thing') };
    expect(() => throwIfAckError(payload)).toThrow('bad thing');
  });

  it('the thrown value is an Error instance', () => {
    const payload = { error: new globalThis.Error('bad thing') };
    expect(() => throwIfAckError(payload)).toThrow(globalThis.Error);
  });
});

describe('wrapAckHandler', () => {
  describe('successful handlers', () => {
    it('returns the result of a synchronous handler', async () => {
      const result = await wrapAckHandler(() => ({ id: 1, name: 'Alice' }));
      expect(result).toEqual({ id: 1, name: 'Alice' });
    });

    it('returns the result of an async handler', async () => {
      const result = await wrapAckHandler(async () => 'async-value');
      expect(result).toBe('async-value');
    });

    it('passes through null results', async () => {
      const result = await wrapAckHandler(() => null);
      expect(result).toBeNull();
    });

    it('passes through numeric results', async () => {
      const result = await wrapAckHandler(() => 0);
      expect(result).toBe(0);
    });
  });

  describe('error handling', () => {
    it('returns an error payload when the handler throws an Error', async () => {
      const result = await wrapAckHandler(() => {
        throw new globalThis.Error('something failed');
      });
      expect(result).toHaveProperty('error');
      expect((result as { error: { message: string } }).error.message).toBe('something failed');
    });

    it('returns an error payload when an async handler rejects', async () => {
      const result = await wrapAckHandler(async () => {
        throw new globalThis.Error('async-fail');
      });
      expect((result as { error: { message: string } }).error.message).toBe('async-fail');
    });

    it('converts a thrown string to an error payload', async () => {
      const result = await wrapAckHandler(() => {
        throw 'just a string';
      });
      expect(result).toHaveProperty('error');
      expect((result as { error: { message: string } }).error.message).toBe('just a string');
    });

    it('converts a thrown number to an error payload', async () => {
      const result = await wrapAckHandler(() => {
        throw 42;
      });
      expect((result as { error: { message: string } }).error.message).toBe('42');
    });

    it('does not expose original error properties beyond the message — only message crosses the wire', async () => {
      const original = new globalThis.Error('public message');
      (original as unknown as Record<string, unknown>).sensitiveData = 'internal-secret';
      (original as unknown as Record<string, unknown>).causeInfo = 'hidden-cause';

      const result = await wrapAckHandler(() => {
        throw original;
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('internal-secret');
      expect(serialized).not.toContain('hidden-cause');
      expect((result as { error: { message: string } }).error.message).toBe('public message');
    });

    it('does not leak the original error stack trace into the returned error', async () => {
      const original = new globalThis.Error('public message');
      const originalStack = original.stack ?? '';

      const result = await wrapAckHandler(() => {
        throw original;
      });

      const errorPayload = (result as { error: { stack?: string } }).error;
      // The returned error must have a fresh stack, not the captured original stack lines
      expect(errorPayload.stack).not.toBe(originalStack);
    });
  });

  describe('non-error results are not mistaken for error payloads', () => {
    it('a result object with no error key is returned as-is', async () => {
      const result = await wrapAckHandler(() => ({ status: 'ok', count: 5 }));
      expect(result).toEqual({ status: 'ok', count: 5 });
    });
  });
});
