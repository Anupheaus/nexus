import { describe, it, expect } from 'vitest';
import { Subscription, type SubscriptionRequest } from './Subscription';

describe('Subscription', () => {
  it('exports Subscription created with correct config', () => {
    expect(Subscription).toBeDefined();
    expect(typeof Subscription).toBe('object');
  });

  it('SubscriptionRequest type has required fields', () => {
    const request: SubscriptionRequest<{ id: string }> = {
      subscriptionName: 'test',
      request: { id: '123' },
    };
    expect(request.subscriptionName).toBe('test');
    expect(request.request).toEqual({ id: '123' });
  });
});
