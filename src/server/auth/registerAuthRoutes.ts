import type { AuthConfig } from './authConfig';
import { createSigninAction } from '../actions/signinAction';
import { createSignoutAction } from '../actions/signoutAction';
import { createWebauthnInviteAction } from './routes/webauthnInviteRoute';
import { createWebauthnRegisterAction } from './routes/webauthnRegisterRoute';
import { createWebauthnReauthAction } from './routes/webauthnReauthRoute';

/** Registers all auth action handlers into the global REST action registry.
 *  Must be called before registerRestActions sets up the Koa routes. */
export function registerAuthRoutes(config: AuthConfig): void {
  if (config.mode === 'jwt') {
    createSigninAction(config.store, config.onAuthenticate);
  }
  if (config.mode === 'webauthn') {
    createWebauthnInviteAction(config.store, config.onGetUserDetails);
    createWebauthnRegisterAction(config.store);
    createWebauthnReauthAction(config.store);
  }
  createSignoutAction(config.store);
}
