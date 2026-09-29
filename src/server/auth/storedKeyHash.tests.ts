import { describe, expect, it, vi } from 'vitest';
import type { WebAuthnAuthRecord, WebAuthnAuthStore } from '../../common/auth';
import { findDeviceByKeyHash, toStoredKeyHash } from './storedKeyHash';

// A device's key hash signs it in, so the store must never hold one a client could send back (sc-613): it holds a digest,
// and a device registered before that holds the raw value until it next signs in.

const CLIENT_KEY_HASH = 'a'.repeat(64);

/** A store that finds a record by exactly the key hash it holds, recording every lookup. */
function storeHolding(records: Partial<WebAuthnAuthRecord>[]) {
  const held = records.map(record => ({ requestId: 'r1', userId: 'u1', sessionToken: 's', deviceId: 'd', isEnabled: true, ...record }) as WebAuthnAuthRecord);
  const store = {
    findByKeyHash: vi.fn(async (keyHash: string) => held.find(record => record.keyHash === keyHash)),
    update: vi.fn(async (requestId: string, patch: Partial<WebAuthnAuthRecord>) => {
      const record = held.find(candidate => candidate.requestId === requestId);
      if (record != null) Object.assign(record, patch);
    }),
  } as unknown as WebAuthnAuthStore;
  return { store, held };
}

describe('toStoredKeyHash', () => {
  it('stores a prefixed SHA-256 digest, never the value the client sends', () => {
    const stored = toStoredKeyHash(CLIENT_KEY_HASH);
    expect({ isDigest: /^sha256:[0-9a-f]{64}$/.test(stored), holdsTheValue: stored.includes(CLIENT_KEY_HASH) }).toEqual({ isDigest: true, holdsTheValue: false });
  });

  it('gives the same digest for the same value, and a different one for another', () => {
    expect([toStoredKeyHash('k1') === toStoredKeyHash('k1'), toStoredKeyHash('k1') === toStoredKeyHash('k2')]).toEqual([true, false]);
  });
});

describe('findDeviceByKeyHash', () => {
  it('finds a device by the digest of the value the client sends', async () => {
    const { store } = storeHolding([{ keyHash: toStoredKeyHash(CLIENT_KEY_HASH) }]);
    expect((await findDeviceByKeyHash(store, CLIENT_KEY_HASH))?.requestId).toBe('r1');
  });

  it('cannot be signed in to with a digest read from the store, sent raw or unprefixed', async () => {
    const stored = toStoredKeyHash(CLIENT_KEY_HASH);
    const { store } = storeHolding([{ keyHash: stored }]);

    expect([await findDeviceByKeyHash(store, stored), await findDeviceByKeyHash(store, stored.slice('sha256:'.length))]).toEqual([undefined, undefined]);
  });

  it('finds a device registered before digests by its raw value once, and upgrades it to the digest', async () => {
    const { store, held } = storeHolding([{ keyHash: CLIENT_KEY_HASH }]);

    const found = await findDeviceByKeyHash(store, CLIENT_KEY_HASH);

    expect({ found: found?.keyHash, stored: held[0]!.keyHash }).toEqual({ found: toStoredKeyHash(CLIENT_KEY_HASH), stored: toStoredKeyHash(CLIENT_KEY_HASH) });
  });

  it('finds nothing, and writes nothing, for a key hash no device holds', async () => {
    const { store } = storeHolding([{ keyHash: toStoredKeyHash('someone-else') }]);

    expect(await findDeviceByKeyHash(store, CLIENT_KEY_HASH)).toBeUndefined();
    expect(store.update).not.toHaveBeenCalled();
  });
});

describe('the public export', () => {
  it('is what the server barrel exports, so stores migrate with exactly this formula', async () => {
    const server = await import('../index');
    expect(server.toStoredKeyHash).toBe(toStoredKeyHash);
  });
});
