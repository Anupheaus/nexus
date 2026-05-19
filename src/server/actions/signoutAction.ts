import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import { signOutAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import { useAuthData } from '../async-context/nexusContext';

const COOKIE_NAME = 'nexus_session';

export async function handleSignOut(
  store: NexusAuthStore<NexusAuthRecord>,
  removeCookie: (name: string) => void,
): Promise<void> {
  // Session token is available from the auth context set by executeRestEntry.
  const sessionToken = useAuthData()?.token;
  if (sessionToken) {
    const record = await store.findBySessionToken(sessionToken);
    if (record) await store.update(record.requestId, { isEnabled: false });
  }
  removeCookie(COOKIE_NAME);
}

export function createSignoutAction(
  store: NexusAuthStore<NexusAuthRecord>,
): NexusServerAction {
  return createServerActionHandler(signOutAction, async (_req, { removeCookie }) => handleSignOut(store, removeCookie));
}
