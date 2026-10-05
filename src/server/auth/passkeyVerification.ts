import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { isAuthKey, type WebAuthnAuthRecord } from '../../common/auth';
import type { ChallengeSigner } from './webauthnChallenge';
import type { AuthFailureReason } from './authEventModels';

/** What a passkey ceremony must match (sc-627). */
export interface PasskeyVerificationConfig {
  /**
   * The relying parties a ceremony at `origin` may use (a domain each): a fixed list, or chosen per origin. For example, a
   * web page's passkeys belong to its own host, while a native app's belong to the parent domain it is configured with.
   */
  rpIds: string[] | ((origin: string) => string[]);
  /**
   * Whether a page (or app) at `origin` may register or sign in: `https://<host>` for a web page, and
   * `android:apk-key-hash:<hash>` for an Android app. Match exact allowed values or patterns, never substrings.
   */
  isAllowedOrigin(origin: string): boolean;
}

/**
 * Receives why a ceremony was refused, for the server's log (never the client's): the error and a reason code. Log the
 * code, not the error's text, which can quote the challenge (sc-378).
 */
export type PasskeyVerificationErrorHandler = (error: unknown, reason: AuthFailureReason) => void;

/** The library reports a counter that went backwards in words only. */
const COUNTER_ERROR_PATTERN = /counter/i;

/** The relying parties for a ceremony at `origin`; an app's function that throws gives none (the ceremony is refused). */
function rpIdsFor(config: PasskeyVerificationConfig, origin: string, onError: PasskeyVerificationErrorHandler | undefined): string[] {
  try {
    const rpIds = typeof config.rpIds === 'function' ? config.rpIds(origin) : config.rpIds;
    if (!Array.isArray(rpIds) || rpIds.length === 0) onError?.(new Error('No relying party is configured for this origin'), 'no-relying-party');
    return Array.isArray(rpIds) ? rpIds : [];
  } catch (error) {
    onError?.(error, 'no-relying-party');
    return [];
  }
}

/** What to store for a newly registered passkey. */
export type VerifiedPasskey = Required<Pick<WebAuthnAuthRecord, 'credentialId' | 'credentialPublicKey' | 'credentialCounter'>>;

const isString = (value: unknown): value is string => typeof value === 'string';

/** The origin a ceremony ran at, read from its client data, if the credential is well formed and the origin is allowed. */
function allowedOriginOf(config: PasskeyVerificationConfig, credential: unknown, fields: string[], onError: PasskeyVerificationErrorHandler | undefined): string | undefined {
  const refuse = (message: string, reason: AuthFailureReason = 'malformed-credential') => { onError?.(new Error(message), reason); return undefined; };
  const candidate = credential as { id?: unknown; rawId?: unknown; type?: unknown; response?: Record<string, unknown> } | null;
  if (candidate == null || typeof candidate !== 'object' || !isAuthKey(candidate.id) || !isString(candidate.rawId) || candidate.type !== 'public-key') return refuse('The credential is malformed');
  const response = candidate.response;
  if (response == null || typeof response !== 'object' || !fields.every(field => isAuthKey(response[field]))) return refuse('The credential\'s response is malformed');
  let origin: unknown;
  try {
    ({ origin } = JSON.parse(Buffer.from(response.clientDataJSON as string, 'base64url').toString('utf8')) as { origin?: unknown });
  } catch {
    return refuse('The credential\'s client data is malformed');
  }
  if (!isString(origin)) return refuse('The credential names no origin');
  let isAllowed = false;
  try { isAllowed = config.isAllowedOrigin(origin); } catch (error) { onError?.(error, 'origin-not-allowed'); return undefined; }
  return isAllowed ? origin : refuse('The ceremony ran at an origin that is not allowed', 'origin-not-allowed');
}

/**
 * Verifies a passkey registration (sc-627): it answers `registrationToken` (the challenge the invite handed out), ran at
 * an allowed origin, belongs to an allowed relying party, and verified the user. Resolves what to store, or `undefined`.
 */
export async function verifyPasskeyRegistration(
  config: PasskeyVerificationConfig,
  credential: unknown,
  registrationToken: string,
  onError?: PasskeyVerificationErrorHandler,
): Promise<VerifiedPasskey | undefined> {
  const origin = allowedOriginOf(config, credential, ['clientDataJSON', 'attestationObject'], onError);
  if (origin == null) return undefined;
  const rpIds = rpIdsFor(config, origin, onError);
  if (rpIds.length === 0) return undefined;
  const expectedChallenge = Buffer.from(registrationToken, 'utf8').toString('base64url');
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: credential as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpIds,
      requireUserVerification: true,
    });
    if (!verified || registrationInfo == null) {
      onError?.(new Error('The registration was not verified'), 'bad-signature');
      return undefined;
    }
    const { id, publicKey, counter } = registrationInfo.credential;
    return { credentialId: id, credentialPublicKey: Buffer.from(publicKey).toString('base64url'), credentialCounter: counter };
  } catch (error) {
    // The registration token is the challenge, so a wrong one is a refused challenge rather than a bad signature.
    onError?.(error, error instanceof Error && /challenge/i.test(error.message) ? 'challenge-rejected' : 'bad-signature');
    return undefined;
  }
}

/**
 * Verifies a passkey sign-in (sc-627): it signs a challenge `signer` issued and that is still in date, issued AFTER the
 * one this device last answered (so no captured sign-in can be replayed, even from authenticators whose counter stays 0),
 * with the stored public key, at an allowed origin, for an allowed relying party, with the user verified, and without
 * the counter going backwards. Resolves what to store, or `undefined`.
 */
export async function verifyPasskeySignIn(
  config: PasskeyVerificationConfig,
  signer: ChallengeSigner,
  credential: unknown,
  stored: Pick<WebAuthnAuthRecord, 'credentialId' | 'credentialPublicKey' | 'credentialCounter' | 'lastChallengeIssuedAt'>,
  now: number,
  onError?: PasskeyVerificationErrorHandler,
): Promise<{ credentialCounter: number; challengeIssuedAt: number } | undefined> {
  const origin = allowedOriginOf(config, credential, ['clientDataJSON', 'authenticatorData', 'signature'], onError);
  if (origin == null) return undefined;
  if (!isAuthKey(stored.credentialId) || !isAuthKey(stored.credentialPublicKey)) {
    onError?.(new Error('The device has no registered passkey'), 'no-registered-passkey');
    return undefined;
  }
  if ((credential as { id: string }).id !== stored.credentialId) {
    onError?.(new Error('The credential is not the device\'s passkey'), 'credential-mismatch');
    return undefined;
  }
  const rpIds = rpIdsFor(config, origin, onError);
  if (rpIds.length === 0) return undefined;
  let challengeIssuedAt: number | undefined;
  let isChallengeRejected = false;
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: credential as AuthenticationResponseJSON,
      expectedChallenge: challenge => {
        const issuedAt = signer.verify(challenge, now)?.issuedAt;
        // Expired, forged, or no fresher than the one this device last answered (a replay).
        if (issuedAt == null || issuedAt <= (stored.lastChallengeIssuedAt ?? 0)) { isChallengeRejected = true; return false; }
        challengeIssuedAt = issuedAt;
        return true;
      },
      expectedOrigin: origin,
      expectedRPID: rpIds,
      credential: { id: stored.credentialId, publicKey: new Uint8Array(Buffer.from(stored.credentialPublicKey, 'base64url')), counter: stored.credentialCounter ?? 0 },
      requireUserVerification: true,
    });
    if (!verified || challengeIssuedAt == null) {
      onError?.(new Error('The sign-in was not verified'), isChallengeRejected ? 'challenge-rejected' : 'bad-signature');
      return undefined;
    }
    return { credentialCounter: authenticationInfo.newCounter, challengeIssuedAt };
  } catch (error) {
    onError?.(error, signInFailureReason(error, isChallengeRejected));
    return undefined;
  }
}

function signInFailureReason(error: unknown, isChallengeRejected: boolean): AuthFailureReason {
  if (isChallengeRejected) return 'challenge-rejected';
  if (error instanceof Error && COUNTER_ERROR_PATTERN.test(error.message)) return 'counter-regression';
  return 'bad-signature';
}
