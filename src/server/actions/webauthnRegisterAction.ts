import { AuthenticationError } from '@anupheaus/common';
import crypto from 'crypto';
import { isAuthKey, isPendingWebAuthnInvite, type WebAuthnAuthRecord, type WebAuthnAuthStore } from '../../common/auth';
import { webauthnRegisterAction } from '../../common/internalActions';
import type { WebAuthnRegisterRequest, WebAuthnAuthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import { verifyPasskeyRegistration, type PasskeyVerificationConfig } from '../auth/passkeyVerification';
import { logVerificationError } from './webauthnReauthAction';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

/**
 * Registers a device's passkey on a pending invite. The registration is verified (sc-627): it answers the invite's
 * registration token, ran at an allowed origin for an allowed relying party, and verified the user. Its credential id and
 * public key are stored, so later sign-ins are checked against them.
 */
export async function handleWebAuthnRegister(
  store: WebAuthnAuthStore,
  verification: PasskeyVerificationConfig,
  req: WebAuthnRegisterRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<WebAuthnAuthResponse> {
  // Keys that are not strings (an object is a query operator to a MongoDB store) register nothing (sc-620).
  if (!isAuthKey(req?.registrationToken)) throw new AuthenticationError('Invalid registration token');
  const found = await store.findByRegistrationToken(req.registrationToken);
  // Only a pending invite registers: never a device that has registered (and been signed out or disabled since).
  if (found == null || !isPendingWebAuthnInvite(found)) throw new AuthenticationError('Invalid registration token');

  const passkey = await verifyPasskeyRegistration(verification, req.credential, req.registrationToken, logVerificationError('registration'));
  if (passkey == null) throw new AuthenticationError('Passkey could not be verified');
  // One passkey, one device.
  if (await store.findByCredentialId(passkey.credentialId) != null) throw new AuthenticationError('Passkey already registered');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const patch: Partial<WebAuthnAuthRecord> = {
    ...passkey,
    deviceDetails: req.deviceDetails,
    sessionToken,
    isEnabled: true,
    registrationToken: undefined,
  };
  let record = found;
  if (store.claimRegistration != null) {
    // Atomic: of two registrations racing on one token, only one claims it.
    const claimed = await store.claimRegistration(req.registrationToken, patch);
    if (claimed == null) throw new AuthenticationError('Invalid registration token');
    record = claimed;
  } else {
    await store.update(found.requestId, patch);
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  return { userId: record.userId, accountId: record.accountId };
}

export function createWebauthnRegisterAction(store: WebAuthnAuthStore, verification: PasskeyVerificationConfig): NexusServerAction {
  return createServerActionHandler(
    webauthnRegisterAction,
    async (req, { setCookie }) => handleWebAuthnRegister(store, verification, req, setCookie),
    { isPublic: true },
  );
}
