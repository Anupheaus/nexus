import { describe, it, expect } from 'vitest';
import { socketAPIUserChanged } from './internalEvents';
import type { NexusUserChangedEventPayload } from './internalEvents';
import type { NexusEvent } from './defineEvent';

describe('socketAPIUserChanged', () => {
  it('is a NexusEvent with the correct event name', () => {
    const event: NexusEvent<NexusUserChangedEventPayload> = socketAPIUserChanged;
    expect(event).toBeDefined();
    expect(event.name).toBe('socketAPIUserChanged');
  });
});
