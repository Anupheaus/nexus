import { describe, it, expect } from 'vitest';
import { Context } from './contexts';

// The contextMap is a module-level singleton, so each test uses a unique key to
// avoid cross-test interference without needing to reset internal state.

describe('Context', () => {
  it('get returns the value previously set for a key', () => {
    Context.set('ctx-test-basic', { id: 42 });
    expect(Context.get<{ id: number }>('ctx-test-basic')).toEqual({ id: 42 });
  });

  it('get throws InternalError when the key has never been set', () => {
    expect(() => Context.get('ctx-test-missing-key-xyz')).toThrow('ctx-test-missing-key-xyz context not found');
  });

  it('set overwrites the existing value for the same key', () => {
    Context.set('ctx-test-overwrite', 'first');
    Context.set('ctx-test-overwrite', 'second');
    expect(Context.get<string>('ctx-test-overwrite')).toBe('second');
  });

  it('stores independent values for different keys', () => {
    Context.set('ctx-test-num', 99);
    Context.set('ctx-test-str', 'hello');
    expect(Context.get<number>('ctx-test-num')).toBe(99);
    expect(Context.get<string>('ctx-test-str')).toBe('hello');
  });

  it('set accepts null as a valid value', () => {
    Context.set('ctx-test-null', null);
    expect(Context.get<null>('ctx-test-null')).toBeNull();
  });

  it('get does not throw after a null value is stored (distinguishes missing from null)', () => {
    Context.set('ctx-test-null-stored', null);
    // Should return null, not throw — key exists even though value is null.
    expect(() => Context.get('ctx-test-null-stored')).not.toThrow();
  });
});
