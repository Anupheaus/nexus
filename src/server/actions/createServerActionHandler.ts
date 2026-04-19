import type { SocketAPIAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { SocketAPIServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';

export type SocketAPIServerAction = () => void;

export function createServerActionHandler<Name extends string, Request, Response>(
  action: SocketAPIAction<Name, Request, Response>,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): SocketAPIServerAction {
  return createServerHandler('action', actionPrefix, action.name, handler, action.server, options?.isPublic ?? action.isPublic ?? false);
}
