import type { GoogleScopesResponse } from '../../common/internalActions';

export async function requestScopes(
  scopes: string[],
  callScopes: (req: { scopes: string[] }) => Promise<GoogleScopesResponse>,
  openOAuth: (missingScopes: string[]) => Promise<void>,
): Promise<void> {
  const result = await callScopes({ scopes });
  if (result.alreadyGranted) return;
  await openOAuth(result.missingScopes ?? scopes);
}
