import type { NexusSubscription } from '../../common';
import type { Subscription as ReactUISubscription } from '@anupheaus/react-ui';
import { useBound, useLogger, useSubscription as useReactUISubscription } from '@anupheaus/react-ui';
import type { SubscriptionRequest } from '../providers';
import { Subscription } from '../providers';


export function useSubscription<Name extends string, Request, Response>(subscription: NexusSubscription<Name, Request, Response>) {
  const logger = useLogger();
  const { subscribe: reactUISubscribe, unsubscribe, onCallback } = useReactUISubscription(Subscription as unknown as ReactUISubscription<SubscriptionRequest<Request>, Response>);

  const subscribe = useBound((request: Request, customHash?: string) => {
    logger.silly('Subscribing to subscription', { subscriptionName: subscription.name, request, customHash });
    return reactUISubscribe({ request, subscriptionName: subscription.name }, customHash ?? Object.hash({ subscriptionName: subscription.name, request }));
  });

  return {
    subscribe,
    unsubscribe,
    onCallback,
  };
}
