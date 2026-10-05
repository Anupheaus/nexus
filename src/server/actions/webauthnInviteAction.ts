import crypto from 'crypto';
import { isAuthKey, isPendingWebAuthnInvite, type WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import { webauthnInviteAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import { logAuthFailure, logAuthStep } from '../auth/authEventLog';
import type { AuthFailureReason } from '../auth/authEventModels';

const INVITE_NOT_FOUND = 'Invite not found';

interface InviteRefusal {
  reason: AuthFailureReason;
  /** What the client is told. */
  message: string;
  userId?: string;
}

/** Logs the refused invite link (one `[Auth]` warn with its reason) and refuses it with the client-facing message. */
function refuseInvite({ reason, message, userId }: InviteRefusal): never {
  logAuthFailure({ event: 'invite', method: 'invite', reason, userId });
  throw new Error(message);
}

export async function handleWebAuthnInvite(
  store: WebAuthnAuthStore,
  onGetInviteDetails: (userId: string, accountId?: string) => Promise<InviteDetails>,
  req: { requestId: string },
): Promise<{ registrationToken: string; inviteDetails: InviteDetails }> {
  // A request id that is not a string (an object is a query operator to a MongoDB store) finds nothing (sc-620).
  if (!isAuthKey(req?.requestId)) refuseInvite({ reason: 'invalid-request', message: INVITE_NOT_FOUND });
  const record = await store.findById(req.requestId);
  if (!record) refuseInvite({ reason: 'invite-not-found', message: INVITE_NOT_FOUND });
  // A registered device keeps its invite's requestId: after sign-out or a disable, only isEnabled is false again, so the
  // old link must be refused on anything that has registered, not just on isEnabled.
  if (!isPendingWebAuthnInvite(record)) refuseInvite({ reason: 'invite-used', message: 'Invite already used', userId: record.userId });

  const registrationToken = crypto.randomUUID();
  await store.update(record.requestId, { registrationToken });
  logAuthStep({ event: 'invite', method: 'invite', step: 'registration-token-issued', userId: record.userId });

  const inviteDetails = await onGetInviteDetails(record.userId, record.accountId);
  const scopedDetails = record.accountId != null ? { ...inviteDetails, accountId: record.accountId } : inviteDetails;
  return { registrationToken, inviteDetails: scopedDetails };
}

export function createWebauthnInviteAction(
  store: WebAuthnAuthStore,
  onGetInviteDetails: (userId: string, accountId?: string) => Promise<InviteDetails>,
): NexusServerAction {
  return createServerActionHandler(
    webauthnInviteAction,
    req => handleWebAuthnInvite(store, onGetInviteDetails, req),
    { isPublic: true },
  );
}
