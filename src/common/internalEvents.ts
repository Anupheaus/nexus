import { defineEvent } from './defineEvent';

export interface SocketAPIUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export const socketAPIUserAuthenticated = defineEvent<SocketAPIUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
