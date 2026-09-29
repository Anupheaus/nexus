import crypto from 'crypto';
import { isAuthKey, type WebAuthnAuthStore } from '../../common/auth';
import { webauthnChallengeAction, webauthnReauthAction } from '../../common/internalActions';
import type { WebAuthnReauthRequest, WebAuthnAuthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import { verifyPasskeySignIn, type PasskeyVerificationConfig } from '../auth/passkeyVerification';
import type { ChallengeSigner } from '../auth/webauthnChallenge';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };
const REAUTH_FAILED = 'WebAuthn re-authentication failed';

/** A fresh sign-in challenge (sc-627). */
export function handleWebAuthnChallenge(signer: ChallengeSigner, now: number = Date.now()): { challenge: string } {
  return { challenge: signer.issue(now) };
}

/**
 * Signs a device in by its passkey (sc-627). The passkey must have signed a challenge this app's servers issued, fresher
 * than the last one the device answered, with the public key stored when it registered. Nothing a client merely knows
 * (such as a key hash) signs anyone in.
 */
export async function handleWebAuthnReauth(
  store: WebAuthnAuthStore,
  verification: PasskeyVerificationConfig,
  signer: ChallengeSigner,
  req: WebAuthnReauthRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
  now: number = Date.now(),
): Promise<WebAuthnAuthResponse> {
  // A credential id that is not a string (e.g. { "$ne": null }, an operator to a MongoDB store) finds nothing (sc-620).
  const credentialId = (req?.credential as { id?: unknown } | undefined)?.id;
  if (!isAuthKey(credentialId)) throw new Error(REAUTH_FAILED);
  const record = await store.findByCredentialId(credentialId);
  if (!record?.isEnabled) throw new Error(REAUTH_FAILED);

  const verified = await verifyPasskeySignIn(verification, signer, req.credential, record, now);
  if (verified == null) throw new Error(REAUTH_FAILED);

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.update(record.requestId, {
    sessionToken,
    lastConnectedAt: now,
    deviceDetails: req.deviceDetails,
    credentialCounter: verified.credentialCounter,
    lastChallengeIssuedAt: verified.challengeIssuedAt,
  });

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  return { userId: record.userId, accountId: record.accountId };
}

export function createWebauthnChallengeAction(signer: ChallengeSigner): NexusServerAction {
  return createServerActionHandler(webauthnChallengeAction, async () => handleWebAuthnChallenge(signer), { isPublic: true });
}

export function createWebauthnReauthAction(store: WebAuthnAuthStore, verification: PasskeyVerificationConfig, signer: ChallengeSigner): NexusServerAction {
  return createServerActionHandler(
    webauthnReauthAction,
    async (req, { setCookie }) => handleWebAuthnReauth(store, verification, signer, req, setCookie),
    { isPublic: true },
  );
}
