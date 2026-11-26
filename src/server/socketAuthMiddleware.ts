import type { Socket } from 'socket.io';
import { AuthenticationError } from '@anupheaus/common';
import type { AuthConfig } from './auth';
import { validateSessionCookie } from './auth';
import type { AuthFailureReason } from './auth/authEventModels';
import { useAuthentication } from './providers/authentication/useAuthentication';
import { setClient } from './async-context/nexusContext';

export interface RunSocketAuthMiddlewareDeps {
  auth: AuthConfig;
  setClient: typeof setClient;
  useAuthentication: typeof useAuthentication;
  validateSessionCookie: typeof validateSessionCookie;
}

/** What a refused connection tells the client: socket.io hands an error's `data` to the client's `connect_error`. */
export interface SocketConnectionRefusalData {
  reason: AuthFailureReason;
}

/**
 * Refused sessions that refuse the whole connection. Any other refused session (stale, unknown user, malformed) carries
 * on as an ordinary signed-out connection, so the client still hears `nexus:sessionInvalid` and can show its sign-in.
 */
const CONNECTION_REFUSING_REASONS: ReadonlySet<AuthFailureReason> = new Set<AuthFailureReason>(['device-disabled']);

function createConnectionRefusal(reason: AuthFailureReason): AuthenticationError {
  const data: SocketConnectionRefusalData = { reason };
  return Object.assign(new AuthenticationError({ message: `The connection was refused: ${reason}`, meta: { reason } }), { data });
}

/**
 * Body of the `io.use(...)` socket auth middleware in `startServer`, extracted so the
 * ordering between `auth.onResolveConnection` (a per-connection pre-auth hook) and the
 * auth store lookup can be unit-tested without a real socket.io harness.
 *
 * Runs, in order: `setClient` (per-connection context is now available) →
 * `auth.onResolveConnection` if supplied (a no-op when absent) → `validateSessionCookie`
 * (which queries `auth.store`).
 *
 * Only a restored session leaves the connection signed in. When no session is offered, any user and account the
 * connection still holds are cleared. When the session is refused, they are cleared, and a disabled device's connection
 * is refused (the promise rejects, and `startServer` passes the error to socket.io's `next`).
 */
export async function runSocketAuthMiddleware(socket: Socket, deps: RunSocketAuthMiddlewareDeps): Promise<void> {
  const { auth, setClient: setClientDep, useAuthentication: useAuthenticationDep, validateSessionCookie: validateSessionCookieDep } = deps;
  setClientDep(socket);
  if (auth.onResolveConnection != null) await auth.onResolveConnection(socket);
  // What the browser's connection already holds, from an earlier socket or REST request of this browser.
  const { setUser, signOut, user: heldUser, account: heldAccount } = useAuthenticationDep();
  const outcome = await validateSessionCookieDep(socket, auth.store, auth.onGetUser, async (user, sessionToken) => {
    await setUser(user, sessionToken);
  });
  if (outcome.status === 'restored') return;
  // The user lives on the browser's connection (the `nexus-conn` cookie), which outlives its sockets: unless it is
  // cleared, this socket carries on as whoever an earlier socket of this browser signed in, with no session of its own
  // (signed out, or its session cookie expired). A connection holding nobody is left alone, so an ordinary signed-out
  // connection is not told it signed out.
  if (outcome.status === 'no-session') {
    if (heldUser != null || heldAccount != null) await signOut();
    return;
  }
  await signOut();
  if (CONNECTION_REFUSING_REASONS.has(outcome.reason)) throw createConnectionRefusal(outcome.reason);
}
