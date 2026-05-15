import type { SocketAPIUser } from '../../common';
import type { GoogleOAuthAuthStore, GoogleProfile } from '../../common/auth';

export interface GoogleOAuthAuthConfig {
  mode: 'google-oauth';
  clientId: string;
  clientSecret: string;
  /** Registered in Google Cloud Console. e.g. `https://myapp.com/api/socketAPI/google/callback` */
  redirectUri: string;
  baseScopes: string[];
  store: GoogleOAuthAuthStore;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  onCreateUser(profile: GoogleProfile): Promise<SocketAPIUser>;
  /** Registered as a redirect URI in Google Cloud Console. Required for Capacitor support. */
  capacitorCallbackUrl?: string;
  syncUserToClient: boolean;
}
