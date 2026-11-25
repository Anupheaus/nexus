import type { AuthFailureReason } from './authEventModels';

/** What a socket's handshake session came to (see `validateSessionCookie`). */
export type SessionCookieOutcome =
  /** The session was valid and its user has been set. */
  | { status: 'restored' }
  /** No session was offered: an ordinary signed-out connection (the sign-in screen). */
  | { status: 'no-session' }
  /** A session was offered and refused. */
  | { status: 'rejected'; reason: AuthFailureReason };
