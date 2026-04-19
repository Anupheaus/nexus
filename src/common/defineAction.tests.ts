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

  it('returns action with name and no rest field when not specified', () => {
    const action = defineAction<{ id: string }, { name: string }>()('getUser');
    expect(action.name).toBe('getUser');
    expect(action.rest).toBeUndefined();
  });

  it('returns action with rest field when specified', () => {
    const action = defineAction<{ id: string }, { name: string }>()('getUser', {
      rest: { method: 'GET', url: '/users/:id' },
    });
    expect(action.rest).toEqual({ method: 'GET', url: '/users/:id' });
  });

  it('throws when action name contains a slash', () => {
    expect(() => defineAction<void, void>()('my/action')).toThrow(
      'Action name "my/action" must not contain a slash',
    );
  });

  it('does not throw for action name with dots or hyphens', () => {
    expect(() => defineAction<void, void>()('user.create')).not.toThrow();
    expect(() => defineAction<void, void>()('user-create')).not.toThrow();
  });
});
