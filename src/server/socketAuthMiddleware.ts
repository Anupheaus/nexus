import type { Socket } from 'socket.io';
import type { AuthConfig } from './auth';
import { validateSessionCookie } from './auth';
import { useAuthentication } from './providers/authentication/useAuthentication';
import { setClient } from './async-context/nexusContext';

export interface RunSocketAuthMiddlewareDeps {
  auth: AuthConfig;
  setClient: typeof setClient;
  useAuthentication: typeof useAuthentication;
  validateSessionCookie: typeof validateSessionCookie;
}

/**
 * Body of the `io.use(...)` socket auth middleware in `startServer`, extracted so the
 * ordering between `auth.onResolveConnection` (a per-connection pre-auth hook) and the
 * auth store lookup can be unit-tested without a real socket.io harness.
 *
 * Runs, in order: `setClient` (per-connection context is now available) →
 * `auth.onResolveConnection` if supplied (a no-op when absent) → `validateSessionCookie`
 * (which queries `auth.store`).
 */
export async function runSocketAuthMiddleware(socket: Socket, deps: RunSocketAuthMiddlewareDeps): Promise<void> {
  const { auth, setClient: setClientDep, useAuthentication: useAuthenticationDep, validateSessionCookie: validateSessionCookieDep } = deps;
  setClientDep(socket);
  if (auth.onResolveConnection != null) await auth.onResolveConnection(socket);
  const { setUser } = useAuthenticationDep();
  await validateSessionCookieDep(socket, auth.store, auth.onGetUser, async (user, sessionToken) => {
    await setUser(user, sessionToken);
  });
}
