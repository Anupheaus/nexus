/**
 * Whether a value can be used as a key in an auth-store lookup: a non-empty string, and nothing else. Exported from
 * `@anupheaus/nexus/common` so stores (e.g. mxdb's) apply the same rule on their side.
 *
 * Auth keys (invite ids, registration and session tokens, key hashes) arrive in REST bodies and socket handshakes, which
 * carry parsed JSON, so a key can be an object. A store backed by MongoDB puts the key into a filter, where an object
 * such as `{ "$ne": null }` is an operator: a re-authentication with `{ "keyHash": { "$ne": null } }` would find the first
 * registered device and sign the caller in as it (Vision sc-620). Every handler checks its keys with this before any
 * lookup, whatever the store.
 */
export function isAuthKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
