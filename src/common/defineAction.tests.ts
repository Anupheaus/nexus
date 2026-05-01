import { describe, it, expect } from 'vitest';
import { defineAction } from './defineAction';

describe('defineAction — transport field', () => {
  it('stores transport on the action when provided', () => {
    const action = defineAction<void, void>()('myAction', { transport: ['rest'] });
    expect(action.transport).toEqual(['rest']);
  });

  it('leaves transport undefined when not provided', () => {
    const action = defineAction<void, void>()('myAction2');
    expect(action.transport).toBeUndefined();
  });

  it('accepts both transports', () => {
    const action = defineAction<void, void>()('myAction3', { transport: ['socket', 'rest'] });
    expect(action.transport).toEqual(['socket', 'rest']);
  });

  it('throws when rest config is provided but transport excludes rest', () => {
    expect(() =>
      defineAction<void, void>()('myAction4', {
        rest: { method: 'GET', url: '/foo' },
        transport: ['socket'],
      })
    ).toThrow('cannot have a rest config when transport excludes');
  });
});
