import { collectDeviceDetails } from './collectDeviceDetails';
import { getInstallationId } from './installationId';
import { fromBase64Url, getPrfResult, getRpId, toAssertionJson } from './webauthnUtils';
import { storeBiometricKey } from './biometricAuth';
import type { webauthnChallengeAction, webauthnReauthAction } from '../../common/internalActions';
import type { GetUseActionType } from '../hooks/useAction';

export type ReauthCaller = GetUseActionType<typeof webauthnReauthAction>;
export type ChallengeCaller = GetUseActionType<typeof webauthnChallengeAction>;

export async function performWebAuthnReauth(
  callChallenge: ChallengeCaller,
  callReauth: ReauthCaller,
  reconnect: () => void | Promise<void>,
  onPrf: ((userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>) | undefined,
  name?: string,
  rpId?: string,
): Promise<void> {
  // The passkey signs a challenge the server issued, which the server checks (sc-627).
  const { challenge: issuedChallenge } = await callChallenge();
  const challenge = fromBase64Url(issuedChallenge);

  // Some platforms (Android WebView with no registered credentials) never resolve or
  // reject navigator.credentials.get(). Race against a 30 s timeout so callers can
  // show fallback UI regardless of whether the platform honours AbortSignal.
  const timeoutMs = 30_000;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('no credentials')), timeoutMs);
  });

  let credential: PublicKeyCredential | null;
  try {
    credential = await Promise.race([
      navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: getRpId(rpId),
          userVerification: 'required',
          extensions: {
            prf: { eval: { first: new TextEncoder().encode('nexus-auth') } },
          } as AuthenticationExtensionsClientInputs,
        },
      }) as Promise<PublicKeyCredential | null>,
      timeoutPromise,
    ]);
  } catch (err) {
    // NotAllowedError (cancelled by user/platform) or our timeout — treat as "no credentials"
    // so DeviceAuthGate shows the unregistered path rather than a generic error.
    const domName = err instanceof Error ? (err as DOMException).name : '';
    if (domName === 'NotAllowedError' || (err instanceof Error && err.message === 'no credentials')) {
      throw new Error('no credentials');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId!);
  }

  if (!credential) throw new Error('Passkey authentication cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const deviceDetails = collectDeviceDetails();

  // The signed challenge signs this device in; the PRF output stays here and only derives the local database key.
  // The installation id tells this installation apart from others signing in with the same synced passkey (sc-645).
  const { userId, accountId } = await callReauth({ credential: toAssertionJson(credential), deviceDetails, installationId: getInstallationId() });

  // Opportunistically cache the PRF key biometrically on Capacitor native so subsequent
  // sign-ins can use the faster biometric flow instead of a full WebAuthn ceremony.
  if (name != null) await storeBiometricKey(name, userId, prfResult).catch(() => { /* non-fatal */ });

  // Reconnect (authenticating the socket with the reauth session) BEFORE onPrf. onPrf applies the
  // encryption key, which mounts the MXDB sync engine and kicks off its first sync dispatch. If that
  // runs on the still-unauthenticated socket it 401s, stops the dispatcher and triggers a spurious
  // sign-out/reconnect — leaving the client wedged on "Authenticating, please wait...". Authenticating
  // first — and awaiting it, since reconnect only schedules the new socket — guarantees the only
  // socket sync can start on is the authenticated one.
  await reconnect();
  if (onPrf) await onPrf(userId, prfResult, accountId);
}
