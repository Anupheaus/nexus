import { defineEvent } from './defineEvent';

export interface SocketAPIUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export interface SocketAPIUserChangedEventPayload {
  user?: unknown;
}

export interface SocketAPIAccountChangedEventPayload {
  account?: unknown;
}

export const socketAPIUserAuthenticated = defineEvent<SocketAPIUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
export const socketAPIUserChanged = defineEvent<SocketAPIUserChangedEventPayload>('socketAPIUserChanged');
export const socketAPIAccountChanged = defineEvent<SocketAPIAccountChangedEventPayload>('socketAPIAccountChanged');
export const socketAPIDeviceDisabled = defineEvent<void>('socketAPIDeviceDisabled');
