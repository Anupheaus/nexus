import crypto from 'crypto';
import type Router from 'koa-router';
import type { JwtAuthStore } from '../../../common/auth';
import type { SocketAPIUser } from '../../../common';

const COOKIE_NAME = 'socketapi_session';

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function createSigninRoute(
  router: Router,
  name: string,
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<SocketAPIUser | undefined>,
): void {
  router.post(`/${name}/socketAPI/signin`, async ctx => {
    const body = ctx.request.body as Record<string, unknown>;
    const { deviceId, deviceDetails, ...credentials } = body;

    const user = await onAuthenticate(credentials);
    if (!user) { ctx.status = 401; return; }

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

    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}
