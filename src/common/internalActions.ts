import { AnyObject } from '@anupheaus/common';
import type { SocketAPIDeviceDetails } from './auth';
import { defineAction } from './defineAction';

export interface InviteDetails {
  id: string;
  appName: string;
  userName: string;
}

export interface SignInRequest<Credentials extends AnyObject = AnyObject> {
  credentials: Credentials;
  deviceDetails: SocketAPIDeviceDetails;
}

export interface WebAuthnInviteRequest {
  requestId: string;
}

export interface WebAuthnInviteResponse {
  registrationToken: string;
  inviteDetails: InviteDetails;
}

export interface WebAuthnRegisterRequest extends WebAuthnReauthRequest {
  registrationToken: string;
}

export interface WebAuthnRegisterOrReauthResponse {
  userId: string;
  accountId: string;
}

export interface WebAuthnReauthRequest {
  keyHash: string;
  deviceDetails: SocketAPIDeviceDetails;
}

export const socketAPIAuthenticateTokenAction = defineAction<string, boolean>()('socketAPIAuthenticateTokenAction');

// Cookie-setting endpoints must always go via REST — Set-Cookie response headers cannot
// be replicated via socket acks. Each action below carries rest: { ... } to force REST.

export const signInAction = defineAction<SignInRequest, void>()('signIn', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/signin' },
});
export const signOutAction = defineAction<void, void>()('signOut', {
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/signout' },
});

export const webauthnInviteAction = defineAction<WebAuthnInviteRequest, WebAuthnInviteResponse>()('webauthnInvite', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'GET', url: '/{name}/socketAPI/webauthn/invite' },
});
export const webauthnRegisterAction = defineAction<WebAuthnRegisterRequest, WebAuthnRegisterOrReauthResponse>()('webauthnRegister', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/register' },
});

export const webauthnReauthAction = defineAction<WebAuthnReauthRequest, WebAuthnRegisterOrReauthResponse>()('webauthnReauth', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/reauth' },
});
