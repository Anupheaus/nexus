import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthStore } from '../../common/auth';
import type { GoogleScopesResponse } from '../../common/internalActions';
import { googleScopesAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import { COOKIE_NAME } from './googleCallbackAction';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import { refreshGoogleToken } from '../auth/googleTokenRefresh';

interface HandleGoogleScopesOptions {
  store: GoogleOAuthAuthStore;
  clientId: string;
  clientSecret: string;
  sessionToken: string;
  requestedScopes: string[];
}

export async function handleGoogleScopes({ store, clientId, clientSecret, sessionToken, requestedScopes }: HandleGoogleScopesOptions): Promise<GoogleScopesResponse> {
  const record = await store.findBySessionToken(sessionToken);
  if (!record) throw new AuthenticationError({ message: `No Google OAuth session found for sessionToken "${sessionToken}"` });

  const missingScopes = requestedScopes.filter(scope => !record.grantedScopes.includes(scope));

  // At least one requested scope has not been granted — no need to refresh the token.
  if (missingScopes.length > 0) return { alreadyGranted: false, missingScopes };

  // All scopes are already granted; refresh the access token if it is about to expire.
  await refreshGoogleToken({ store, clientId, clientSecret, sessionToken });

  return { alreadyGranted: true };
}

export function createGoogleScopesAction(config: GoogleOAuthAuthConfig): NexusServerAction {
  const { store, clientId, clientSecret } = config;
  return createServerActionHandler(
    googleScopesAction,
    async (req, utils) => {
      const sessionToken = utils.getCookie(COOKIE_NAME);
      // Missing session cookie means the user is not authenticated — reject before touching the store.
      if (!sessionToken) throw new AuthenticationError({ message: 'Missing session cookie' });

      const { scopes: requestedScopes } = req;
      return handleGoogleScopes({ store, clientId, clientSecret, sessionToken, requestedScopes });
    },
  );
}
