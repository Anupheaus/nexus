import { computeKeyHash } from './webauthnUtils';
import { collectDeviceDetails } from './collectDeviceDetails';
import type { webauthnReauthAction, biometricSetupAction } from '../../common/internalActions';
import type { GetUseActionType } from '../hooks/useAction';

export type BiometricReauthCaller = GetUseActionType<typeof webauthnReauthAction>;
export type BiometricSetupCaller = GetUseActionType<typeof biometricSetupAction>;

const STORAGE_KEY_PREFIX = 'socketapi:biometric:';

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

export async function performBiometricReauth(
  callReauth: BiometricReauthCaller,
  reconnect: () => void,
  name: string,
): Promise<void> {
  const biometric = await loadBiometricPlugin();
  if (biometric == null) throw new Error('Biometric auth not available');

  const credential = await getStoredCredential(name);
  if (credential == null) throw new Error('no credentials');

  await biometric.BiometricAuth.authenticate({ reason: 'Sign in to continue' });

  const keyBytes = base64ToArrayBuffer(credential.keyBase64);
  const keyHash = await computeKeyHash(keyBytes);
  const deviceDetails = collectDeviceDetails();

  await callReauth({ keyHash, deviceDetails });
  reconnect();
}

export async function storeBiometricKey(name: string, userId: string, keyBytes: ArrayBuffer): Promise<void> {
  if (!isCapacitorNative()) return;
  const existing = await getStoredCredential(name);
  if (existing != null) return;
  const keyBase64 = arrayBufferToBase64(keyBytes);
  await storeCredential(name, { userId, keyBase64 });
}

interface SetupOptions {
  callSetup: BiometricSetupCaller;
  name: string;
  userId: string;
}

export async function performBiometricSetup({ callSetup, name, userId }: SetupOptions): Promise<void> {
  if (!isCapacitorNative()) return;

  const biometric = await loadBiometricPlugin();
  if (biometric == null) return;

  // Check if biometrics are available and enrolled on this device.
  try {
    const result = await biometric.BiometricAuth.checkBiometry();
    if (!result.isAvailable) return;
  } catch {
    return;
  }

  // Don't overwrite an existing credential.
  const existing = await getStoredCredential(name);
  if (existing != null) return;

  // Prompt the user once to authorise storing the credential.
  await biometric.BiometricAuth.authenticate({ reason: 'Enable biometric sign-in' });

  const keyBytes = crypto.getRandomValues(new Uint8Array(32)).buffer;
  const keyHash = await computeKeyHash(keyBytes);
  const deviceDetails = collectDeviceDetails();

  await callSetup({ keyHash, deviceDetails });
  await storeCredential(name, { userId, keyBase64: arrayBufferToBase64(keyBytes) });
}
