import { describe, expect, it } from 'vitest';
import { isAuthKey } from './isAuthKey';

// Auth keys arrive as parsed JSON; in a MongoDB filter an object is an operator, so only a non-empty string is a key.

describe('isAuthKey', () => {
  it('accepts a non-empty string', () => {
    expect(isAuthKey('session-token')).toBe(true);
  });

  it.each([{ $ne: null }, { $gt: '' }, ['k'], 1, true, null, undefined, ''])('refuses %j', value => {
    expect(isAuthKey(value)).toBe(false);
  });
});
