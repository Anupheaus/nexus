import { defineEvent } from './defineEvent';

export interface NexusUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export interface NexusUserChangedEventPayload {
  user?: unknown;
}

export interface NexusAccountChangedEventPayload {
  account?: unknown;
}

export const socketAPIUserAuthenticated = defineEvent<NexusUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
export const socketAPIUserChanged = defineEvent<NexusUserChangedEventPayload>('socketAPIUserChanged');
export const socketAPIAccountChanged = defineEvent<NexusAccountChangedEventPayload>('socketAPIAccountChanged');
export const socketAPIDeviceDisabled = defineEvent<void>('socketAPIDeviceDisabled');
