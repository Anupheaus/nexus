import crypto from 'crypto';
import type { WebAuthnAuthStore } from '../../common/auth';
import { webauthnReauthAction } from '../../common/internalActions';
import type { WebAuthnReauthRequest, WebAuthnRegisterOrReauthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

export async function handleWebAuthnReauth(
  store: WebAuthnAuthStore,
  req: WebAuthnReauthRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<WebAuthnRegisterOrReauthResponse> {
  const record = await store.findByKeyHash(req.keyHash);
  if (!record?.isEnabled) throw new Error('WebAuthn re-authentication failed');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.update(record.requestId, {
    sessionToken,
    lastConnectedAt: Date.now(),
    deviceDetails: req.deviceDetails,
  });

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  return { userId: record.userId, accountId: record.userId };
}

export function createWebauthnReauthAction(store: WebAuthnAuthStore): SocketAPIServerAction {
  return createServerActionHandler(
    webauthnReauthAction,
    async (req, { setCookie }) => handleWebAuthnReauth(store, req, setCookie),
    { isPublic: true },
  );
}
