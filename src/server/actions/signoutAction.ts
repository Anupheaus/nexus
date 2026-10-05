import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import { signOutAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import { useAuthData } from '../async-context/nexusContext';
import { isAuthKey } from '../../common/auth';
import { logAuthStep, logAuthSuccess } from '../auth/authEventLog';

const COOKIE_NAME = 'nexus_session';

export async function handleSignOut(
  store: NexusAuthStore<NexusAuthRecord>,
  removeCookie: (name: string) => void,
): Promise<void> {
  // Session token is available from the auth context set by executeRestEntry.
  const sessionToken = useAuthData()?.token;
  const record = isAuthKey(sessionToken) ? await store.findBySessionToken(sessionToken) : undefined;
  if (record) await store.update(record.requestId, { isEnabled: false });
  removeCookie(COOKIE_NAME);
  // Signing out revokes the session: logged only when there was one to revoke.
  if (record) logAuthSuccess({ event: 'sign-out', method: 'session-cookie', userId: record.userId, detail: { isSessionRevoked: true } });
  else logAuthStep({ event: 'sign-out', method: 'session-cookie', step: 'no-session-to-revoke', userId: useAuthData()?.user?.id });
}

export function createSignoutAction(
  store: NexusAuthStore<NexusAuthRecord>,
): NexusServerAction {
  return createServerActionHandler(signOutAction, async (_req, { removeCookie }) => handleSignOut(store, removeCookie));
}
