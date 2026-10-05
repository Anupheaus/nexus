import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthStore } from '../../common/auth';
import { isAuthKey } from '../../common/auth';
import { logAuthFailure, logAuthStep } from './authEventLog';

// Refresh 30 s before actual expiry so callers always get a token valid for at least 30 s.
const EXPIRY_BUFFER_MS = 30_000;

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
}

interface RefreshGoogleTokenOptions {
  store: GoogleOAuthAuthStore;
  clientId: string;
  clientSecret: string;
  sessionToken: string;
}

export async function refreshGoogleToken({ store, clientId, clientSecret, sessionToken }: RefreshGoogleTokenOptions): Promise<string> {
  // Never echo the token: this message is logged. A token that is not a string finds nothing (sc-620).
  const record = isAuthKey(sessionToken) ? await store.findBySessionToken(sessionToken) : undefined;
  // A disabled or signed-out device's session must not reach Google's tokens either.
  if (!record?.isEnabled) {
    logAuthFailure({ event: 'token-refresh', method: 'google', reason: record == null ? 'no-session' : 'device-disabled', userId: record?.userId });
    throw new AuthenticationError({ message: 'No Google OAuth session found for this session' });
  }

  if (record.googleTokenExpiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return record.googleAccessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: record.googleRefreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let resp: { data: GoogleRefreshResponse };
  try {
    resp = await axios.post<GoogleRefreshResponse>(
      GOOGLE_TOKEN_ENDPOINT,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );
  } catch (error) {
    // Rethrown as it was; only the reason is logged (the request body carries the refresh token).
    logAuthFailure({ event: 'token-refresh', method: 'google', reason: 'refresh-failed', userId: record.userId });
    throw error;
  }

  const { access_token: newAccessToken, expires_in: expiresIn } = resp.data;
  const newExpiresAt = Date.now() + expiresIn * 1000; // Google returns expires_in in seconds

  await store.update(record.requestId, {
    googleAccessToken: newAccessToken,
    googleTokenExpiresAt: newExpiresAt,
  });
  logAuthStep({ event: 'token-refresh', method: 'google', step: 'access-token-refreshed', userId: record.userId });

  return newAccessToken;
}
