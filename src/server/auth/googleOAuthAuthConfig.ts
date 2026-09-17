import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';
import type { NexusUser } from '../../common';
import type { GoogleOAuthAuthStore, GoogleProfile } from '../../common/auth';

export interface GoogleOAuthAuthConfig {
  mode: 'google-oauth';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseScopes: string[];
  store: GoogleOAuthAuthStore;
  onGetUser(userId: string): Promise<NexusUser | undefined>;
  onCreateUser(profile: GoogleProfile): Promise<NexusUser>;
  // Capacitor's in-app browser cannot intercept the standard redirectUri response, so a distinct deep-link scheme is needed.
  capacitorCallbackUrl?: string;
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
