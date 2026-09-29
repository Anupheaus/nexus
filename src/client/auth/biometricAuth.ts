// Biometrics unlock this device's stored PRF output (its local database key) while the session is valid. They never
// sign in on their own: only a passkey's signature does (sc-627).

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

async function loadPreferencesPlugin() {
  try {
    return await import('@capacitor/preferences');
  } catch {
    if (isCapacitorNative()) {
      throw new Error(
        '@capacitor/preferences is required on Capacitor native platforms but is not installed. ' +
        'Add it as a dependency: pnpm add @capacitor/preferences',
      );
    }
    return null;
  }
}

async function getStoredCredential(name: string): Promise<StoredCredential | undefined> {
  const prefs = await loadPreferencesPlugin();
  if (prefs == null) return undefined;
  try {
    const { value } = await prefs.Preferences.get({ key: `${STORAGE_KEY_PREFIX}${name}` });
    if (value == null) return undefined;
    return JSON.parse(value) as StoredCredential;
  } catch {
    return undefined;
  }
}

async function storeCredential(name: string, credential: StoredCredential): Promise<void> {
  const prefs = await loadPreferencesPlugin();
  if (prefs == null) return;
  await prefs.Preferences.set({
    key: `${STORAGE_KEY_PREFIX}${name}`,
    value: JSON.stringify(credential),
  });
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

export async function storeBiometricKey(name: string, userId: string, keyBytes: ArrayBuffer): Promise<void> {
  if (!isCapacitorNative()) return;
  const existing = await getStoredCredential(name);
  if (existing != null) return;
  const keyBase64 = arrayBufferToBase64(keyBytes);
  await storeCredential(name, { userId, keyBase64 });
}
