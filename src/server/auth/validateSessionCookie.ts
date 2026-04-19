import type { Socket } from 'socket.io';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

const COOKIE_NAME = 'socketapi_session';

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

export async function validateSessionCookie(
  socket: Socket,
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
  onGetUser: (userId: string) => Promise<SocketAPIUser | undefined>,
  setUser: (user: SocketAPIUser) => Promise<void>,
): Promise<boolean> {
  const cookieHeader = socket.handshake.headers.cookie as string | undefined;
  const sessionToken = parseCookie(cookieHeader);
  if (!sessionToken) { socket.disconnect(); return false; }

  const record = await store.findBySessionToken(sessionToken);
  if (!record || !record.isEnabled) { socket.disconnect(); return false; }

  const user = await onGetUser(record.userId);
  if (!user) { socket.disconnect(); return false; }

  await setUser(user);
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  return true;
}
