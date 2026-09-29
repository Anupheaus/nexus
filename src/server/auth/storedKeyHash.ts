import { createHash } from 'crypto';

/** Marks a key hash the store holds as a digest, so it is never mistaken for a value a client sends (sc-613). */
const STORED_KEY_HASH_PREFIX = 'sha256:';

/**
 * nexus's digest of a device's key hash, as stores held it between sc-613 and sc-627. Key hashes no longer sign anyone in
 * (sc-627: a passkey's verified signature does); this stays exported so a store can migrate records written before
 * sc-613 with exactly this formula.
 */
export function toStoredKeyHash(clientKeyHash: string): string {
  return `${STORED_KEY_HASH_PREFIX}${createHash('sha256').update(clientKeyHash).digest('hex')}`;
}
