import type { SocketAPIAccount, SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore, GoogleOAuthAuthStore, GoogleProfile } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';
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

export interface GoogleOAuthConfigureOptions<U extends SocketAPIUser> {
  mode: 'google-oauth';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseScopes: string[];
  store: GoogleOAuthAuthStore;
  onGetUser(userId: string): Promise<U | undefined>;
  onCreateUser(profile: GoogleProfile): Promise<U>;
  capacitorCallbackUrl?: string;
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
  setUser(user: U | undefined, sessionToken?: string): Promise<void>;
  setAccount(account: A | undefined): Promise<void>;
  signOut(): Promise<void>;
  impersonateUser<T>(user: U, handler: () => T): MakePromise<T>;
  createInvite(options: CreateInviteOptions): Promise<string>;
  /** Google OAuth mode only. Returns a fresh access token, auto-refreshing if expired. */
  getGoogleToken(): Promise<string>;
}

export function defineAuthentication<U extends SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount, C = void>() {
  function configureAuthentication(options: JwtConfigureOptions<U, C> | WebAuthnConfigureOptions<U> | GoogleOAuthConfigureOptions<U>): AuthConfig {
    if (options.mode === 'google-oauth') {
      const config: GoogleOAuthAuthConfig = {
        mode: 'google-oauth',
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: options.redirectUri,
        baseScopes: options.baseScopes,
        store: options.store,
        onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
        onCreateUser: options.onCreateUser as (profile: GoogleProfile) => Promise<SocketAPIUser>,
        capacitorCallbackUrl: options.capacitorCallbackUrl,
        syncUserToClient: options.syncUserToClient ?? true,
      };
      return config;
    }
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
