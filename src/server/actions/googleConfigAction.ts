import { googleOAuthConfigAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';

export function createGoogleConfigAction(clientId: string): SocketAPIServerAction {
  return createServerActionHandler(
    googleOAuthConfigAction,
    async () => ({ clientId }),
    { isPublic: true },
  );
}
