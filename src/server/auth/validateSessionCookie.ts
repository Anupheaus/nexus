import type { Socket } from 'socket.io';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';
import { socketAPIDeviceDisabled } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';

const COOKIE_NAME = 'nexus_session';

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

export async function validateSessionCookie(
  socket: Socket,
  store: NexusAuthStore<NexusAuthRecord>,
  onGetUser: (userId: string) => Promise<NexusUser | undefined>,
  setUser: (user: NexusUser, sessionToken: string) => Promise<void>,
): Promise<boolean> {
  const cookieHeader = socket.handshake.headers.cookie as string | undefined;
  const sessionToken = parseCookie(cookieHeader) ?? ((socket.handshake.auth as Record<string, unknown>)?.sessionToken as string | undefined);
  if (!sessionToken) return false;

  const record = await store.findBySessionToken(sessionToken);
  if (!record) {
    // Token was supplied by the client but is not in the store — it is stale.
    // Emit so the client can clear the stored value and avoid a loop.
    if ((socket.handshake.auth as Record<string, unknown>)?.sessionToken) {
      socket.emit('nexus:sessionInvalid');
    }
    return false;
  }

  if (!record.isEnabled) {
    socket.emit(`${eventPrefix}.${socketAPIDeviceDisabled.name}`, undefined);
    socket.disconnect();
    return false;
  }

  const user = await onGetUser(record.userId);
  if (!user) return false;

  await setUser(user, sessionToken);
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  // Echo the session token back so Capacitor apps (which cannot rely on HttpOnly
  // cookies in WebSocket upgrade headers) can persist it and supply it on reconnect.
  socket.emit('nexus:sessionToken', sessionToken);
  return true;
}
