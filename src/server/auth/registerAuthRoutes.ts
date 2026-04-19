import Router from 'koa-router';
import type { AuthConfig } from './authConfig';
import { createSigninRoute } from './routes/signinRoute';
import { createSignoutRoute } from './routes/signoutRoute';

export function registerAuthRoutes(router: Router, name: string, config: AuthConfig): void {
  if (config.mode === 'jwt') {
    createSigninRoute(router, name, config.store, config.onAuthenticate);
  }
  // WebAuthn routes registered in a separate plan
  createSignoutRoute(router, name, config.store);
}
