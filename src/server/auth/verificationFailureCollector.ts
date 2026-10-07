import type { AuthFailureReason } from './authEventModels';
import type { PasskeyVerificationErrorHandler } from './passkeyVerification';

export interface VerificationFailureCollector {
  /** Pass to `verifyPasskeySignIn` / `verifyPasskeyRegistration`. */
  onError: PasskeyVerificationErrorHandler;
  /** The first reason a ceremony was refused, or `fallback` when it gave none. */
  reasonOr(fallback: AuthFailureReason): AuthFailureReason;
}

/**
 * Keeps why a passkey ceremony was refused, so the action logs one `[Auth]` failure with that reason (sc-378). The
 * error itself is dropped: its text can quote the challenge.
 */
export function createVerificationFailureCollector(): VerificationFailureCollector {
  let firstReason: AuthFailureReason | undefined;
  return {
    onError: (_error, reason) => { firstReason ??= reason; },
    reasonOr: fallback => firstReason ?? fallback,
  };
}
