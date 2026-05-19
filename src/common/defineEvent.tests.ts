import { describe, it, expect } from 'vitest';
import { defineEvent, type NexusEvent } from './defineEvent';

describe('defineEvent', () => {
  it('returns an event with the given name', () => {
    const event = defineEvent<{ payload: string }>('myEvent');
    expect(event).toEqual({ name: 'myEvent' });
    expect(event.name).toBe('myEvent');
  });

  it('preserves type information for args', () => {
    interface Payload { userId: string; action: string; }
    const event = defineEvent<Payload>('userAction');
    const typedEvent: NexusEvent<Payload> = event;
    expect(typedEvent.name).toBe('userAction');
  });

  it('works with void/empty payload type', () => {
    const event = defineEvent<void>('emptyEvent');
    expect(event.name).toBe('emptyEvent');
  });

  it('works with different event names', () => {
    const event1 = defineEvent('eventOne');
    const event2 = defineEvent('eventTwo');

    expect(event1.name).toBe('eventOne');
    expect(event2.name).toBe('eventTwo');
  });
});
