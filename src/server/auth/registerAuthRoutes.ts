import Router from 'koa-router';
import type { AuthConfig } from './authConfig';
import { createSigninRoute } from './routes/signinRoute';
import { createSignoutRoute } from './routes/signoutRoute';
import { createWebauthnInviteRoute } from './routes/webauthnInviteRoute';
import { createWebauthnRegisterRoute } from './routes/webauthnRegisterRoute';
import { createWebauthnReauthRoute } from './routes/webauthnReauthRoute';

export function registerAuthRoutes(router: Router, name: string, config: AuthConfig): void {
  if (config.mode === 'jwt') {
    createSigninRoute(router, name, config.store, config.onAuthenticate);
  }
  if (config.mode === 'webauthn') {
    createWebauthnInviteRoute(router, name, config.store, config.onGetUserDetails);
    createWebauthnRegisterRoute(router, name, config.store);
    createWebauthnReauthRoute(router, name, config.store);
  }
  createSignoutRoute(router, name, config.store);
}
