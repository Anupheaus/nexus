import type { IncomingMessage } from 'http';
import type { AuthConfig } from '../auth';
import { validateRestSession } from '../auth';
import { setAuthData } from '../async-context/nexusContext';

export interface RunRestAuthDeps {
  validateRestSession: typeof validateRestSession;
  setAuthData: typeof setAuthData;
}

export type RestAuthResult = { authorized: true } | { authorized: false };

/**
 * Auth-gate portion of the REST action wrap in `registerRestActions.ts`, extracted so the
 * ordering between `auth.onResolveRestConnection` (a per-request pre-auth hook mirroring the
 * socket-side `onResolveConnection` from `socketAuthMiddleware.ts`) and the auth store lookup
 * can be unit-tested without a real Koa/HTTP harness.
 *
 * Runs, in order: `auth.onResolveRestConnection` if supplied (a no-op when absent, and skipped
 * entirely when no auth is configured) → the isPublic gate → `validateRestSession` (which
 * queries `auth.store`) for non-public actions.
 *
 * `onResolveRestConnection` runs even for public actions (e.g. webauthn invite/register/reauth)
 * because those device-onboarding flows still query the auth store directly inside their own
 * handlers — per-connection context (e.g. tenant/database routing) must be resolved before ANY
 * store access, not just the session lookup performed here.
 */
export async function runRestAuth(
  req: IncomingMessage,
  auth: AuthConfig | undefined,
  isPublic: boolean | undefined,
  deps: RunRestAuthDeps,
): Promise<RestAuthResult> {
  const { validateRestSession: validateRestSessionDep, setAuthData: setAuthDataDep } = deps;
  if (auth?.onResolveRestConnection != null) await auth.onResolveRestConnection(req);
  if (auth == null || isPublic) return { authorized: true };
  const session = await validateRestSessionDep(req.headers.cookie ?? '', auth.store, auth.onGetUser);
  if (!session) return { authorized: false };
  setAuthDataDep({ user: session.user, token: session.token });
  return { authorized: true };
}
