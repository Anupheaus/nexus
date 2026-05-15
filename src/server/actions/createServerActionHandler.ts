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

/**
 * Registers a typed request/response handler for a given action contract.
 *
 * Invoked when a client calls the action via socket or REST (if configured on the action).
 * Errors thrown inside the handler are caught and returned to the caller as `{ error }`.
 *
 * Unauthenticated clients are rejected by default — set `isPublic: true` in options or on the
 * action definition to allow unauthenticated access.
 *
 * @param action - Contract created by `defineAction`.
 * @param handler - Receives the typed request and must return the typed response (or throw).
 * @param options - Optional per-handler overrides; `isPublic` takes precedence over the action's
 *   own `isPublic` flag when provided.
 */
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
