import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';

/** Tabs, newlines and other control characters (which browsers strip from a URL) and backslashes (which they read as `/`). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_URL_CHARACTERS = /[\u0000-\u001F\u007F\\]/;

function originOf(url: string): string | undefined {
  try { return new URL(url).origin; } catch { return undefined; }
}

/**
 * Where the Google OAuth callback may send the browser after signing in, or `undefined` when it may not go there.
 *
 * `postAuthUrl` comes from the client that started the flow, so without this check anyone could build a sign-in link
 * that ends on a site of their choosing, an open redirect. Allowed:
 * - a path on this site (`/…`, never `//…`, which is another host);
 * - an absolute http(s) URL on the callback's own origin (`redirectUri`) or on one of `allowedPostAuthOrigins`.
 */
export function resolvePostAuthUrl(
  postAuthUrl: unknown,
  { redirectUri, allowedPostAuthOrigins = [] }: Pick<GoogleOAuthAuthConfig, 'redirectUri' | 'allowedPostAuthOrigins'>,
): string | undefined {
  if (typeof postAuthUrl !== 'string' || postAuthUrl.length === 0 || UNSAFE_URL_CHARACTERS.test(postAuthUrl)) return undefined;
  if (postAuthUrl.startsWith('/')) return postAuthUrl.startsWith('//') ? undefined : postAuthUrl;
  let url: URL;
  try { url = new URL(postAuthUrl); } catch { return undefined; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const allowedOrigins = [redirectUri, ...allowedPostAuthOrigins].map(originOf).filter(origin => origin != null);
  return allowedOrigins.includes(url.origin) ? url.toString() : undefined;
}
