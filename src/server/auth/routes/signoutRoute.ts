import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../../common/auth';
import { signOutAction } from '../../../common/internalActions';
import { createServerActionHandler } from '../../actions/createServerActionHandler';
import type { SocketAPIServerAction } from '../../actions/createServerActionHandler';
import { useAuthData, setResponseHeader } from '../../async-context/socketApiContext';

const COOKIE_NAME = 'socketapi_session';
const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export async function handleSignOut(
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
): Promise<void> {
  // Session token is available from the auth context set by executeRestEntry.
  const sessionToken = useAuthData()?.token;
  if (sessionToken) {
    const record = await store.findBySessionToken(sessionToken);
    if (record) await store.update(record.requestId, { isEnabled: false });
  }
  setResponseHeader('Set-Cookie', CLEAR_COOKIE);
}

export function createSignoutAction(
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
): SocketAPIServerAction {
  return createServerActionHandler(signOutAction, () => handleSignOut(store));
}
