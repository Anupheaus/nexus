import { createSubscription } from '@anupheaus/react-ui';

export interface SubscriptionRequest<Request = unknown> {
  subscriptionName: string;
  request: Request;
}


export const Subscription = createSubscription<SubscriptionRequest, unknown>({
  onSubscribingCallbackAction: 'callWithLastPayload',
});