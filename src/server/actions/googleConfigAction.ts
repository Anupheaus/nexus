import { googleOAuthConfigAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';

export function createGoogleConfigAction(clientId: string): NexusServerAction {
  return createServerActionHandler(
    googleOAuthConfigAction,
    async () => ({ clientId }),
    { isPublic: true },
  );
}
