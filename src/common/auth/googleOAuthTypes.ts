import type { NexusAuthRecord, NexusAuthStore } from './authTypes';

export interface GoogleOAuthAuthRecord extends NexusAuthRecord {
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiresAt: number; // unix ms
  grantedScopes: string[];
}

export interface GoogleOAuthAuthStore extends NexusAuthStore<GoogleOAuthAuthRecord> {
  findByUserId(userId: string): Promise<GoogleOAuthAuthRecord | undefined>;
}

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}
