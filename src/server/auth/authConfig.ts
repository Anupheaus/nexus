import type { SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';

export interface JwtAuthConfig {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: unknown): Promise<SocketAPIUser | undefined>;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  syncUserToClient: boolean;
}

export interface WebAuthnAuthConfig {
  mode: 'webauthn';
  store: WebAuthnAuthStore;
  onGetInviteDetails(userId: string, accountId?: string): Promise<InviteDetails>;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  syncUserToClient: boolean;
}

export type AuthConfig = JwtAuthConfig | WebAuthnAuthConfig | GoogleOAuthAuthConfig;

let _config: AuthConfig | undefined;

export function setAuthConfig(config: AuthConfig): void {
  _config = config;
}

export function getAuthConfig(): AuthConfig | undefined {
  return _config;
}

export function clearAuthConfig(): void {
  _config = undefined;
}
