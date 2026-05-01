import type { SocketAPIDeviceDetails } from './auth';
import { defineAction } from './defineAction';

export interface InviteDetails {
  id: string;
  appName: string;
  userName: string;
}

export const socketAPIAuthenticateTokenAction = defineAction<string, boolean>()('socketAPIAuthenticateTokenAction');

// Cookie-setting endpoints must always go via REST — Set-Cookie response headers cannot
// be replicated via socket acks. Each action below carries rest: { ... } to force REST.

export const signInAction = defineAction<Record<string, unknown>, void>()(
  'signIn', { isPublic: true, rest: { method: 'POST', url: '/{name}/socketAPI/signin' } },
);

export const signOutAction = defineAction<void, void>()(
  'signOut', { rest: { method: 'POST', url: '/{name}/socketAPI/signout' } },
);

export const webauthnInviteAction = defineAction<
  { requestId: string },
  { registrationToken: string; inviteDetails: InviteDetails }
>()('webauthnInvite', { isPublic: true, rest: { method: 'GET', url: '/{name}/socketAPI/webauthn/invite' } });

export const webauthnRegisterAction = defineAction<
  { registrationToken: string; keyHash: string; deviceDetails: SocketAPIDeviceDetails },
  { userId: string }
>()('webauthnRegister', { isPublic: true, rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/register' } });

export const webauthnReauthAction = defineAction<
  { keyHash: string; deviceDetails: SocketAPIDeviceDetails },
  { userId: string }
>()('webauthnReauth', { isPublic: true, rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/reauth' } });
