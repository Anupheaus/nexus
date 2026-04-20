import crypto from 'crypto';
import type Router from 'koa-router';
import type { WebAuthnAuthStore, SocketAPIDeviceDetails } from '../../../common/auth';

const COOKIE_NAME = 'socketapi_session';

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function createWebauthnReauthRoute(
  router: Router,
  name: string,
  store: WebAuthnAuthStore,
): void {
  router.post(`/${name}/socketAPI/webauthn/reauth`, async ctx => {
    const body = ctx.request.body as Record<string, unknown>;
    const { keyHash, deviceDetails } = body;

    if (!keyHash) { ctx.status = 400; return; }

    const record = await store.findByKeyHash(String(keyHash));
    if (!record || !record.isEnabled) { ctx.status = 401; return; }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    await store.update(record.requestId, {
      sessionToken,
      lastConnectedAt: Date.now(),
      deviceDetails: deviceDetails as SocketAPIDeviceDetails | undefined,
    });

    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true, userId: record.userId };
  });
}
