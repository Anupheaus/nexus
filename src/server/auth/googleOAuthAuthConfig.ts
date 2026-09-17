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
}
