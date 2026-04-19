import { describe, it, expect } from 'vitest';
import { socketAPIUserChanged } from './internalEvents';
import type { SocketAPIUserChangedEventPayload } from './internalEvents';
import type { SocketAPIEvent } from './defineEvent';

describe('socketAPIUserChanged', () => {
  it('is a SocketAPIEvent with the correct event name', () => {
    const event: SocketAPIEvent<SocketAPIUserChangedEventPayload> = socketAPIUserChanged;
    expect(event).toBeDefined();
    expect(event.name).toBe('socketAPIUserChanged');
  });
});
