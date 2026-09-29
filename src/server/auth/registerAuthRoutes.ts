import type { NexusServerAction } from '../actions/createServerActionHandler';
import type { AuthConfig } from './authConfig';
import { createSigninAction } from '../actions/signinAction';
import { createSignoutAction } from '../actions/signoutAction';
import { createWebauthnInviteAction } from '../actions/webauthnInviteAction';
import { createWebauthnRegisterAction } from '../actions/webauthnRegisterAction';
import { createWebauthnChallengeAction, createWebauthnReauthAction } from '../actions/webauthnReauthAction';
import { createGoogleConfigAction } from '../actions/googleConfigAction';
import { createGoogleStartAction } from '../actions/googleStartAction';
import { createGoogleCallbackAction } from '../actions/googleCallbackAction';
import { createGoogleOneTapAction } from '../actions/googleOneTapAction';
import { createGoogleScopesAction } from '../actions/googleScopesAction';
import { createChallengeSigner } from './webauthnChallenge';

/** Creates auth action handlers and returns them as `NexusServerAction[]`.
 *  Pass the returned array to `registerRestActions` via `startServer`. */
export function registerAuthRoutes(config: AuthConfig): NexusServerAction[] {
  const actions: NexusServerAction[] = [];
  if (config.mode === 'jwt') {
    actions.push(createSigninAction(config.store, config.onAuthenticate));
  }
  if (config.mode === 'webauthn') {
    actions.push(createWebauthnInviteAction(config.store, config.onGetInviteDetails));
    // Passkeys are verified (sc-627): registration against the invite's token, sign-in against a signed challenge.
    const verification = { rpIds: config.rpIds, isAllowedOrigin: config.isAllowedOrigin };
    const signer = createChallengeSigner(config.challengeSecret);
    actions.push(createWebauthnRegisterAction(config.store, verification));
    actions.push(createWebauthnChallengeAction(signer));
    actions.push(createWebauthnReauthAction(config.store, verification, signer));
  }
  if (config.mode === 'google-oauth') {
    actions.push(createGoogleConfigAction(config.clientId));
    actions.push(createGoogleStartAction(config));
    actions.push(createGoogleCallbackAction(config));
    actions.push(createGoogleOneTapAction(config));
    actions.push(createGoogleScopesAction(config));
  }
  actions.push(createSignoutAction(config.store));
  return actions;
}
