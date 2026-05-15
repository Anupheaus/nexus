import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthStore } from '../../common/auth';

// Refresh 30 s before actual expiry so callers always get a token valid for at least 30 s.
const EXPIRY_BUFFER_MS = 30_000;

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface RefreshGoogleTokenOptions {
  store: GoogleOAuthAuthStore;
  clientId: string;
  clientSecret: string;
  sessionToken: string;
}

export async function refreshGoogleToken({ store, clientId, clientSecret, sessionToken }: RefreshGoogleTokenOptions): Promise<string> {
  const record = await store.findBySessionToken(sessionToken);
  if (!record) throw new AuthenticationError('No Google OAuth session found');

  if (record.googleTokenExpiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return record.googleAccessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: record.googleRefreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await axios.post<{ access_token: string; expires_in: number }>(
    GOOGLE_TOKEN_ENDPOINT,
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  const { access_token: newAccessToken, expires_in: expiresIn } = resp.data;
  const newExpiresAt = Date.now() + expiresIn * 1000;

  await store.update(record.requestId, {
    googleAccessToken: newAccessToken,
    googleTokenExpiresAt: newExpiresAt,
  });

  return newAccessToken;
}
