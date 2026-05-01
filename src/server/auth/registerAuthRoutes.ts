import type { SocketAPIServerAction } from '../actions/createServerActionHandler';
import type { AuthConfig } from './authConfig';
import { createSigninAction } from '../actions/signinAction';
import { createSignoutAction } from '../actions/signoutAction';
import { createWebauthnInviteAction } from '../actions/webauthnInviteAction';
import { createWebauthnRegisterAction } from '../actions/webauthnRegisterAction';
import { createWebauthnReauthAction } from '../actions/webauthnReauthAction';

/** Creates auth action handlers and returns them as `SocketAPIServerAction[]`.
 *  Pass the returned array to `registerRestActions` via `startServer`. */
export function registerAuthRoutes(config: AuthConfig): SocketAPIServerAction[] {
  const actions: SocketAPIServerAction[] = [];
  if (config.mode === 'jwt') {
    actions.push(createSigninAction(config.store, config.onAuthenticate));
  }
  if (config.mode === 'webauthn') {
    actions.push(createWebauthnInviteAction(config.store, config.onGetUserDetails));
    actions.push(createWebauthnRegisterAction(config.store));
    actions.push(createWebauthnReauthAction(config.store));
  }
  actions.push(createSignoutAction(config.store));
  return actions;
}
