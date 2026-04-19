import { describe, it, expect } from 'vitest';
import { defineAction, type SocketAPIAction } from './defineAction';

describe('defineAction', () => {
  it('returns an action with the given name', () => {
    const action = defineAction<{ id: string }, { success: boolean }>()('myAction');
    expect(action).toEqual({ name: 'myAction' });
    expect(action.name).toBe('myAction');
  });

  it('preserves type information for request and response', () => {
    const action = defineAction<{ query: string }, { results: string[] }>()('search');
    const typedAction: SocketAPIAction<'search', { query: string }, { results: string[] }> = action;
    expect(typedAction.name).toBe('search');
  });

  it('works with different action names', () => {
    const action1 = defineAction()('actionOne');
    const action2 = defineAction()('actionTwo');

    expect(action1.name).toBe('actionOne');
    expect(action2.name).toBe('actionTwo');
  });

  it('works with void request and response types', () => {
    const action = defineAction<void, void>()('noOp');
    expect(action).toEqual({ name: 'noOp' });
  });

  it('attaches server options when provided', () => {
    const action = defineAction<void, void>()('limited', {
      server: {
        concurrent: { max: 3 },
        queue: { max: 10, timeout: 5000 },
      },
    });
    expect(action).toEqual({
      name: 'limited',
      server: {
        concurrent: { max: 3 },
        queue: { max: 10, timeout: 5000 },
      },
    });
  });
});
