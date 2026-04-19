import type { SocketAPIAction } from '../../common';
import { throwIfAckError } from '../../common/ackResponse';
import { actionPrefix } from '../../common/internalModels';
import { useSocketAPI } from '../providers';

/**
 * Server-side counterpart to client `useAction` from `@anupheaus/socket-api/client`: call inside an action/subscription handler
 * (or any code running with {@link useSocketAPI} context). Returns a function that invokes the named action **on the connected client**
 * and resolves with its response.
 */
export function useAction<Name extends string, Request, Response>(action: SocketAPIAction<Name, Request, Response>) {
  const { getClient } = useSocketAPI();

  return async (request: Request): Promise<Response> => {
    const client = getClient(true);
    const raw = await client.emitWithAck(`${actionPrefix}.${action.name}`, request);
    return throwIfAckError(raw);
  };
}
