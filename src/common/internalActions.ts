import type { NexusDeviceDetails, WebAuthnAssertionCredentialJson, WebAuthnRegistrationCredentialJson } from './auth';
import { defineAction } from './defineAction';

export interface InviteDetails {
  /** WebAuthn relying party domain — must be a registrable domain suffix of the page origin (e.g. 'vision.lintex.com'). */
  domain: string;
  /** App display name shown to the user during the passkey ceremony. */
  appName: string;
  /** User's display name shown during the passkey ceremony. */
  userName: string;
  /** The account this invite is scoped to, when passkeys are per-account. Absent for user-level passkeys. */
  accountId?: string;
  /** Optional account name — shown alongside userName so the user knows which account this passkey is for. */
  accountName?: string;
  /**
   * Unique opaque handle for this (user, account) pair — used as `user.id` in the WebAuthn credential.
   * Ensures a separate passkey is created per (user, account) combination; the authenticator will not
   * replace an existing credential unless the RP ID and user handle both match.
   */
  userHandle: string;
}

export interface SignInRequest {
  credentials: unknown;
  deviceDetails: NexusDeviceDetails;
}

export interface WebAuthnRegisterRequest {
  registrationToken: string;
  /** The new passkey; the server verifies it and stores its public key (sc-627). */
  credential: WebAuthnRegistrationCredentialJson;
  deviceDetails: NexusDeviceDetails;
  /** This app installation's id, kept by the client for as long as it is installed (sc-645). */
  installationId: string;
}

export interface WebAuthnReauthRequest {
  /** The passkey's answer to a challenge from `webauthnChallengeAction`, verified against its stored public key (sc-627). */
  credential: WebAuthnAssertionCredentialJson;
  deviceDetails: NexusDeviceDetails;
  /**
   * This app installation's id (sc-645). A synced passkey signing in on an installation it has not signed in on before
   * registers that installation as a new device, rather than taking over the device it was registered on.
   */
  installationId: string;
}

export interface WebAuthnAuthResponse {
  userId: string;
  accountId?: string;
}

export const socketAPIAuthenticateTokenAction = defineAction<string, boolean>()('socketAPIAuthenticateTokenAction');

// Cookie-setting endpoints must always go via REST — Set-Cookie response headers cannot
// be replicated via socket acks. Each action below carries transport: ['rest'] to enforce this;
// without it, resolveTransport would pick socket when connected and setCookie would throw.

export const signInAction = defineAction<SignInRequest, void>()(
  'signIn', { isPublic: true, transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/signin' } },
);

export const signOutAction = defineAction<void, void>()(
  'signOut', { transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/signout' } },
);

export const webauthnInviteAction = defineAction<
  { requestId: string },
  { registrationToken: string; inviteDetails: InviteDetails }
>()('webauthnInvite', { isPublic: true, rest: { method: 'GET', url: '/{name}/socketAPI/webauthn/invite' } });

export const webauthnRegisterAction = defineAction<WebAuthnRegisterRequest, WebAuthnAuthResponse>()(
  'webauthnRegister', { isPublic: true, transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/register' } },
);

/** A fresh, signed challenge for a passkey sign-in (sc-627), valid for two minutes. */
export const webauthnChallengeAction = defineAction<void, { challenge: string }>()(
  'webauthnChallenge', { isPublic: true, transport: ['rest'], rest: { method: 'GET', url: '/{name}/socketAPI/webauthn/challenge' } },
);

export const webauthnReauthAction = defineAction<WebAuthnReauthRequest, WebAuthnAuthResponse>()(
  'webauthnReauth', { isPublic: true, transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/reauth' } },
);

export interface GoogleStartRequest {
  postAuthUrl: string;
  platform?: string;
  popup?: boolean;
  scopes?: string;       // comma-separated extra scopes
  redirectMode?: boolean;
}

export interface GoogleCallbackRequest {
  code?: string;
  state: string;
  error?: string;
}

export interface GoogleOneTapRequest {
  credential: string;   // Google ID token from GIS SDK
}

export interface GoogleScopesRequest {
  scopes: string[];
}

export interface GoogleScopesResponse {
  alreadyGranted: boolean;
  missingScopes?: string[];
}

export const googleOAuthConfigAction = defineAction<void, { clientId: string }>()(
  'googleOAuthConfig',
  { isPublic: true, transport: ['rest'], rest: { method: 'GET', url: '/{name}/socketAPI/google/config' } },
);

export const googleStartAction = defineAction<GoogleStartRequest, { authUrl: string }>()(
  'googleStart',
  { isPublic: true, transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/google/start' } },
);

export const googleCallbackAction = defineAction<GoogleCallbackRequest, unknown>()(
  'googleCallback',
  { isPublic: true, transport: ['rest'], rest: { method: 'GET', url: '/{name}/socketAPI/google/callback' } },
);

export const googleOneTapAction = defineAction<GoogleOneTapRequest, void>()(
  'googleOneTap',
  { isPublic: true, transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/google/onetap' } },
);

export const googleScopesAction = defineAction<GoogleScopesRequest, GoogleScopesResponse>()(
  'googleScopes',
  { transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/google/scopes' } },
);
