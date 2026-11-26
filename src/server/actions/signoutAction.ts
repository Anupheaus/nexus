import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import { signOutAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import { useAuthData } from '../async-context/nexusContext';
import { useAuthentication } from '../providers/authentication';
import { isAuthKey } from '../../common/auth';
import { logAuthStep, logAuthSuccess } from '../auth/authEventLog';

const COOKIE_NAME = 'nexus_session';

export async function handleSignOut(
  store: NexusAuthStore<NexusAuthRecord>,
  removeCookie: (name: string) => void,
): Promise<void> {
  // Session token is available from the auth context set by executeRestEntry.
  const { token: sessionToken, user: signedInUser } = useAuthData() ?? {};
  const { signOut } = useAuthentication();
  // The user, account and token live on the browser's connection (the `nexus-conn` cookie), which its sockets share and
  // which outlives them: unless they are cleared here, an open socket, and the next one this browser opens, carry on
  // signed in. Cleared first, so a store that fails below still leaves the browser signed out.
  await signOut();
  const record = isAuthKey(sessionToken) ? await store.findBySessionToken(sessionToken) : undefined;
  if (record) await store.update(record.requestId, { isEnabled: false });
  removeCookie(COOKIE_NAME);
  // Signing out revokes the session: logged only when there was one to revoke.
  if (record) logAuthSuccess({ event: 'sign-out', method: 'session-cookie', userId: record.userId, detail: { isSessionRevoked: true } });
  else logAuthStep({ event: 'sign-out', method: 'session-cookie', step: 'no-session-to-revoke', userId: signedInUser?.id });
}

export function createSignoutAction(
  store: NexusAuthStore<NexusAuthRecord>,
): NexusServerAction {
  return createServerActionHandler(signOutAction, async (_req, { removeCookie }) => handleSignOut(store, removeCookie));
}
