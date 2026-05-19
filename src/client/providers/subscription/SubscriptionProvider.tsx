import { createComponent, useBound, useLogger, useMap, useOnMount, useSet, useSubscriptionProvider } from '@anupheaus/react-ui';
import { type ReactNode } from 'react';
import type { SubscriptionRequest } from './Subscription';
import { Subscription } from './Subscription';
import { useSocket } from '../socket';
import { subscriptionPrefix, type SocketAPISubscriptionRequest, type SocketAPISubscriptionResponse } from '../../../common/internalModels';

interface Props {
  children?: ReactNode;
}

export const SubscriptionProvider = createComponent('SubscriptionProvider', ({
  children = null,
}: Props) => {
  const logger = useLogger();
  const { invoke, Provider } = useSubscriptionProvider(Subscription);
  const { on, emit, getIsConnected, onConnected } = useSocket();
  const subscriptionsAlreadyListeningTo = useSet<string>();
  const hashToSubscriptionName = useMap<string, string>();
  const subscriptionRegistrations = useMap<string, () => Promise<void>>();

  useOnMount(() => {
    onConnected(() => subscriptionRegistrations.toValuesArray().mapAsync(registerSubscriptionOnServer => registerSubscriptionOnServer())
      .catch(err => {
        // When the socket drops during re-registration (e.g. server restart),
        // mapAsync collects "socket has been disconnected" errors and throws.
        // This is expected — the next onConnected will re-register successfully.
        logger.warn('Subscription re-registration failed on reconnect (will retry on next connect)', {
          error: (err as any)?.message ?? String(err),
        });
      }));
  });

  const listenForUpdatesFor = (subscriptionName: string) => {
    if (subscriptionsAlreadyListeningTo.has(subscriptionName)) return;
    subscriptionsAlreadyListeningTo.add(subscriptionName);
    logger.silly('Listening for updates for subscription', { subscriptionName });
    on<SocketAPISubscriptionResponse>(`${subscriptionPrefix}.${subscriptionName}`, ({ response, subscriptionId }) => invoke(response, subscriptionId));
  };

  const onSubscribed = useBound(async (_hookId: string, { subscriptionName, request }: SubscriptionRequest, _callback: (response: unknown) => void, hash?: string, hashIsNew?: boolean, _debug?: boolean) => {
    if (hash == null) return;
    if (hashIsNew !== true) return;
    hashToSubscriptionName.set(hash, subscriptionName);
    listenForUpdatesFor(subscriptionName);
    const registerSubscriptionOnServer = async () => {
      logger.silly('Subscribing to subscription', { subscriptionName, hash, request });
      const { response, subscriptionId } = await emit<SocketAPISubscriptionResponse, SocketAPISubscriptionRequest>(`${subscriptionPrefix}.${subscriptionName}`, {
        request, action: 'subscribe', subscriptionId: hash
      });
      logger.silly('Immediate response from server being invoked', { subscriptionName, hash, request, response, subscriptionId });
      if (response !== undefined) {
        await invoke(response, subscriptionId, true);
      }
    };
    subscriptionRegistrations.set(hash, registerSubscriptionOnServer);
    if (getIsConnected()) await registerSubscriptionOnServer();
  });

  const onUnsubscribed = useBound(async (_hookId: string, hash?: string, hashDestroyed?: boolean) => {
    if (hash == null || hashDestroyed !== true) return;
    const subscriptionName = hashToSubscriptionName.get(hash);
    if (subscriptionName == null) return;
    hashToSubscriptionName.delete(hash);
    logger.silly('Unsubscribing from subscription', { subscriptionName, hash });
    if (!getIsConnected()) return;
    await emit<SocketAPISubscriptionResponse, SocketAPISubscriptionRequest>(`${subscriptionPrefix}.${subscriptionName}`, { action: 'unsubscribe', subscriptionId: hash });
  });

  return (
    <Provider onSubscribed={onSubscribed} onUnsubscribed={onUnsubscribed}>
      {children}
    </Provider>
  );
});
