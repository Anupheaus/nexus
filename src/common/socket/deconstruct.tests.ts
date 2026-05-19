import { describe, it, expect } from 'vitest';
import { deconstruct } from './deconstruct';
import { reconstruct } from './reconstruct';

describe('deconstruct', () => {
  it('serialises plain objects to a string for transport', () => {
    const data = { foo: 'bar', count: 42 };
    const result = deconstruct(data);
    expect(typeof result).toBe('string');
    expect(JSON.parse(result as string)).toEqual(data);
  });

  it('returns strings unchanged', () => {
    expect(deconstruct('hello')).toBe('hello');
  });

  it('returns numbers unchanged', () => {
    expect(deconstruct(123)).toBe(123);
  });

  it('returns null unchanged', () => {
    expect(deconstruct(null)).toBeNull();
  });

  it('returns undefined unchanged', () => {
    expect(deconstruct(undefined)).toBeUndefined();
  });

  it('returns booleans unchanged', () => {
    expect(deconstruct(true)).toBe(true);
    expect(deconstruct(false)).toBe(false);
  });

  it('returns arrays unchanged (arrays are not plain objects)', () => {
    const arr = [1, 2, 3];
    expect(deconstruct(arr)).toBe(arr);
  });

  it('serialises nested plain objects', () => {
    const data = { nested: { value: 1 } };
    const result = deconstruct(data);
    expect(typeof result).toBe('string');
    expect(JSON.parse(result as string)).toEqual(data);
  });

  it('serialises Date objects inside plain objects to ISO strings', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const result = deconstruct({ timestamp: date });
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result as string);
    expect(parsed.timestamp).toBe('2024-01-15T12:00:00.000Z');
  });

  it('round-trips through reconstruct back to the original value', () => {
    const original = { name: 'Alice', count: 7 };
    const serialised = deconstruct(original) as Parameters<typeof reconstruct>[0];
    expect(reconstruct(serialised)).toEqual(original);
  });
});
