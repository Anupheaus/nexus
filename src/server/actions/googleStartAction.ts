import crypto from 'crypto';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import { googleStartAction } from '../../common/internalActions';
import type { GoogleStartRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import { encodeState } from '../auth/googleOAuthState';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function handleGoogleStart(
  config: GoogleOAuthAuthConfig,
  req: GoogleStartRequest,
): Promise<{ authUrl: string }> {
  const { postAuthUrl = '/', platform = 'web', popup = false, scopes: extraScopes } = req;

  const extraScopeList = extraScopes
    ? extraScopes.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const allScopes = [...config.baseScopes, ...extraScopeList];

  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = encodeState(
    {
      nonce,
      postAuthUrl,
      platform: platform === 'capacitor' ? 'capacitor' : 'web',
      popup: popup === true,
      scopes: extraScopeList.length > 0 ? extraScopeList : undefined,
    },
    config.clientSecret,
  );

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: allScopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  if (extraScopeList.length > 0) params.set('include_granted_scopes', 'true');

  return { authUrl: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` };
}

export function createGoogleStartAction(config: GoogleOAuthAuthConfig): SocketAPIServerAction {
  return createServerActionHandler(
    googleStartAction,
    async (req: GoogleStartRequest) => handleGoogleStart(config, req),
    { isPublic: true },
  );
}
