import { jwtDecode } from 'jwt-decode';
import type { NexusUser } from './models';
import { InternalError, is } from '@anupheaus/common';

function extractUntrustedUserFromToken(token: string): NexusUser | undefined {
  const data = jwtDecode(token) as { user: NexusUser; } | string;
  if (is.string(data) || !is.plainObject(data) || !('user' in data)) throw new InternalError('The format of the token is invalid.');
  const user = data.user;
  if (user == null || !is.guid(user.id)) return;
  return user;
}

export const jwt = {
  extractUntrustedUserFromToken,
};
