import type { SocketAPIAuthRecord, SocketAPIAuthStore } from './authTypes';

export interface GoogleOAuthAuthRecord extends SocketAPIAuthRecord {
  googleId: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiresAt: number; // unix ms
  grantedScopes: string[];
}

export interface GoogleOAuthAuthStore extends SocketAPIAuthStore<GoogleOAuthAuthRecord> {
  findByGoogleId(googleId: string): Promise<GoogleOAuthAuthRecord | undefined>;
}

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}
