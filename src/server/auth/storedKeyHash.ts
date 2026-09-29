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
 * The device a client's key hash signs in, or `undefined`: the store is looked up by the digest only, never by the value
 * the client sent. So a digest read from the store signs nothing in (it is hashed again). Devices registered before
 * digests were migrated by the store (mxdb 0.1.40+, sc-613); a store that has not migrated them no longer signs them in.
 */
export async function findDeviceByKeyHash(store: WebAuthnAuthStore, clientKeyHash: string): Promise<WebAuthnAuthRecord | undefined> {
  return store.findByKeyHash(toStoredKeyHash(clientKeyHash));
}
