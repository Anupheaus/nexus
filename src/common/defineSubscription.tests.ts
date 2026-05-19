import { describe, it, expect } from 'vitest';
import { defineSubscription, type NexusSubscription } from './defineSubscription';

describe('defineSubscription', () => {
  it('returns a subscription with the given name', () => {
    const subscription = defineSubscription<{ query: string }, { data: string[] }>()('mySubscription');
    expect(subscription).toEqual({ name: 'mySubscription' });
    expect(subscription.name).toBe('mySubscription');
  });

  it('preserves type information for request and response', () => {
    const subscription = defineSubscription<{ id: string }, { value: number }>()('getValue');
    const typedSub: NexusSubscription<'getValue', { id: string }, { value: number }> = subscription;
    expect(typedSub.name).toBe('getValue');
  });

  it('works with different subscription names', () => {
    const sub1 = defineSubscription()('subOne');
    const sub2 = defineSubscription()('subTwo');

    expect(sub1.name).toBe('subOne');
    expect(sub2.name).toBe('subTwo');
  });

  it('works with void request and response types', () => {
    const subscription = defineSubscription<void, void>()('notify');
    expect(subscription).toEqual({ name: 'notify' });
  });
});
