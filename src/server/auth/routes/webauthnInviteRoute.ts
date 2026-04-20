import crypto from 'crypto';
import type Router from 'koa-router';
import type { WebAuthnAuthStore } from '../../../common/auth';

export function createWebauthnInviteRoute(
  router: Router,
  name: string,
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<{ name: string; displayName?: string }>,
): void {
  router.get(`/${name}/socketAPI/webauthn/invite`, async ctx => {
    const requestId = ctx.query['requestId'] as string | undefined;
    if (!requestId) { ctx.status = 400; return; }

    const record = await store.findById(requestId);
    if (!record) { ctx.status = 404; return; }
    if (record.isEnabled) { ctx.status = 400; return; }

    const registrationToken = crypto.randomUUID();
    await store.update(record.requestId, { registrationToken });

    const userDetails = await onGetUserDetails(record.userId);

    ctx.status = 200;
    ctx.body = { registrationToken, userDetails };
  });
}
