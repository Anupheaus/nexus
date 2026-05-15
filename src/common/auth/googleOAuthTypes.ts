import type { SocketAPIAuthRecord, SocketAPIAuthStore } from './authTypes';

export interface GoogleOAuthAuthRecord extends SocketAPIAuthRecord {
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiresAt: number; // unix ms
  grantedScopes: string[];
}

export interface GoogleOAuthAuthStore extends SocketAPIAuthStore<GoogleOAuthAuthRecord> {
  findByUserId(userId: string): Promise<GoogleOAuthAuthRecord | undefined>;
}

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}
