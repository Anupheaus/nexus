import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

function parseSessionToken(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('socketapi_session=')) return trimmed.slice('socketapi_session='.length);
  }
  return undefined;
}

export async function validateRestSession(
  cookieHeader: string,
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
  onGetUser: (userId: string) => Promise<SocketAPIUser | undefined>,
): Promise<SocketAPIUser | undefined> {
  const token = parseSessionToken(cookieHeader);
  if (!token) return undefined;
  const record = await store.findBySessionToken(token);
  if (!record?.isEnabled) return undefined;
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  return onGetUser(record.userId);
}
