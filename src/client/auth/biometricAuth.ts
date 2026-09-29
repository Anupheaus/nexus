// Biometrics unlock this device's stored PRF output (its local database key) while the session is valid. They never
// sign in on their own: only a passkey's signature does (sc-627).
//
// The PRF output is the key to the local encrypted database, so it is kept in OS secure storage (sc-644): on Android,
// encrypted (AES-GCM) with a key generated in the Android Keystore, which never leaves it; on iOS, in the Keychain,
// this device only and never synced to iCloud. Earlier versions kept it in `@capacitor/preferences` — plain
// SharedPreferences / UserDefaults, readable from a device backup or dump — so an entry found there is moved across on
// first read and deleted.

const STORAGE_KEY_PREFIX = 'nexus:biometric:';

interface StoredCredential {
  userId: string;
  keyBase64: string;
}

export function isCapacitorNative(): boolean {
  return (window as any).Capacitor?.isNativePlatform() === true;
}

async function loadBiometricPlugin() {
  try {
    return await import('@aparajita/capacitor-biometric-auth');
  } catch {
    if (isCapacitorNative()) {
      throw new Error(
        '@aparajita/capacitor-biometric-auth is required on Capacitor native platforms but is not installed. ' +
        'Add it as a dependency: pnpm add @aparajita/capacitor-biometric-auth',
      );
    }
    return null;
  }
}

async function loadSecureStoragePlugin() {
  try {
    return await import('@aparajita/capacitor-secure-storage');
  } catch {
    if (isCapacitorNative()) {
      throw new Error(
        '@aparajita/capacitor-secure-storage is required on Capacitor native platforms but is not installed. ' +
        'Add it as a dependency: pnpm add @aparajita/capacitor-secure-storage',
      );
    }
    return null;
  }
}

/** Where earlier versions kept the credential in plain text — read only to move it across (sc-644). */
async function loadLegacyPreferencesPlugin() {
  try {
    return await import('@capacitor/preferences');
  } catch {
    return null;
  }
}

const isStoredCredential = (value: unknown): value is StoredCredential =>
  value != null && typeof value === 'object'
  && typeof (value as StoredCredential).userId === 'string' && typeof (value as StoredCredential).keyBase64 === 'string';

/** Secure storage, per operation: this device only — never synced to iCloud Keychain. */
const THIS_DEVICE_ONLY = { convertDate: false, sync: false } as const;

async function storeCredential(name: string, credential: StoredCredential): Promise<void> {
  const secure = await loadSecureStoragePlugin();
  if (secure == null) return;
  await secure.SecureStorage.set(
    `${STORAGE_KEY_PREFIX}${name}`, { ...credential }, THIS_DEVICE_ONLY.convertDate, THIS_DEVICE_ONLY.sync,
    secure.KeychainAccess.whenUnlockedThisDeviceOnly,
  );
}

/** Deletes the plain-text entry an earlier version kept in preferences, without reading it — best effort. */
async function removeLegacyCopy(name: string): Promise<void> {
  const prefs = await loadLegacyPreferencesPlugin();
  if (prefs == null) return;
  try {
    await prefs.Preferences.remove({ key: `${STORAGE_KEY_PREFIX}${name}` });
  } catch {
    // Best effort: tried again on the next read
  }
}

/** Names whose plain-text copy has been swept this process (see {@link getStoredCredential}). */
const legacyCopySwept = new Set<string>();

/**
 * A credential an earlier version left in `@capacitor/preferences`: moved into secure storage, then deleted from
 * preferences — also when it cannot be read, so no plain-text copy is left behind. Only if secure storage refuses it is
 * the old entry kept (the key is not lost; the next read tries again).
 */
async function migrateLegacyCredential(name: string): Promise<StoredCredential | undefined> {
  const prefs = await loadLegacyPreferencesPlugin();
  if (prefs == null) return undefined;
  const key = `${STORAGE_KEY_PREFIX}${name}`;
  let value: string | null = null;
  try {
    ({ value } = await prefs.Preferences.get({ key }));
  } catch {
    return undefined;
  }
  if (value == null) return undefined;
  let credential: StoredCredential | undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isStoredCredential(parsed)) credential = parsed;
  } catch {
    credential = undefined;
  }
  if (credential != null) {
    try {
      await storeCredential(name, credential);
    } catch {
      // Secure storage could not take it: keep the old entry rather than lose the key; the next read tries again
      return credential;
    }
  }
  await removeLegacyCopy(name);
  return credential;
}

async function getStoredCredential(name: string): Promise<StoredCredential | undefined> {
  const secure = await loadSecureStoragePlugin();
  if (secure == null) return undefined;
  try {
    const stored = await secure.SecureStorage.get(`${STORAGE_KEY_PREFIX}${name}`, THIS_DEVICE_ONLY.convertDate, THIS_DEVICE_ONLY.sync);
    if (isStoredCredential(stored)) {
      // The secure copy is what counts; a plain-text copy may still be there (a crash between the move and the delete,
      // or a delete that failed), so delete it — blind, never read — once per process
      if (!legacyCopySwept.has(name)) {
        legacyCopySwept.add(name);
        await removeLegacyCopy(name);
      }
      return stored;
    }
  } catch {
    // Unreadable (e.g. the Keystore key was invalidated): treated as none — the next passkey sign-in stores it again
  }
  return migrateLegacyCredential(name);
}

export async function hasBiometricCredential(name: string): Promise<boolean> {
  if (!isCapacitorNative()) return false;
  const credential = await getStoredCredential(name);
  return credential != null;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/** Delivers a derived PRF key to the app (opens the encrypted local DB) — see `AuthContext.onPrf`. */
type OnPrf = (userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>;

/** Inputs for {@link performBiometricUnlock}. */
export interface BiometricUnlockOptions {
  name: string;
  /** The user the socket is already signed in as. */
  userId: string;
  /** The account the socket is already signed in to, passed through to `onPrf`. */
  accountId?: string;
  onPrf: OnPrf | undefined;
}

/**
 * Unlocks the stored PRF key with biometrics WITHOUT a server re-auth — for when the socket is already
 * signed in (from a stored session) and only the local encryption key is missing. A server re-auth
 * would rotate the session token and strand that signed-in socket on a token no longer in the store,
 * so anything that resolves the session (e.g. the licence check) fails.
 *
 * Returns false — before prompting — when the stored key belongs to a different user, so the caller
 * can fall back to a full {@link performBiometricReauth}.
 */
export async function performBiometricUnlock({ name, userId, accountId, onPrf }: BiometricUnlockOptions): Promise<boolean> {
  const biometric = await loadBiometricPlugin();
  if (biometric == null) throw new Error('Biometric auth not available');

  const credential = await getStoredCredential(name);
  if (credential == null) throw new Error('no credentials');
  if (credential.userId !== userId) return false;

  await biometric.BiometricAuth.authenticate({ reason: 'Sign in to continue' });

  if (onPrf) await onPrf(userId, base64ToArrayBuffer(credential.keyBase64), accountId);
  return true;
}

/**
 * Caches the passkey's PRF output for biometric unlock — always the one from the passkey just used, which is what the
 * local database is keyed with now. Left alone only when exactly that is stored already; replaced otherwise: another
 * user, or the same user with a new passkey (every device re-registers one), whose PRF output differs.
 */
export async function storeBiometricKey(name: string, userId: string, keyBytes: ArrayBuffer): Promise<void> {
  if (!isCapacitorNative()) return;
  const keyBase64 = arrayBufferToBase64(keyBytes);
  const existing = await getStoredCredential(name);
  if (existing?.userId === userId && existing.keyBase64 === keyBase64) return;
  await storeCredential(name, { userId, keyBase64 });
}

/**
 * Forgets the cached key — on sign-out, and when the server disables this device — from secure storage and from any
 * plain-text copy an earlier version left. Best effort: never throws.
 */
export async function clearBiometricKey(name: string): Promise<void> {
  if (!isCapacitorNative()) return;
  try {
    const secure = await loadSecureStoragePlugin();
    await secure?.SecureStorage.remove(`${STORAGE_KEY_PREFIX}${name}`, THIS_DEVICE_ONLY.sync);
  } catch {
    // Nothing stored, or storage unavailable
  }
  await removeLegacyCopy(name);
}
