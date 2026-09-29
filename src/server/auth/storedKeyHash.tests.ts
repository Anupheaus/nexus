import { describe, expect, it } from 'vitest';
import { toStoredKeyHash } from './storedKeyHash';

// A device's key hash signs it in, so the store must never hold one a client could send back (sc-613): it holds a digest,
// and a device registered before that holds the raw value until it next signs in.

const CLIENT_KEY_HASH = 'a'.repeat(64);

describe('toStoredKeyHash', () => {
  it('stores a prefixed SHA-256 digest, never the value the client sends', () => {
    const stored = toStoredKeyHash(CLIENT_KEY_HASH);
    expect({ isDigest: /^sha256:[0-9a-f]{64}$/.test(stored), holdsTheValue: stored.includes(CLIENT_KEY_HASH) }).toEqual({ isDigest: true, holdsTheValue: false });
  });

  it('gives the same digest for the same value, and a different one for another', () => {
    expect([toStoredKeyHash('k1') === toStoredKeyHash('k1'), toStoredKeyHash('k1') === toStoredKeyHash('k2')]).toEqual([true, false]);
  });
});

describe('the public export', () => {
  it('is what the server barrel exports, so stores migrate with exactly this formula', async () => {
    const server = await import('../index');
    expect(server.toStoredKeyHash).toBe(toStoredKeyHash);
  });
});
