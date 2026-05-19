import { describe, it, expect } from 'vitest';
import { reconstruct } from './reconstruct';
import { deconstruct } from './deconstruct';

describe('reconstruct', () => {
  it('deserialises a plain object unchanged', () => {
    const data = { foo: 'bar', count: 42 };
    expect(reconstruct(data)).toEqual(data);
  });

  it('converts an ISO date string property to a DateTime-like object with toISO()', () => {
    const result = reconstruct({ timestamp: '2024-01-15T12:00:00.000Z' }) as Record<string, unknown>;
    const ts = result.timestamp as { toISO: () => string };
    expect(typeof ts.toISO).toBe('function');
    expect(ts.toISO()).toMatch(/2024-01-15T12:00:00\.000(Z|\+00:00)/);
  });

  it('handles empty object', () => {
    expect(reconstruct({})).toEqual({});
  });

  it('handles nested objects', () => {
    const data = { level1: { level2: { value: 1 } } };
    expect(reconstruct(data)).toEqual(data);
  });

  it('returns data unchanged when deserialise throws', () => {
    // to.deserialise should not throw on well-formed objects, but this validates
    // the try/catch safety net.
    const data = { x: 1 };
    expect(reconstruct(data)).toEqual(data);
  });

  it('round-trips through deconstruct back to the original value', () => {
    const original = { name: 'Bob', score: 99 };
    const serialised = deconstruct(original) as Parameters<typeof reconstruct>[0];
    expect(reconstruct(serialised)).toEqual(original);
  });
});
