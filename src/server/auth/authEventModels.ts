/** What an `[Auth]` entry is about (sc-378). Filter on `event` in log aggregation. */
export type AuthEvent =
  | 'sign-in'
  | 'sign-out'
  | 'invite'
  | 'session'
  | 'token-refresh'
  | 'challenge';

/** `success` and `failure` are info and warn; `step` is a debug ceremony step. */
export type AuthOutcome = 'success' | 'failure' | 'step';

/** How the user authenticated, or what was checked. */
export type AuthMethod =
  | 'passkey'
  | 'invite'
  | 'google'
  | 'google-one-tap'
  | 'credentials'
  | 'session-cookie'
  | 'rest-session';

/** Why an authentication failed: a fixed code, never the error text (which can carry a challenge or a token). */
export type AuthFailureReason =
  | 'invalid-request'
  | 'invalid-credentials'
  | 'unknown-credential'
  | 'credential-mismatch'
  | 'no-registered-passkey'
  | 'malformed-credential'
  | 'origin-not-allowed'
  | 'no-relying-party'
  | 'challenge-rejected'
  | 'bad-signature'
  | 'counter-regression'
  | 'replay'
  | 'passkey-already-registered'
  | 'store-error'
  | 'device-disabled'
  | 'invite-not-found'
  | 'invite-used'
  | 'stale-session'
  | 'unknown-user'
  | 'no-session'
  | 'redirect-not-allowed'
  | 'oauth-cancelled'
  | 'oauth-error'
  | 'oauth-missing-code'
  | 'oauth-state-mismatch'
  | 'oauth-audience-mismatch'
  | 'oauth-exchange-failed'
  | 'refresh-failed';

/** Who and what an `[Auth]` entry concerns. Never a token, cookie, challenge, key, PRF output, OAuth code or email. */
export interface AuthEventDetails {
  event: AuthEvent;
  method: AuthMethod;
  /** Known once the record or profile is found. */
  userId?: string;
  /** Extra counts or flags (e.g. `isNewUser`); keep it free of secrets and personal data. */
  detail?: Record<string, string | number | boolean | undefined>;
}

export interface AuthFailureDetails extends AuthEventDetails {
  reason: AuthFailureReason;
}

export interface AuthStepDetails extends AuthEventDetails {
  /** The ceremony step, e.g. `challenge-issued`, `session-restored`. */
  step: string;
}
