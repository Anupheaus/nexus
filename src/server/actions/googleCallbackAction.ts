import crypto from 'crypto';
import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleCallbackRequest } from '../../common/internalActions';
import { googleCallbackAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import type { CookieOptions, RedirectResult } from '../handler/handlerUtils';
import { decodeState } from '../auth/googleOAuthState';
import type { GoogleOAuthStatePayload } from '../auth/googleOAuthState';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';

export const COOKIE_NAME = 'socketapi_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Inline HTML sent back when OAuth was initiated from a popup window.
// The postMessage type string matches what the client-side listener expects.
const POPUP_SUCCESS_HTML = '<!DOCTYPE html><html><body><script>window.opener && window.opener.postMessage({ type: \'google-oauth-complete\' }, window.location.origin); window.close();</script></body></html>';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface GoogleUserInfoResponse {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

interface HandleGoogleCallbackUtils {
  setCookie(name: string, value: string, options?: CookieOptions): void;
  redirect(url: string): RedirectResult;
  setHeaders(headers: Record<string, string>): void;
}

interface HandleGoogleCallbackOptions {
  config: GoogleOAuthAuthConfig;
  req: GoogleCallbackRequest;
  utils: HandleGoogleCallbackUtils;
}

async function exchangeCodeForTokens({ clientId, clientSecret, redirectUri }: GoogleOAuthAuthConfig, code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const resp = await axios.post<GoogleTokenResponse>(
    GOOGLE_TOKEN_ENDPOINT,
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
  );
  return resp.data;
}

async function fetchUserProfile(accessToken: string): Promise<GoogleUserInfoResponse> {
  const resp = await axios.get<GoogleUserInfoResponse>(
    GOOGLE_USERINFO_ENDPOINT,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10_000 },
  );
  return resp.data;
}

export async function handleGoogleCallback({ config, req, utils }: HandleGoogleCallbackOptions): Promise<RedirectResult | string> {
  const { setCookie, redirect, setHeaders } = utils;
  const { error, code, state } = req;

  // Surface OAuth errors (e.g. access_denied) before any further processing.
  if (error) throw new AuthenticationError({ message: error });

  // Reject callbacks where Google omitted the authorization code entirely.
  if (!code) throw new AuthenticationError({ message: 'OAuth callback missing authorization code' });

  // Verify the state HMAC and wrap any format/signature errors so callers receive
  // a consistent AuthenticationError rather than a plain Error.
  let statePayload: GoogleOAuthStatePayload;
  try {
    statePayload = decodeState(state, config.clientSecret);
  } catch {
    throw new AuthenticationError({ message: 'Invalid OAuth state parameter' });
  }

  const tokens = await exchangeCodeForTokens(config, code);
  const profile = await fetchUserProfile(tokens.access_token);

  // Google returns expires_in in seconds; convert to unix ms for storage.
  const googleTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
  const grantedScopes = tokens.scope.split(' ').filter(Boolean);

  const existingRecord = await config.store.findByGoogleId(profile.sub);

  const sessionToken = crypto.randomBytes(32).toString('base64url');

  if (existingRecord) {
    await config.store.update(existingRecord.requestId, {
      sessionToken,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleTokenExpiresAt,
      grantedScopes,
      isEnabled: true,
      lastConnectedAt: Date.now(),
    });
  } else {
    // New Google user — notify the consumer so they can create their own user record.
    await config.onCreateUser({ id: profile.sub, email: profile.email, name: profile.name, picture: profile.picture });

    const newRecord: GoogleOAuthAuthRecord = {
      requestId: crypto.randomUUID(),
      sessionToken,
      // Per design: userId stores the Google subject ID so the consumer can look up their own user.
      userId: profile.sub,
      googleId: profile.sub,
      deviceId: crypto.randomUUID(),
      isEnabled: true,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleTokenExpiresAt,
      grantedScopes,
      lastConnectedAt: Date.now(),
    };
    await config.store.create(newRecord);
  }

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);

  // Respond according to the flow that initiated the OAuth dance.
  if (statePayload.popup) {
    setHeaders({ 'Content-Type': 'text/html' });
    return POPUP_SUCCESS_HTML;
  }

  if (statePayload.platform === 'capacitor') {
    // capacitorCallbackUrl is mandatory when the flow was initiated from a Capacitor app.
    if (!config.capacitorCallbackUrl) {
      throw new Error('capacitorCallbackUrl is required in config for Capacitor OAuth');
    }
    return utils.redirect(config.capacitorCallbackUrl);
  }

  return redirect(statePayload.postAuthUrl);
}

export function createGoogleCallbackAction(config: GoogleOAuthAuthConfig): SocketAPIServerAction {
  return createServerActionHandler(
    googleCallbackAction,
    async (req, { setCookie, redirect, setHeaders }) => handleGoogleCallback({ config, req, utils: { setCookie, redirect, setHeaders } }),
    { isPublic: true },
  );
}
