import crypto from 'crypto';
import type Router from 'koa-router';
import type { WebAuthnAuthStore, SocketAPIDeviceDetails } from '../../../common/auth';

const COOKIE_NAME = 'socketapi_session';

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function createWebauthnRegisterRoute(
  router: Router,
  name: string,
  store: WebAuthnAuthStore,
): void {
  router.post(`/${name}/socketAPI/webauthn/register`, async ctx => {
    const body = ctx.request.body as Record<string, unknown>;
    const { registrationToken, keyHash, deviceDetails } = body;

    if (!registrationToken) { ctx.status = 400; return; }

    const record = await store.findByRegistrationToken(String(registrationToken));
    if (!record) { ctx.status = 404; return; }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    await store.update(record.requestId, {
      keyHash: String(keyHash ?? ''),
      deviceDetails: deviceDetails as SocketAPIDeviceDetails | undefined,
      sessionToken,
      isEnabled: true,
      registrationToken: undefined,
    });

    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true, userId: record.userId };
  });
}
