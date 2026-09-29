import crypto from 'crypto';
import { isPendingWebAuthnInvite, type WebAuthnAuthRecord, type WebAuthnAuthStore } from '../../common/auth';
import { webauthnRegisterAction } from '../../common/internalActions';
import type { WebAuthnRegisterRequest, WebAuthnAuthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'nexus_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

export async function handleWebAuthnRegister(
  store: WebAuthnAuthStore,
  req: WebAuthnRegisterRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<WebAuthnAuthResponse> {
  const found = await store.findByRegistrationToken(req.registrationToken);
  // Only a pending invite registers: never a device that has registered (and been signed out or disabled since).
  if (found == null || !isPendingWebAuthnInvite(found)) throw new Error('Invalid registration token');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const patch: Partial<WebAuthnAuthRecord> = {
    keyHash: req.keyHash,
    deviceDetails: req.deviceDetails,
    sessionToken,
    isEnabled: true,
    registrationToken: undefined,
  };
  let record = found;
  if (store.claimRegistration != null) {
    // Atomic: of two registrations racing on one token, only one claims it.
    const claimed = await store.claimRegistration(req.registrationToken, patch);
    if (claimed == null) throw new Error('Invalid registration token');
    record = claimed;
  } else {
    await store.update(found.requestId, patch);
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  return { userId: record.userId, accountId: record.accountId };
}

export function createWebauthnRegisterAction(store: WebAuthnAuthStore): NexusServerAction {
  return createServerActionHandler(
    webauthnRegisterAction,
    async (req, { setCookie }) => handleWebAuthnRegister(store, req, setCookie),
    { isPublic: true },
  );
}
