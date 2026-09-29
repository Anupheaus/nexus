import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { isAuthKey, type WebAuthnAuthRecord } from '../../common/auth';
import type { ChallengeSigner } from './webauthnChallenge';

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

/** Receives why a ceremony was refused, for the server's log (never the client's). */
export type PasskeyVerificationErrorHandler = (error: unknown) => void;

const rpIdsFor = (config: PasskeyVerificationConfig, origin: string) => (typeof config.rpIds === 'function' ? config.rpIds(origin) : config.rpIds);

/** What to store for a newly registered passkey. */
export type VerifiedPasskey = Required<Pick<WebAuthnAuthRecord, 'credentialId' | 'credentialPublicKey' | 'credentialCounter'>>;

const isString = (value: unknown): value is string => typeof value === 'string';

/** The origin a ceremony ran at, read from its client data, if the credential is well formed and the origin is allowed. */
function allowedOriginOf(config: PasskeyVerificationConfig, credential: unknown, fields: string[]): string | undefined {
  const candidate = credential as { id?: unknown; rawId?: unknown; type?: unknown; response?: Record<string, unknown> } | null;
  if (candidate == null || typeof candidate !== 'object' || !isAuthKey(candidate.id) || !isString(candidate.rawId) || candidate.type !== 'public-key') return undefined;
  const response = candidate.response;
  if (response == null || typeof response !== 'object' || !fields.every(field => isAuthKey(response[field]))) return undefined;
  try {
    const { origin } = JSON.parse(Buffer.from(response.clientDataJSON as string, 'base64url').toString('utf8')) as { origin?: unknown };
    return isString(origin) && config.isAllowedOrigin(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
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
  const origin = allowedOriginOf(config, credential, ['clientDataJSON', 'attestationObject']);
  if (origin == null) return undefined;
  const rpIds = rpIdsFor(config, origin);
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
    if (!verified || registrationInfo == null) return undefined;
    const { id, publicKey, counter } = registrationInfo.credential;
    return { credentialId: id, credentialPublicKey: Buffer.from(publicKey).toString('base64url'), credentialCounter: counter };
  } catch (error) {
    onError?.(error);
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
  const origin = allowedOriginOf(config, credential, ['clientDataJSON', 'authenticatorData', 'signature']);
  if (origin == null || !isAuthKey(stored.credentialId) || !isAuthKey(stored.credentialPublicKey)) return undefined;
  const rpIds = rpIdsFor(config, origin);
  if (rpIds.length === 0) return undefined;
  if ((credential as { id: string }).id !== stored.credentialId) return undefined;
  let challengeIssuedAt: number | undefined;
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: credential as AuthenticationResponseJSON,
      expectedChallenge: challenge => {
        const issuedAt = signer.verify(challenge, now)?.issuedAt;
        if (issuedAt == null || issuedAt <= (stored.lastChallengeIssuedAt ?? 0)) return false;
        challengeIssuedAt = issuedAt;
        return true;
      },
      expectedOrigin: origin,
      expectedRPID: rpIds,
      credential: { id: stored.credentialId, publicKey: new Uint8Array(Buffer.from(stored.credentialPublicKey, 'base64url')), counter: stored.credentialCounter ?? 0 },
      requireUserVerification: true,
    });
    if (!verified || challengeIssuedAt == null) return undefined;
    return { credentialCounter: authenticationInfo.newCounter, challengeIssuedAt };
  } catch (error) {
    onError?.(error);
    return undefined;
  }
}
