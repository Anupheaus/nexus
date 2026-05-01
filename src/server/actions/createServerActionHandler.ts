import type { SocketAPIAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { SocketAPIServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';
import { createActionLimitGate } from '../handler/actionLimitGate';
import type { ActionLimitGate } from '../handler/actionLimitGate';

export interface RestActionRegistryEntry {
  action: SocketAPIAction<string, unknown, unknown>;
  handler: SocketAPIServerHandlerFunction<unknown, unknown>;
  limitGate: ActionLimitGate;
}

export interface SocketAPIServerAction {
  registerSocket(): void;
  restEntry: RestActionRegistryEntry;
}

export function createServerActionHandler<Name extends string, Request, Response>(
  action: SocketAPIAction<Name, Request, Response>,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): SocketAPIServerAction {
  const isPublic = options?.isPublic ?? action.isPublic ?? false;
  const limitGate = createActionLimitGate(action.server);
  const socketHandler = createServerHandler('action', actionPrefix, action.name, handler, action.server, isPublic, limitGate, action.transport);
  return {
    registerSocket: socketHandler.registerSocket,
    restEntry: { action, handler, limitGate } as RestActionRegistryEntry,
  };
}
