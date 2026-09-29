import { createHash } from 'crypto';
import type { WebAuthnAuthRecord, WebAuthnAuthStore } from '../../common/auth';

/** Marks a key hash the store holds as a digest, so it is never mistaken for a value a client sends (sc-613). */
const STORED_KEY_HASH_PREFIX = 'sha256:';

/**
 * What the store holds for a device's key hash: a digest of the value the client sends, never the value itself.
 *
 * The client derives its key hash from the passkey's PRF output and sends it to register and to sign in, and the server
 * signs in whichever device holds it: it is a bearer credential. Holding only a digest means a copy of the store (a
 * database read, a backup, a log of a record) cannot be replayed to sign in: signing in hashes what the client sends.
 */
export function toStoredKeyHash(clientKeyHash: string): string {
  return `${STORED_KEY_HASH_PREFIX}${createHash('sha256').update(clientKeyHash).digest('hex')}`;
}

/**
 * The device a client's key hash signs in, or `undefined`. A device registered before key hashes were stored as digests
 * holds the raw value; it is found by that once and upgraded to the digest in place, so it keeps signing in.
 *
 * The raw lookup only ever matches a raw (unprefixed) value, so sending a digest read from the store matches nothing:
 * it is hashed for the first lookup, and a prefixed value is never looked up raw.
 */
export async function findDeviceByKeyHash(store: WebAuthnAuthStore, clientKeyHash: string): Promise<WebAuthnAuthRecord | undefined> {
  const storedKeyHash = toStoredKeyHash(clientKeyHash);
  const device = await store.findByKeyHash(storedKeyHash);
  if (device != null) return device;
  if (clientKeyHash.startsWith(STORED_KEY_HASH_PREFIX)) return undefined;
  const legacyDevice = await store.findByKeyHash(clientKeyHash);
  if (legacyDevice == null) return undefined;
  await store.update(legacyDevice.requestId, { keyHash: storedKeyHash });
  return { ...legacyDevice, keyHash: storedKeyHash };
}
