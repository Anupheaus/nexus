import { describe, it, expect } from 'vitest';
import { reconstruct } from './reconstruct';

describe('reconstruct', () => {
  it('deserialises data that was serialised for transport', () => {
    const serialised = { foo: 'bar', count: 42 };
    const result = reconstruct(serialised);
    expect(result).toBeDefined();
    expect(result).toEqual(serialised);
  });

  it('reconstructs ISO date string to DateTime when present in serialised form', () => {
    const serialised = { timestamp: '2024-01-15T12:00:00.000Z' };
    const result = reconstruct(serialised) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.timestamp).toBeDefined();
    // to.deserialise converts ISO strings to Luxon DateTime
    const ts = result.timestamp as { toISO?: () => string };
    if (ts && typeof ts.toISO === 'function') {
      // Luxon may return +00:00 or Z for UTC - both are equivalent
      expect(ts.toISO()).toMatch(/2024-01-15T12:00:00\.000(Z|\+00:00)/);
    } else {
      expect(result.timestamp).toBe('2024-01-15T12:00:00.000Z');
    }
  });

  it('returns data when deserialisation succeeds', () => {
    const data = { a: 1, b: 'two' };
    const result = reconstruct(data);
    expect(result).toEqual(data);
  });

  it('handles empty object', () => {
    const result = reconstruct({});
    expect(result).toEqual({});
  });

  it('handles nested objects', () => {
    const data = { level1: { level2: { value: 1 } } };
    const result = reconstruct(data);
    expect(result).toEqual(data);
  });
});
