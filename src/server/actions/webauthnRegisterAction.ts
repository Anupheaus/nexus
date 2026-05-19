import crypto from 'crypto';
import type { WebAuthnAuthStore } from '../../common/auth';
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
  const record = await store.findByRegistrationToken(req.registrationToken);
  if (!record) throw new Error('Invalid registration token');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.update(record.requestId, {
    keyHash: req.keyHash,
    deviceDetails: req.deviceDetails,
    sessionToken,
    isEnabled: true,
    registrationToken: undefined,
  });

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
