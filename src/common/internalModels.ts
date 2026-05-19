export const actionPrefix = 'nexus.actions';
export const eventPrefix = 'nexus.events';
export const subscriptionPrefix = 'nexus.subscriptions';

export type SocketAPISubscriptionRequest<Request = unknown> = {
  request: Request;
  action: 'subscribe';
  subscriptionId: string;
} | {
  action: 'unsubscribe';
  subscriptionId: string;
};

export interface SocketAPISubscriptionResponse<Response = unknown> {
  subscriptionId: string;
  response: Response | undefined;
}
