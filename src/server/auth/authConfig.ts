import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';
import type { NexusUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';

export interface JwtAuthConfig {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: unknown): Promise<NexusUser | undefined>;
  onGetUser(userId: string): Promise<NexusUser | undefined>;
  syncUserToClient: boolean;
  /**
   * Invoked once per connection inside the per-connection auth scope — after the
   * client is set, but BEFORE the auth store is queried (both the socket and REST
   * auth paths). Lets a consumer (e.g. database-per-tenant routing) resolve
   * per-connection context before authentication runs. Optional; a no-op when omitted.
   */
  onResolveConnection?(socket: Socket): Promise<void>;
  /**
   * REST counterpart of `onResolveConnection`. Invoked once per REST request, inside the
   * same per-request scope as REST authentication, BEFORE the auth store is queried —
   * including for public actions, since those may still query the auth store directly
   * inside their own handlers. Optional; a no-op when omitted.
   */
  onResolveRestConnection?(req: IncomingMessage): Promise<void>;
}

export interface WebAuthnAuthConfig {
  mode: 'webauthn';
  store: WebAuthnAuthStore;
  /**
   * The relying parties a passkey ceremony may use (sc-627): a fixed list, or chosen per ceremony from its origin. For
   * example, a web page's passkeys belong to its own host (tenants created at runtime), a native app's to its parent domain.
   */
  rpIds: string[] | ((origin: string) => string[]);
  /**
   * Whether a page or app at `origin` may register or sign in with a passkey (sc-627): `https://<host>` for a web page,
   * `android:apk-key-hash:<hash>` for an Android app. Match exact values or patterns, never substrings.
   */
  isAllowedOrigin(origin: string): boolean;
  /**
   * The secret sign-in challenges are signed with (sc-627). Every server of an app must share it, so a challenge issued by
   * one verifies on another. Use it for nothing else. Required in production; without it a random one is used, which only
   * this process knows.
   */
  challengeSecret?: string;
  onGetInviteDetails(userId: string, accountId?: string): Promise<InviteDetails>;
  onGetUser(userId: string): Promise<NexusUser | undefined>;
  syncUserToClient: boolean;
  /**
   * Invoked once per connection inside the per-connection auth scope — after the
   * client is set, but BEFORE the auth store is queried (both the socket and REST
   * auth paths). Lets a consumer (e.g. database-per-tenant routing) resolve
   * per-connection context before authentication runs. Optional; a no-op when omitted.
   */
  onResolveConnection?(socket: Socket): Promise<void>;
  /**
   * REST counterpart of `onResolveConnection`. Invoked once per REST request, inside the
   * same per-request scope as REST authentication, BEFORE the auth store is queried —
   * including for public actions, since those may still query the auth store directly
   * inside their own handlers. Optional; a no-op when omitted.
   */
  onResolveRestConnection?(req: IncomingMessage): Promise<void>;
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
