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
}
