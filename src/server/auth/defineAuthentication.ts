import type { SocketAPIAccount, SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
import { useAuthentication } from '../providers/authentication/useAuthentication';
import type { MakePromise } from '@anupheaus/common';

export interface JwtConfigureOptions<U extends SocketAPIUser, C> {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: C): Promise<U | undefined>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface WebAuthnConfigureOptions<U extends SocketAPIUser> {
  mode: 'webauthn';
  store: WebAuthnAuthStore;
  /** Return the invite details for a given (userId, accountId) pair — RP domain, app name, user name, account name, and user handle. */
  onGetInviteDetails(userId: string, accountId?: string): Promise<InviteDetails>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface CreateInviteOptions {
  userId: string;
  baseUrl: string;
  accountId?: string;
}

export interface ServerUseAuthResult<U extends SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount> {
  readonly user: U | undefined;
  readonly account: A | undefined;
  setUser(user: U | undefined): Promise<void>;
  setAccount(account: A | undefined): Promise<void>;
  signOut(): Promise<void>;
  impersonateUser<T>(user: U, handler: () => T): MakePromise<T>;
  createInvite(options: CreateInviteOptions): Promise<string>;
}

export function defineAuthentication<U extends SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount, C = void>() {
  function configureAuthentication(options: JwtConfigureOptions<U, C> | WebAuthnConfigureOptions<U>): AuthConfig {
    if (options.mode === 'webauthn') {
      const config: WebAuthnAuthConfig = {
        mode: 'webauthn',
        store: options.store,
        onGetInviteDetails: (userId, accountId) => options.onGetInviteDetails(userId, accountId),
        onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
        syncUserToClient: options.syncUserToClient ?? true,
      };
      return config;
    }
    const config: JwtAuthConfig = {
      mode: 'jwt',
      store: (options as JwtConfigureOptions<U, C>).store,
      onAuthenticate: (options as JwtConfigureOptions<U, C>).onAuthenticate as (credentials: unknown) => Promise<SocketAPIUser | undefined>,
      onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
      syncUserToClient: options.syncUserToClient ?? true,
    };
    return config;
  }

  function useAuth(): ServerUseAuthResult<U, A> {
    return useAuthentication<U, A>();
  }

  return {
    configureAuthentication,
    useAuthentication: useAuth,
  };
}
