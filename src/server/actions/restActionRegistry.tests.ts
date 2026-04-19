import { describe, it, expect, beforeEach } from 'vitest';
import { registerRestAction, getRestAction, getAllRestActions, clearRestActionRegistry } from './restActionRegistry';
import type { SocketAPIAction } from '../../common';
import type { ActionLimitGate } from '../handler/actionLimitGate';

const makeLimitGate = (): ActionLimitGate => ({ run: async (fn) => fn() });

describe('restActionRegistry', () => {
  beforeEach(() => clearRestActionRegistry());

  it('returns undefined for unknown action', () => {
    expect(getRestAction('unknown')).toBeUndefined();
  });

  it('returns entry after registration', () => {
    const action: SocketAPIAction<'getUser', { id: string }, { name: string }> = { name: 'getUser' };
    const handler = async () => ({ name: 'Alice' });
    const limitGate = makeLimitGate();
    registerRestAction(action, handler, limitGate);
    const entry = getRestAction('getUser');
    expect(entry).toBeDefined();
    expect(entry!.action.name).toBe('getUser');
    expect(entry!.handler).toBe(handler);
    expect(entry!.limitGate).toBe(limitGate);
  });

  it('getAllRestActions returns all registered entries', () => {
    const a1: SocketAPIAction<'a1', void, void> = { name: 'a1' };
    const a2: SocketAPIAction<'a2', void, void> = { name: 'a2' };
    registerRestAction(a1, async () => {}, makeLimitGate());
    registerRestAction(a2, async () => {}, makeLimitGate());
    expect(getAllRestActions()).toHaveLength(2);
  });

  it('clearRestActionRegistry empties the registry', () => {
    const action: SocketAPIAction<'x', void, void> = { name: 'x' };
    registerRestAction(action, async () => {}, makeLimitGate());
    clearRestActionRegistry();
    expect(getRestAction('x')).toBeUndefined();
    expect(getAllRestActions()).toHaveLength(0);
  });
});
