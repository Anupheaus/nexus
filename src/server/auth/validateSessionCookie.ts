import type { Socket } from 'socket.io';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';
import { isAuthKey } from '../../common/auth';
import { logAuthFailure, logAuthStep } from './authEventLog';
import type { AuthFailureReason } from './authEventModels';
import type { SessionCookieOutcome } from './sessionCookieModels';

const COOKIE_NAME = 'nexus_session';

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

interface SessionRejection {
  reason: AuthFailureReason;
  userId?: string;
}

/** Logs why a socket's session was refused (one `[Auth]` warn) and answers why. */
function rejectSession({ reason, userId }: SessionRejection): SessionCookieOutcome {
  logAuthFailure({ event: 'session', method: 'session-cookie', reason, userId });
  return { status: 'rejected', reason };
}

/**
 * Checks the session a socket's handshake offers (the `nexus_session` cookie, or `auth.sessionToken` from apps that
 * cannot send cookies) and sets its user when it is valid.
 *
 * It runs in the socket auth middleware, before the socket is connected, so it cannot shut the socket out itself (a
 * `disconnect()` there does nothing): it answers what the session came to, and `runSocketAuthMiddleware` acts on a
 * refusal.
 */
export async function validateSessionCookie(
  socket: Socket,
  store: NexusAuthStore<NexusAuthRecord>,
  onGetUser: (userId: string) => Promise<NexusUser | undefined>,
  setUser: (user: NexusUser, sessionToken: string) => Promise<void>,
): Promise<SessionCookieOutcome> {
  const cookieHeader = socket.handshake.headers.cookie as string | undefined;
  const sessionToken: unknown = parseCookie(cookieHeader) ?? (socket.handshake.auth as Record<string, unknown>)?.sessionToken;
  // The handshake's auth is client JSON: a token that is not a string (e.g. { "$gt": "" }, an operator to a MongoDB store)
  // must never reach the store, or it matches someone else's session (sc-620).
  // No session at all is an ordinary signed-out connection (the sign-in screen), not a rejection.
  if (sessionToken == null) return { status: 'no-session' };
  if (!isAuthKey(sessionToken)) return rejectSession({ reason: 'invalid-request' });

  const record = await store.findBySessionToken(sessionToken);
  if (!record) {
    // Token was supplied by the client but is not in the store — it is stale.
    // Emit so the client can clear the stored value and avoid a loop.
    if ((socket.handshake.auth as Record<string, unknown>)?.sessionToken) {
      socket.emit('nexus:sessionInvalid');
    }
    return rejectSession({ reason: 'stale-session' });
  }

  if (!record.isEnabled) return rejectSession({ reason: 'device-disabled', userId: record.userId });

  const user = await onGetUser(record.userId);
  if (!user) return rejectSession({ reason: 'unknown-user', userId: record.userId });

  await setUser(user, sessionToken);
  logAuthStep({ event: 'session', method: 'session-cookie', step: 'session-restored', userId: user.id });
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  // Echo the session token back so Capacitor apps (which cannot rely on HttpOnly
  // cookies in WebSocket upgrade headers) can persist it and supply it on reconnect.
  socket.emit('nexus:sessionToken', sessionToken);
  return { status: 'restored' };
}
