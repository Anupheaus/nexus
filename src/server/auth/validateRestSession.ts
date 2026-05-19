import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';

export interface ValidatedRestSession {
  user: NexusUser;
  token: string;
}

function parseSessionToken(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('nexus_session=')) return trimmed.slice('nexus_session='.length);
  }
  return undefined;
}

export async function validateRestSession(
  cookieHeader: string,
  store: NexusAuthStore<NexusAuthRecord>,
  onGetUser: (userId: string) => Promise<NexusUser | undefined>,
): Promise<ValidatedRestSession | undefined> {
  const token = parseSessionToken(cookieHeader);
  if (!token) return undefined;
  const record = await store.findBySessionToken(token);
  if (!record?.isEnabled) return undefined;
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  const user = await onGetUser(record.userId);
  if (!user) return undefined;
  return { user, token };
}
