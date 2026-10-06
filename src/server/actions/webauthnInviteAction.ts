import { AuthenticationError } from '@anupheaus/common';
import crypto from 'crypto';
import { isAuthKey, isPendingWebAuthnInvite, type WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import { webauthnInviteAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';

export async function handleWebAuthnInvite(
  store: WebAuthnAuthStore,
  onGetInviteDetails: (userId: string, accountId?: string) => Promise<InviteDetails>,
  req: { requestId: string },
): Promise<{ registrationToken: string; inviteDetails: InviteDetails }> {
  // A request id that is not a string (an object is a query operator to a MongoDB store) finds nothing (sc-620).
  if (!isAuthKey(req?.requestId)) throw new AuthenticationError('Invite not found');
  const record = await store.findById(req.requestId);
  if (!record) throw new AuthenticationError('Invite not found');
  // A registered device keeps its invite's requestId: after sign-out or a disable, only isEnabled is false again, so the
  // old link must be refused on anything that has registered, not just on isEnabled.
  if (!isPendingWebAuthnInvite(record)) throw new AuthenticationError('Invite already used');

  const registrationToken = crypto.randomUUID();
  await store.update(record.requestId, { registrationToken });

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
