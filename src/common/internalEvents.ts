import { defineEvent } from './defineEvent';

export interface SocketAPIUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export interface SocketAPIUserChangedEventPayload {
  user?: unknown;
}

export const socketAPIUserAuthenticated = defineEvent<SocketAPIUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
export const socketAPIUserChanged = defineEvent<SocketAPIUserChangedEventPayload>('socketAPIUserChanged');
export const socketAPIDeviceDisabled = defineEvent<void>('socketAPIDeviceDisabled');
