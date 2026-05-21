import type { NexusAction } from '../../common';
import { throwIfAckError } from '../../common/ackResponse';
import { actionPrefix } from '../../common/internalModels';
import { useClient } from '../providers';

/**
 * Server-side counterpart to client `useAction` from `@anupheaus/nexus/client`: call inside an action/subscription handler
 * (or any code running with nexus context). Returns a function that invokes the named action **on the connected client**
 * and resolves with its response.
 */
export function useAction<Name extends string, Request, Response>(action: NexusAction<Name, Request, Response>) {
  const client = useClient();

  return async (request: Request): Promise<Response> => {
    if (client == null) throw new Error('useAction requires an active client connection');
    const raw = await client.emitWithAck(`${actionPrefix}.${action.name}`, request);
    return throwIfAckError(raw);
  };
}
