import type { NexusAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { NexusServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';
import { createActionLimitGate } from '../handler/actionLimitGate';
import type { ActionLimitGate } from '../handler/actionLimitGate';
import { RateLimiter } from '../security/RateLimiter';

export interface RestActionRegistryEntry {
  action: NexusAction<string, unknown, unknown>;
  handler: NexusServerHandlerFunction<unknown, unknown>;
  limitGate: ActionLimitGate;
  /** Per-IP REST rate limiter, present only when the action declares `server.rateLimit`. */
  rateLimiter?: RateLimiter;
  /** Message returned in the 429 body when `rateLimiter` rejects a request. */
  rateLimitMessage?: string;
}

export interface NexusServerAction {
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
  action: NexusAction<Name, Request, Response>,
  handler: NexusServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): NexusServerAction {
  const isPublic = options?.isPublic ?? action.isPublic ?? false;
  const limitGate = createActionLimitGate(action.server);
  const socketHandler = createServerHandler('action', actionPrefix, action.name, handler, action.server, isPublic, limitGate, action.transport);
  // Per-IP REST rate limiter — one instance per action, created only when the action opts in.
  const rateLimit = action.server?.rateLimit;
  const rateLimiter = rateLimit != null ? new RateLimiter(rateLimit.maxRequests, rateLimit.windowMs) : undefined;
  return {
    registerSocket: socketHandler.registerSocket,
    restEntry: {
      action, handler, limitGate, rateLimiter,
      rateLimitMessage: rateLimit?.message ?? 'Too many requests, please slow down.',
    } as RestActionRegistryEntry,
  };
}
