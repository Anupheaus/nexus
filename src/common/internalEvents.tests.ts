import { describe, it, expect } from 'vitest';
import { socketAPIUserChanged } from './internalEvents';

describe('socketAPIUserChanged', () => {
  it('is defined and has the correct event name', () => {
    expect(socketAPIUserChanged).toBeDefined();
    expect((socketAPIUserChanged as any).name ?? (socketAPIUserChanged as any).eventName ?? String(socketAPIUserChanged))
      .toContain('socketAPIUserChanged');
  });
});
