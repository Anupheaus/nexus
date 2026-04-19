export * from './SocketAPI';
export * from './hooks';
export { useUser, useSocket as useSocketAPI } from './providers';
export type { SocketAPIUser } from '../common';
export { defineAuthentication } from './auth/defineAuthentication';
export { useAuthentication } from './hooks/useAuthentication';
export type { ClientUseAuthResult } from './hooks/useAuthentication';
