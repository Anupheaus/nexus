import crypto from 'crypto';
import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleOneTapRequest } from '../../common/internalActions';
import { googleOneTapAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import { COOKIE_NAME as CALLBACK_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from './googleCallbackAction';

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

export async function handleGoogleOneTap({ config, req, setCookie }: HandleGoogleOneTapOptions): Promise<void> {
  const { data: tokenInfo } = await axios.get<GoogleTokenInfoResponse>(
    `${GOOGLE_TOKEN_INFO_URL}?id_token=${req.credential}`,
    { timeout: 10_000 },
  );

  // Verify the token was issued for this application — reject mismatched audiences immediately.
  if (tokenInfo.aud !== config.clientId) {
    throw new AuthenticationError({ message: 'Invalid One Tap token audience' });
  }

  const { sub, email, name, picture } = tokenInfo;

  const existingRecord = await config.store.findByGoogleId(sub);
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
      // Per design: userId stores the Google subject ID so the consumer can look up their own user.
      userId: sub,
      googleId: sub,
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
}

export function createGoogleOneTapAction(config: GoogleOAuthAuthConfig): SocketAPIServerAction {
  return createServerActionHandler(
    googleOneTapAction,
    async (req, { setCookie }) => handleGoogleOneTap({ config, req, setCookie }),
    { isPublic: true },
  );
}
