import { Error } from '@anupheaus/common';
import { socketAPIAuthenticateTokenAction } from '../../common';
import { jwt } from '../jwt';
import { useLogger } from '../async-context';
import { useSocketAPI } from '../providers';
import { createServerActionHandler, type SocketAPIServerAction } from './createServerActionHandler';

const serverSocketAPIAuthenticateTokenAction = createServerActionHandler(socketAPIAuthenticateTokenAction, async token => {
  const { config: { onLoadPrivateKey, privateKey: privateKeyFromConfig }, getClient, setUser } = useSocketAPI();
  const logger = useLogger();
  const client = getClient(true);
  try {
    const untrustedUser = jwt.extractUntrustedUserFromToken(token);
    if (untrustedUser == null) return false;
    const privateKey = jwt.encodePrivateKey(privateKeyFromConfig) ?? await onLoadPrivateKey?.(client, untrustedUser);
    if (privateKey == null) return false;
    const user = jwt.extractUserFromToken(token, privateKey);
    if (user == null) return false;
    if (user.id !== untrustedUser.id) return false;
    await setUser(user);
    return true;
  } catch (error) {
    logger.error(new Error({ error }));
    return false;
  }
});

export function generateInternalActions(): SocketAPIServerAction[] {
  return [
    serverSocketAPIAuthenticateTokenAction,
  ];
}