import type { SocketAPIAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { SocketAPIServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';
import { createActionLimitGate } from '../handler/actionLimitGate';
import { registerRestAction } from './restActionRegistry';

export type SocketAPIServerAction = () => void;

export function createServerActionHandler<Name extends string, Request, Response>(
  action: SocketAPIAction<Name, Request, Response>,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): SocketAPIServerAction {
  const isPublic = options?.isPublic ?? action.isPublic ?? false;
  const limitGate = createActionLimitGate(action.server);
  registerRestAction(action, handler, limitGate);
  return createServerHandler('action', actionPrefix, action.name, handler, action.server, isPublic, limitGate);
}
