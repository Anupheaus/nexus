import crypto from 'crypto';
import { isAuthKey, type WebAuthnAuthStore } from '../../common/auth';
import { webauthnChallengeAction, webauthnReauthAction } from '../../common/internalActions';
import type { WebAuthnReauthRequest, WebAuthnAuthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import { verifyPasskeySignIn, type PasskeyVerificationConfig } from '../auth/passkeyVerification';
import type { ChallengeSigner } from '../auth/webauthnChallenge';
import { logAuthFailure, logAuthStep, logAuthSuccess } from '../auth/authEventLog';
import type { AuthFailureReason } from '../auth/authEventModels';
import { createVerificationFailureCollector } from '../auth/verificationFailureCollector';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };
const REAUTH_FAILED = 'WebAuthn re-authentication failed';

/** A fresh sign-in challenge (sc-627). The challenge itself is never logged. */
export function handleWebAuthnChallenge(signer: ChallengeSigner, now: number = Date.now()): { challenge: string } {
  logAuthStep({ event: 'challenge', method: 'passkey', step: 'challenge-issued' });
  return { challenge: signer.issue(now) };
}

/** Logs the failed sign-in (one `[Auth]` warn with its reason) and refuses it with the same words for every reason. */
function refuseReauth(reason: AuthFailureReason, userId?: string): never {
  logAuthFailure({ event: 'sign-in', method: 'passkey', reason, userId });
  throw new Error(REAUTH_FAILED);
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
  if (!isAuthKey(credentialId)) refuseReauth('invalid-request');
  const record = await store.findByCredentialId(credentialId);
  if (record == null) refuseReauth('unknown-credential');
  if (!record.isEnabled) refuseReauth('device-disabled', record.userId);

  // Why a ceremony failed goes to the server's log only; the client learns just that it did.
  const failure = createVerificationFailureCollector();
  const verified = await verifyPasskeySignIn(verification, signer, req.credential, record, now, failure.onError);
  if (verified == null) refuseReauth(failure.reasonOr('bad-signature'), record.userId);

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const patch = { sessionToken, lastConnectedAt: now, deviceDetails: req.deviceDetails, credentialCounter: verified.credentialCounter };
  if (store.recordSignIn != null) {
    // Atomic: the replay check and the write are one step, so of two identical sign-ins only one is recorded.
    // The patch carries the challenge time too, so a store that only writes the patch still advances the replay guard.
    if (!await store.recordSignIn(record.requestId, verified.challengeIssuedAt, { ...patch, lastChallengeIssuedAt: verified.challengeIssuedAt })) {
      refuseReauth('replay', record.userId);
    }
  } else {
    await store.update(record.requestId, { ...patch, lastChallengeIssuedAt: verified.challengeIssuedAt });
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  logAuthSuccess({ event: 'sign-in', method: 'passkey', userId: record.userId });
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
