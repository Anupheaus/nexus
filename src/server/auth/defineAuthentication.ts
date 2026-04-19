import type { SocketAPIUser } from '../../common';
import type { JwtAuthStore } from '../../common/auth';
import type { AuthConfig, JwtAuthConfig } from './authConfig';
import { useAuthentication } from '../providers/authentication/useAuthentication';
import type { MakePromise } from '@anupheaus/common';

export interface JwtConfigureOptions<U extends SocketAPIUser, C> {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: C): Promise<U | undefined>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface ServerUseAuthResult<U extends SocketAPIUser> {
  readonly user: U | undefined;
  setUser(user: U | undefined): Promise<void>;
  signOut(): Promise<void>;
  impersonateUser<T>(user: U, handler: () => T): MakePromise<T>;
}

export function defineAuthentication<U extends SocketAPIUser, C = void>() {
  function configureAuthentication(options: JwtConfigureOptions<U, C>): AuthConfig {
    const config: JwtAuthConfig = {
      mode: 'jwt',
      store: options.store,
      onAuthenticate: options.onAuthenticate as (credentials: unknown) => Promise<SocketAPIUser | undefined>,
      onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
      syncUserToClient: options.syncUserToClient ?? true,
    };
    return config;
  }

  function useAuth(): ServerUseAuthResult<U> {
    return useAuthentication<U>();
  }

  return {
    configureAuthentication,
    useAuthentication: useAuth,
  };
}
