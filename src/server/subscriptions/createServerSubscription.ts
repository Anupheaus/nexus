import type { SocketAPISubscription } from '../../common';
import type { SocketAPISubscriptionRequest, SocketAPISubscriptionResponse } from '../../common/internalModels';
import { subscriptionPrefix } from '../../common/internalModels';
import { createServerHandler } from '../handler';
import { useClient } from '../providers';
import { InternalError } from '@anupheaus/common';
import type { PromiseMaybe } from '@anupheaus/common';

export type SocketAPIServerSubscriptionAction = 'subscribe' | 'unsubscribe';

export interface SocketAPIServerSubscriptionHandlerParameters<Request, Response> {
  request: Request;
  subscriptionId: string;
  update(response: Response): void;
  onUnsubscribe(handler: () => void): void;
}

// Subscription handlers receive only the params object — they don't need the REST utils
// (setCookie, redirect, etc.) that action handlers use.
export type SocketAPIServerSubscriptionHandler<Request, Response> = (
  params: SocketAPIServerSubscriptionHandlerParameters<Request, Response>,
) => PromiseMaybe<Response>;

export interface SocketAPIServerSubscription {
  registerSocket(): void;
}

// Keyed as `${socketId}:${subscriptionId}` so each client owns its own handlers.
// This prevents a malicious client from unsubscribing another client's subscription.
const onUnsubscribeHandlers = new Map<string, () => void>();

function makeHandlerKey(socketId: string, subscriptionId: string): string {
  return `${socketId}:${subscriptionId}`;
}

/** Called when a socket disconnects — cleans up all active subscription handlers for that socket. */
export function cleanupSocketSubscriptions(socketId: string): void {
  const prefix = `${socketId}:`;
  for (const key of Array.from(onUnsubscribeHandlers.keys())) {
    if (key.startsWith(prefix)) {
      try { onUnsubscribeHandlers.get(key)?.(); } catch { /* ignore errors during cleanup */ }
      onUnsubscribeHandlers.delete(key);
    }
  }
}

/**
 * Registers a streaming subscription handler for a given subscription contract.
 *
 * Called when a client subscribes. The handler receives `{ request, subscriptionId, update,
 * onUnsubscribe }` and must return the initial response value. Call `update(response)` at any
 * time to push a new value to the client. Register cleanup logic via `onUnsubscribe`.
 *
 * Subscription state is keyed by `socketId:subscriptionId`, so each client fully owns its
 * handlers — a client cannot unsubscribe another client's subscription.
 *
 * @param subscription - Contract created by `defineSubscription`.
 * @param handler - Starts the stream and returns the initial value; called on each subscribe.
 */
export function createServerSubscription<Name extends string, Request, Response>(subscription: SocketAPISubscription<Name, Request, Response>,
  handler: SocketAPIServerSubscriptionHandler<Request, Response>): SocketAPIServerSubscription {
  return createServerHandler<SocketAPISubscriptionRequest<Request>, SocketAPISubscriptionResponse<Response>>('subscription', subscriptionPrefix,
    subscription.name, async props => {
      const client = useClient();
      if (client == null) throw new InternalError('Socket client is not available in subscription handler');
      const socketId = client.id;

      switch (props.action) {
        case 'subscribe': {
          const { request, subscriptionId } = props;
          const key = makeHandlerKey(socketId, subscriptionId);
          const update = async (response: Response) => {
            await client.emitWithAck(`${subscriptionPrefix}.${subscription.name}`, { subscriptionId, response });
          };
          const onUnsubscribe = (unsubscribeHandler: () => void) => onUnsubscribeHandlers.set(key, unsubscribeHandler);
          const response = await handler({ request, subscriptionId, update, onUnsubscribe });
          return { subscriptionId, response };
        }

        case 'unsubscribe': {
          const { subscriptionId } = props;
          const key = makeHandlerKey(socketId, subscriptionId);
          const unsubscribeHandler = onUnsubscribeHandlers.get(key);
          if (unsubscribeHandler == null) throw new Error(`Unsubscribe handler not found for subscription ${subscription.name} with id ${subscriptionId}.`);
          unsubscribeHandler();
          onUnsubscribeHandlers.delete(key);
          return { subscriptionId, response: undefined };
        }
      }
    }, undefined, subscription.isPublic ?? false);
}
