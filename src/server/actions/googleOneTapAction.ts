import crypto from 'crypto';
import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import { isAuthKey, type GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleOneTapRequest } from '../../common/internalActions';
import { googleOneTapAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import { COOKIE_NAME as CALLBACK_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from './googleCallbackAction';
import { logAuthFailure, logAuthSuccess } from '../auth/authEventLog';
import type { AuthFailureReason } from '../auth/authEventModels';

// Re-export so consumers and tests can import COOKIE_NAME from this module.
export { COOKIE_NAME } from './googleCallbackAction';

const GOOGLE_TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

interface GoogleTokenInfoResponse {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  aud: string;
}

interface HandleGoogleOneTapOptions {
  config: GoogleOAuthAuthConfig;
  req: GoogleOneTapRequest;
  setCookie(name: string, value: string, options?: CookieOptions): void;
}

/** Logs the refused One Tap sign-in (one `[Auth]` warn with its reason) and refuses it with fixed words. */
function refuseOneTap(reason: AuthFailureReason, message: string): never {
  logAuthFailure({ event: 'sign-in', method: 'google-one-tap', reason });
  throw new AuthenticationError({ message });
}

export async function handleGoogleOneTap({ config, req, setCookie }: HandleGoogleOneTapOptions): Promise<void> {
  // The credential is client JSON: refuse anything but a string, and pass it as an encoded parameter so it cannot add
  // parameters of its own to Google's URL.
  if (!isAuthKey(req?.credential)) refuseOneTap('invalid-request', 'Invalid One Tap credential');
  let tokenInfo: GoogleTokenInfoResponse;
  try {
    ({ data: tokenInfo } = await axios.get<GoogleTokenInfoResponse>(GOOGLE_TOKEN_INFO_URL, {
      params: { id_token: req.credential },
      timeout: 10_000,
    }));
  } catch (error) {
    // Rethrown as it was; only the reason is logged (the request URL carries the ID token).
    logAuthFailure({ event: 'sign-in', method: 'google-one-tap', reason: 'oauth-exchange-failed' });
    throw error;
  }

  // Verify the token was issued for this application — reject mismatched audiences immediately.
  if (tokenInfo.aud !== config.clientId) refuseOneTap('oauth-audience-mismatch', 'Invalid One Tap token audience');

  const { sub, email, name, picture } = tokenInfo;

  const existingRecord = await config.store.findByUserId(sub);
  const sessionToken = crypto.randomBytes(32).toString('base64url');

  if (existingRecord) {
    await config.store.update(existingRecord.requestId, {
      sessionToken,
      isEnabled: true,
      lastConnectedAt: Date.now(),
    });
  } else {
    // New Google user — notify the consumer so they can create their own user record.
    await config.onCreateUser({ id: sub, email, name, picture });

    const newRecord: GoogleOAuthAuthRecord = {
      requestId: crypto.randomUUID(),
      sessionToken,
      userId: sub,
      deviceId: crypto.randomUUID(),
      isEnabled: true,
      googleAccessToken: '',
      googleRefreshToken: '',
      googleTokenExpiresAt: 0,
      grantedScopes: [],
      lastConnectedAt: Date.now(),
    };
    await config.store.create(newRecord);
  }

  setCookie(CALLBACK_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  logAuthSuccess({ event: 'sign-in', method: 'google-one-tap', userId: sub, detail: { isNewUser: existingRecord == null } });
}

export function createGoogleOneTapAction(config: GoogleOAuthAuthConfig): NexusServerAction {
  return createServerActionHandler(
    googleOneTapAction,
    async (req, { setCookie }) => handleGoogleOneTap({ config, req, setCookie }),
    { isPublic: true },
  );
}
