import { describe, it, expect } from 'vitest';
import { deconstruct } from './deconstruct';

describe('deconstruct', () => {
  it('serialises plain objects for transport', () => {
    const data = { foo: 'bar', count: 42 };
    const result = deconstruct(data);
    expect(result).toBeDefined();
    // to.serialise converts objects to JSON string for transport
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsed).toEqual(data);
  });

  it('returns non-plain-object data unchanged', () => {
    expect(deconstruct('string')).toBe('string');
    expect(deconstruct(123)).toBe(123);
    expect(deconstruct(null)).toBe(null);
    expect(deconstruct(undefined)).toBe(undefined);
    expect(deconstruct(true)).toBe(true);
  });

  it('handles arrays - returns them unchanged (arrays are not plain objects)', () => {
    const arr = [1, 2, 3];
    const result = deconstruct(arr);
    expect(result).toBe(arr);
  });

  it('handles nested plain objects', () => {
    const data = { nested: { value: 1 } };
    const result = deconstruct(data);
    expect(result).toBeDefined();
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsed).toEqual(data);
  });

  it('handles Date objects within plain object (serialises for transport)', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const data = { timestamp: date };
    const result = deconstruct(data);
    expect(result).toBeDefined();
    // to.serialise converts objects to JSON string - Date becomes ISO string
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsed.timestamp).toBe('2024-01-15T12:00:00.000Z');
  });
});
