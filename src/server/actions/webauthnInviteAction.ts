import crypto from 'crypto';
import type { WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import { webauthnInviteAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';

export async function handleWebAuthnInvite(
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<InviteDetails>,
  req: { requestId: string },
): Promise<{ registrationToken: string; inviteDetails: InviteDetails }> {
  const record = await store.findById(req.requestId);
  if (!record) throw new Error('Invite not found');
  if (record.isEnabled) throw new Error('Invite already used');

  const registrationToken = crypto.randomUUID();
  await store.update(record.requestId, { registrationToken });

  const inviteDetails = await onGetUserDetails(record.userId);
  return { registrationToken, inviteDetails };
}

export function createWebauthnInviteAction(
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<InviteDetails>,
): SocketAPIServerAction {
  return createServerActionHandler(
    webauthnInviteAction,
    req => handleWebAuthnInvite(store, onGetUserDetails, req),
    { isPublic: true },
  );
}
