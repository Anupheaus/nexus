import { describe, it, expect } from 'vitest';
import {
  actionPrefix,
  eventPrefix,
  subscriptionPrefix,
  type NexusSubscriptionRequest,
  type NexusSubscriptionResponse,
} from './internalModels';

describe('internalModels', () => {
  describe('prefix constants', () => {
    it('defines action prefix for namespacing', () => {
      expect(actionPrefix).toBe('nexus.actions');
    });

    it('defines event prefix for namespacing', () => {
      expect(eventPrefix).toBe('nexus.events');
    });

    it('defines subscription prefix for namespacing', () => {
      expect(subscriptionPrefix).toBe('nexus.subscriptions');
    });
  });

  describe('NexusSubscriptionRequest type', () => {
    it('subscribe variant has required fields', () => {
      const subscribeRequest: NexusSubscriptionRequest<{ id: string }> = {
        action: 'subscribe',
        request: { id: '123' },
        subscriptionId: 'sub-1',
      };
      expect(subscribeRequest.action).toBe('subscribe');
      expect(subscribeRequest.request).toEqual({ id: '123' });
      expect(subscribeRequest.subscriptionId).toBe('sub-1');
    });

    it('unsubscribe variant has required fields', () => {
      const unsubscribeRequest: NexusSubscriptionRequest = {
        action: 'unsubscribe',
        subscriptionId: 'sub-1',
      };
      expect(unsubscribeRequest.action).toBe('unsubscribe');
      expect(unsubscribeRequest.subscriptionId).toBe('sub-1');
    });
  });

  describe('NexusSubscriptionResponse type', () => {
    it('has subscriptionId and response fields', () => {
      const response: NexusSubscriptionResponse<{ data: string }> = {
        subscriptionId: 'sub-1',
        response: { data: 'value' },
      };
      expect(response.subscriptionId).toBe('sub-1');
      expect(response.response).toEqual({ data: 'value' });
    });

    it('allows undefined response', () => {
      const response: NexusSubscriptionResponse = {
        subscriptionId: 'sub-1',
        response: undefined,
      };
      expect(response.response).toBeUndefined();
    });
  });
});
