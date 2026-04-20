import React, { useState } from 'react';
import { useSubscription } from '../../../../src/client/hooks/useSubscription';
import { counterSubscription } from '../../../playwright/server/contracts';

export function SubscriptionSection() {
  const { subscribe, unsubscribe, onCallback } = useSubscription(counterSubscription);
  const [count, setCount] = useState<number | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  onCallback(value => setCount(value));

  const handleSubscribe = () => {
    subscribe(undefined);
    setSubscribed(true);
  };

  const handleUnsubscribe = () => {
    unsubscribe();
    setSubscribed(false);
  };

  return (
    <section>
      <h2>Subscriptions</h2>
      <button data-testid="subscribe-btn" onClick={handleSubscribe} disabled={subscribed}>Subscribe</button>
      <button data-testid="unsubscribe-btn" onClick={handleUnsubscribe} disabled={!subscribed}>Unsubscribe</button>
      <div data-testid="subscription-status">{subscribed ? 'subscribed' : 'unsubscribed'}</div>
      <div data-testid="counter-value">{count !== null ? String(count) : ''}</div>
    </section>
  );
}
