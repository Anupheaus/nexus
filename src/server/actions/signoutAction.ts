import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import { signOutAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import { useAuthData } from '../async-context/socketApiContext';

const COOKIE_NAME = 'nexus_session';

export async function handleSignOut(
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
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
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
): SocketAPIServerAction {
  return createServerActionHandler(signOutAction, async (_req, { removeCookie }) => handleSignOut(store, removeCookie));
}
