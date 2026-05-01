import crypto from 'crypto';
import type { WebAuthnAuthStore, SocketAPIDeviceDetails } from '../../../common/auth';
import { webauthnReauthAction } from '../../../common/internalActions';
import { createServerActionHandler } from '../../actions/createServerActionHandler';
import type { SocketAPIServerAction } from '../../actions/createServerActionHandler';
import { setResponseHeader } from '../../async-context/socketApiContext';

const COOKIE_NAME = 'socketapi_session';

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export async function handleWebAuthnReauth(
  store: WebAuthnAuthStore,
  req: { keyHash: string; deviceDetails?: SocketAPIDeviceDetails },
): Promise<{ userId: string }> {
  const record = await store.findByKeyHash(req.keyHash);
  if (!record?.isEnabled) throw new Error('WebAuthn re-authentication failed');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.update(record.requestId, {
    sessionToken,
    lastConnectedAt: Date.now(),
    deviceDetails: req.deviceDetails,
  });

  setResponseHeader('Set-Cookie', buildSetCookieHeader(sessionToken));
  return { userId: record.userId };
}

export function createWebauthnReauthAction(
  store: WebAuthnAuthStore,
): SocketAPIServerAction {
  return createServerActionHandler(
    webauthnReauthAction,
    req => handleWebAuthnReauth(store, req),
    { isPublic: true },
  );
}
