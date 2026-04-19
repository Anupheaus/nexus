import { socketAPIAuthenticateTokenAction } from '../../common';
import { createServerActionHandler, type SocketAPIServerAction } from './createServerActionHandler';

const serverSocketAPIAuthenticateTokenAction = createServerActionHandler(socketAPIAuthenticateTokenAction, async () => {
  return false;
}, { isPublic: true });

export function generateInternalActions(): SocketAPIServerAction[] {
  return [
    serverSocketAPIAuthenticateTokenAction,
  ];
}
