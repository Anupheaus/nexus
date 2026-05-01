import type { SocketAPIDeviceDetails } from './auth';
import { defineAction } from './defineAction';

export interface InviteDetails {
  id: string;
  appName: string;
  userName: string;
}

export const socketAPIAuthenticateTokenAction = defineAction<string, boolean>()('socketAPIAuthenticateTokenAction');

export const webauthnInviteAction = defineAction<
  { requestId: string },
  { registrationToken: string; inviteDetails: InviteDetails }
>()('webauthnInvite', { isPublic: true, rest: { method: 'GET', url: '/{name}/socketAPI/webauthn/invite' } });

export const webauthnRegisterAction = defineAction<
  { registrationToken: string; keyHash: string; deviceDetails: SocketAPIDeviceDetails },
  { userId: string }
>()('webauthnRegister', { isPublic: true, rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/register' } });

// Cookie-clearing must go via REST — Set-Cookie response headers cannot be replicated via socket acks.
export const signOutAction = defineAction<void, void>()('signOut', { rest: { method: 'POST', url: '/{name}/socketAPI/signout' } });
