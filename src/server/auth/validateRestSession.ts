import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';
import { isAuthKey } from '../../common/auth';
import { logAuthFailure, logAuthStep } from './authEventLog';
import type { AuthFailureReason } from './authEventModels';

export interface ValidatedRestSession {
  user: NexusUser;
  token: string;
}

function parseSessionToken(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('nexus_session=')) return trimmed.slice('nexus_session='.length);
  }
  return undefined;
}

interface RestSessionRejection {
  reason: AuthFailureReason;
  userId?: string;
}

/** Logs why a REST request's session was refused (one `[Auth]` warn) and answers "no session". */
function rejectRestSession({ reason, userId }: RestSessionRejection): undefined {
  logAuthFailure({ event: 'session', method: 'rest-session', reason, userId });
  return undefined;
}

export async function validateRestSession(
  cookieHeader: string,
  store: NexusAuthStore<NexusAuthRecord>,
  onGetUser: (userId: string) => Promise<NexusUser | undefined>,
): Promise<ValidatedRestSession | undefined> {
  const token = parseSessionToken(cookieHeader);
  // No cookie is an ordinary signed-out request, not a rejection; an empty one is refused like a malformed one.
  if (token == null) return undefined;
  if (!isAuthKey(token)) return rejectRestSession({ reason: 'invalid-request' });
  const record = await store.findBySessionToken(token);
  if (record == null) return rejectRestSession({ reason: 'stale-session' });
  if (!record.isEnabled) return rejectRestSession({ reason: 'device-disabled', userId: record.userId });
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  const user = await onGetUser(record.userId);
  if (!user) return rejectRestSession({ reason: 'unknown-user', userId: record.userId });
  logAuthStep({ event: 'session', method: 'rest-session', step: 'session-validated', userId: user.id });
  return { user, token };
}
