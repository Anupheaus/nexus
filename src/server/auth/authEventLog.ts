import type { Logger } from '@anupheaus/common';
import { useClient, useLogger, useRequestOrigin, type NexusRequestOrigin } from '../async-context/nexusContext';
import { securityWarn } from '../security/securityLog';
import type { AuthEventDetails, AuthFailureDetails, AuthFailureReason, AuthOutcome, AuthStepDetails } from './authEventModels';

const SUB_LOGGER_NAME = 'Nexus Auth';

/** Failures where a safeguard blocked the request (not a user slip): also tagged as the `auth-blocked` security event. */
const SECURITY_BLOCK_REASONS = new Set<AuthFailureReason>([
  'invalid-request',
  'credential-mismatch',
  'malformed-credential',
  'origin-not-allowed',
  'challenge-rejected',
  'bad-signature',
  'counter-regression',
  'replay',
  'redirect-not-allowed',
  'oauth-state-mismatch',
  'oauth-audience-mismatch',
]);

const OUTCOME_WORDS: Record<AuthOutcome, string> = { success: 'succeeded', failure: 'failed', step: 'step' };

interface SocketLike {
  handshake?: { address?: string; headers?: Record<string, string | string[] | undefined> };
}

/** The request's origin: set per REST request, otherwise read from the socket's handshake. */
function resolveOrigin(): NexusRequestOrigin {
  const origin = useRequestOrigin();
  if (origin != null) return origin;
  const { handshake } = (useClient() ?? {}) as SocketLike;
  const userAgent = handshake?.headers?.['user-agent'];
  return { ip: handshake?.address, userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent };
}

function toMeta(outcome: AuthOutcome, { event, method, userId, detail }: AuthEventDetails, extra: Record<string, unknown>): Record<string, unknown> {
  const { ip, userAgent } = resolveOrigin();
  return { ...detail, event, outcome, method, ...extra, userId, ip, userAgent };
}

function toMessage(outcome: AuthOutcome, event: string): string {
  return `[Auth] ${event} ${OUTCOME_WORDS[outcome]}`;
}

/** The host's logger, or undefined outside a request (handlers are also called directly, e.g. in tests). */
function tryUseLogger(): Logger | undefined {
  try {
    return useLogger().createSubLogger(SUB_LOGGER_NAME);
  } catch {
    // No nexus context: there is nowhere to log to, and failing the sign-in over a log line would be worse.
    return undefined;
  }
}

/** Info: a sign-in, sign-out or registration that succeeded. */
export function logAuthSuccess(details: AuthEventDetails): void {
  tryUseLogger()?.info(toMessage('success', details.event), toMeta('success', details, {}));
}

/**
 * Warn: an authentication that failed, with its reason code. When a safeguard blocked it, it is logged through
 * `securityWarn` (security event `auth-blocked`) so it also shows with the other security blocks.
 */
export function logAuthFailure(details: AuthFailureDetails): void {
  const logger = tryUseLogger();
  if (logger == null) return;
  const { event, reason } = details;
  const meta = toMeta('failure', details, { reason });
  if (SECURITY_BLOCK_REASONS.has(reason)) securityWarn(toMessage('failure', event), { securityEvent: 'auth-blocked', ...meta });
  else logger.warn(toMessage('failure', event), meta);
}

/** Debug: a ceremony step (challenge issued, session restored…). Kept by the flight recorder for an error's trail. */
export function logAuthStep(details: AuthStepDetails): void {
  tryUseLogger()?.debug(toMessage('step', details.event), toMeta('step', details, { step: details.step }));
}
