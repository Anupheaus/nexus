import type Router from 'koa-router';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../../common/auth';

const COOKIE_NAME = 'socketapi_session';
const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

export function createSignoutRoute(
  router: Router,
  name: string,
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
): void {
  router.post(`/${name}/socketAPI/signout`, async ctx => {
    const sessionToken = parseCookie(ctx.get('Cookie'));
    if (sessionToken) {
      const record = await store.findBySessionToken(sessionToken);
      if (record) await store.update(record.requestId, { isEnabled: false });
    }
    ctx.set('Set-Cookie', CLEAR_COOKIE);
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}
