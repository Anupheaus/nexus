import { AuthenticationError } from '@anupheaus/common';
import crypto from 'crypto';
import { isAuthKey, isPendingWebAuthnInvite, type WebAuthnAuthRecord, type WebAuthnAuthStore } from '../../common/auth';
import { webauthnRegisterAction } from '../../common/internalActions';
import type { WebAuthnRegisterRequest, WebAuthnAuthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import { verifyPasskeyRegistration, type PasskeyVerificationConfig } from '../auth/passkeyVerification';
import { logAuthFailure, logAuthSuccess } from '../auth/authEventLog';
import type { AuthFailureReason } from '../auth/authEventModels';
import { createVerificationFailureCollector } from '../auth/verificationFailureCollector';
import { isInstallationId } from '../auth/passkeyInstallations';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

const INVALID_TOKEN = 'Invalid registration token';

interface RegistrationRefusal {
  reason: AuthFailureReason;
  /** What the client is told. */
  message: string;
  userId?: string;
}

/** Logs the failed registration (one `[Auth]` warn with its reason) and refuses it with the client-facing message (a 401). */
function refuseRegistration({ reason, message, userId }: RegistrationRefusal): never {
  logAuthFailure({ event: 'sign-in', method: 'invite', reason, userId });
  throw new AuthenticationError(message);
}

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
  if (!isAuthKey(req?.registrationToken)) refuseRegistration({ reason: 'invalid-request', message: INVALID_TOKEN });
  // The installation registering is this device (sc-645): the passkey signing in anywhere else is another device.
  if (!isInstallationId(req.installationId)) refuseRegistration({ reason: 'invalid-request', message: 'Invalid installation id' });
  const found = await store.findByRegistrationToken(req.registrationToken);
  if (found == null) refuseRegistration({ reason: 'invite-not-found', message: INVALID_TOKEN });
  const { userId } = found;
  // Only a pending invite registers: never a device that has registered (and been signed out or disabled since).
  if (!isPendingWebAuthnInvite(found)) refuseRegistration({ reason: 'invite-used', message: INVALID_TOKEN, userId });

  const failure = createVerificationFailureCollector();
  const passkey = await verifyPasskeyRegistration(verification, req.credential, req.registrationToken, failure.onError);
  if (passkey == null) refuseRegistration({ reason: failure.reasonOr('bad-signature'), message: 'Passkey could not be verified', userId });
  // One passkey, one device.
  if (await store.findByCredentialId(passkey.credentialId) != null) refuseRegistration({ reason: 'passkey-already-registered', message: 'Passkey already registered', userId });

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const patch: Partial<WebAuthnAuthRecord> = {
    ...passkey,
    deviceDetails: req.deviceDetails,
    installationId: req.installationId,
    sessionToken,
    isEnabled: true,
    registrationToken: undefined,
  };
  let record = found;
  if (store.claimRegistration != null) {
    // Atomic: of two registrations racing on one token, only one claims it.
    const claimed = await store.claimRegistration(req.registrationToken, patch);
    if (claimed == null) refuseRegistration({ reason: 'invite-used', message: INVALID_TOKEN, userId });
    record = claimed;
  } else {
    await store.update(found.requestId, patch);
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  // Registering redeems the invite, stores the passkey and signs the device in: one entry for all three.
  logAuthSuccess({ event: 'sign-in', method: 'invite', userId: record.userId, detail: { isPasskeyRegistered: true, isInviteRedeemed: true } });
  return { userId: record.userId, accountId: record.accountId };
}

export function createWebauthnRegisterAction(store: WebAuthnAuthStore, verification: PasskeyVerificationConfig): NexusServerAction {
  return createServerActionHandler(
    webauthnRegisterAction,
    async (req, { setCookie }) => handleWebAuthnRegister(store, verification, req, setCookie),
    { isPublic: true },
  );
}
