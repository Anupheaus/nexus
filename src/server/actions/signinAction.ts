import crypto from 'crypto';
import type { JwtAuthStore } from '../../common/auth';
import type { SocketAPIUser } from '../../common';
import { signInAction } from '../../common/internalActions';
import type { SignInRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

export async function handleSignIn(
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<SocketAPIUser | undefined>,
  req: SignInRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<void> {
  const { credentials, deviceDetails } = req;

  const user = await onAuthenticate(credentials);
  if (!user) throw new Error('Authentication failed');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.create({
    requestId: crypto.randomUUID(),
    sessionToken,
    userId: user.id,
    deviceId: crypto.randomUUID(),
    isEnabled: true,
    deviceDetails,
    lastConnectedAt: Date.now(),
  });

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
}

export function createSigninAction(
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<SocketAPIUser | undefined>,
): SocketAPIServerAction {
  return createServerActionHandler(
    signInAction,
    async (req, { setCookie }) => handleSignIn(store, onAuthenticate, req, setCookie),
    { isPublic: true },
  );
}
