import crypto from 'crypto';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import { googleStartAction } from '../../common/internalActions';
import type { GoogleStartRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
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

  const resolvedPlatform = (() => {
    if (platform === 'capacitor') return 'capacitor' as const;
    if (platform === 'web' || platform == null) return 'web' as const;
    throw new Error(`Unrecognised platform value: "${platform}"`);
  })();

  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = encodeState(
    {
      nonce,
      postAuthUrl,
      platform: resolvedPlatform,
      popup: popup === true,
      // Preserved in state so the callback can update grantedScopes with exactly the scopes requested.
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
    // 'consent' forces refresh token issuance on every sign-in — without it, Google
    // omits the refresh_token on subsequent authorisations for already-consented users.
    prompt: 'consent',
  });
  if (extraScopeList.length > 0) params.set('include_granted_scopes', 'true');

  return { authUrl: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` };
}

export function createGoogleStartAction(config: GoogleOAuthAuthConfig): NexusServerAction {
  return createServerActionHandler(
    googleStartAction,
    async (req: GoogleStartRequest) => handleGoogleStart(config, req),
    { isPublic: true },
  );
}
