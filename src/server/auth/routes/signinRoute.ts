import crypto from 'crypto';
import type { JwtAuthStore } from '../../../common/auth';
import type { SocketAPIUser } from '../../../common';
import { signInAction } from '../../../common/internalActions';
import { createServerActionHandler } from '../../actions/createServerActionHandler';
import type { SocketAPIServerAction } from '../../actions/createServerActionHandler';
import { setResponseHeader } from '../../async-context/socketApiContext';

const COOKIE_NAME = 'socketapi_session';

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export async function handleSignIn(
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<SocketAPIUser | undefined>,
  req: Record<string, unknown>,
): Promise<void> {
  const { deviceId, deviceDetails, ...credentials } = req;

  const user = await onAuthenticate(credentials);
  if (!user) throw new Error('Authentication failed');

  const sessionToken = generateSessionToken();
  const existing = await store.findByDevice(user.id, String(deviceId ?? ''));

  if (existing) {
    await store.update(existing.requestId, {
      sessionToken,
      isEnabled: true,
      deviceDetails: deviceDetails as any,
      lastConnectedAt: Date.now(),
    });
  } else {
    await store.create({
      requestId: crypto.randomUUID(),
      sessionToken,
      userId: user.id,
      deviceId: String(deviceId ?? ''),
      isEnabled: true,
      deviceDetails: deviceDetails as any,
      lastConnectedAt: Date.now(),
    });
  }

  setResponseHeader('Set-Cookie', buildSetCookieHeader(sessionToken));
}

export function createSigninAction(
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<SocketAPIUser | undefined>,
): SocketAPIServerAction {
  return createServerActionHandler(signInAction, req => handleSignIn(store, onAuthenticate, req), { isPublic: true });
}
