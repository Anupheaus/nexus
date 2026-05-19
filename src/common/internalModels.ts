export const actionPrefix = 'nexus.actions';
export const eventPrefix = 'nexus.events';
export const subscriptionPrefix = 'nexus.subscriptions';

export type NexusSubscriptionRequest<Request = unknown> = {
  request: Request;
  action: 'subscribe';
  subscriptionId: string;
} | {
  action: 'unsubscribe';
  subscriptionId: string;
};

export interface NexusSubscriptionResponse<Response = unknown> {
  subscriptionId: string;
  response: Response | undefined;
}
