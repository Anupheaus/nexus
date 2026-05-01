import crypto from 'crypto';
import type { WebAuthnAuthStore, SocketAPIDeviceDetails } from '../../../common/auth';
import { webauthnRegisterAction } from '../../../common/internalActions';
import { createServerActionHandler } from '../../actions/createServerActionHandler';
import type { SocketAPIServerAction } from '../../actions/createServerActionHandler';
import { setResponseHeader } from '../../async-context/socketApiContext';

const COOKIE_NAME = 'socketapi_session';

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export async function handleWebAuthnRegister(
  store: WebAuthnAuthStore,
  req: { registrationToken: string; keyHash: string; deviceDetails: SocketAPIDeviceDetails },
): Promise<{ userId: string }> {
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

  setResponseHeader('Set-Cookie', buildSetCookieHeader(sessionToken));
  return { userId: record.userId };
}

export function createWebauthnRegisterAction(
  store: WebAuthnAuthStore,
): SocketAPIServerAction {
  return createServerActionHandler(
    webauthnRegisterAction,
    req => handleWebAuthnRegister(store, req),
    { isPublic: true },
  );
}
