import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('createServerHandler', () => {
  const mockHandler = vi.fn(async (req: { id: string }) => ({ result: req.id }));

  beforeEach(() => {
    vi.resetModules();
  });

  it('returns an object with a registerSocket method', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const handler = createServerHandler('action', 'test.prefix', 'uniqueAction1', mockHandler);
    expect(typeof handler.registerSocket).toBe('function');
  });

  it('throws when same handler is registered twice', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    createServerHandler('action', 'test.prefix', 'duplicateAction', mockHandler);
    expect(() =>
      createServerHandler('action', 'test.prefix', 'duplicateAction', mockHandler)
    ).toThrow("Handler for action 'test.prefix.duplicateAction' already registered");
  });

  it('allows different handler names with same prefix', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const reg1 = createServerHandler('action', 'test.prefix', 'actionOne', mockHandler);
    const reg2 = createServerHandler('action', 'test.prefix', 'actionTwo', mockHandler);
    expect(typeof reg1.registerSocket).toBe('function');
    expect(typeof reg2.registerSocket).toBe('function');
  });

  it('accepts an optional transport parameter without errors', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const handler = createServerHandler('action', 'test.prefix', 'restOnlyAction1', mockHandler, undefined, false, undefined, ['rest']);
    expect(typeof handler.registerSocket).toBe('function');
  });
});
