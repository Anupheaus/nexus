import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── hoisted mock references ────────────────────────────────────────────────
const { mockLoggerInst, mockClientInst, mockLimitGateInst } = vi.hoisted(() => {
  const mockLoggerInst = { silly: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const mockClientInst = { on: vi.fn() };
  const mockLimitGateInst = { run: vi.fn(async (fn: () => unknown) => fn()) };
  return { mockLoggerInst, mockClientInst, mockLimitGateInst };
});

vi.mock('../async-context/nexusContext', () => ({
  useLogger: vi.fn(() => mockLoggerInst),
  useConfig: vi.fn(() => ({})),
  wrap: vi.fn((_ctx: unknown, fn: Function) => fn),
}));

vi.mock('../providers', () => ({
  useClient: vi.fn(() => mockClientInst),
}));

vi.mock('../providers/authentication', () => ({
  useAuthentication: vi.fn(() => ({ user: null })),
}));

vi.mock('./actionLimitGate', () => ({
  createActionLimitGate: vi.fn(() => mockLimitGateInst),
}));

vi.mock('./handlerUtils', () => ({
  createSocketHandlerUtils: vi.fn(() => ({})),
}));

vi.mock('../../common/ackResponse', () => ({
  wrapAckHandler: vi.fn(async (fn: () => unknown) => fn()),
  getErrorFromAckResponse: vi.fn((result: unknown) => {
    if (result != null && typeof result === 'object' && 'error' in result) {
      return { error: (result as { error: unknown }).error, response: null };
    }
    return { response: result, error: null };
  }),
}));

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

describe('createServerHandler — socket dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockClientInst.on.mockReset();
    mockLimitGateInst.run.mockImplementation(async (fn: () => unknown) => fn());
  });

  async function makeHandler(
    name: string,
    handler: Function,
    opts: { isPublic?: boolean; transport?: Array<'socket' | 'rest'> } = {},
  ) {
    const { createServerHandler } = await import('./createServerHandler');
    const h = createServerHandler('action', 'test', name, handler as any, undefined, opts.isPublic ?? false, undefined, opts.transport);
    h.registerSocket();
    const [eventName, socketHandler] = mockClientInst.on.mock.calls[0];
    return { eventName, socketHandler };
  }

  it('registers the handler on the correct full event name', async () => {
    const { eventName } = await makeHandler('myAction', vi.fn(async () => 'ok'));
    expect(eventName).toBe('test.myAction');
  });

  it('calls the user handler and returns the result via response callback', async () => {
    const userHandler = vi.fn(async (req: { id: string }) => ({ name: req.id }));
    const { socketHandler } = await makeHandler('dispatchAction', userHandler);
    const response = vi.fn();
    await socketHandler({ id: 'abc' }, response);
    expect(userHandler).toHaveBeenCalledWith({ id: 'abc' }, expect.anything());
    expect(response).toHaveBeenCalled();
  });

  it('rejects socket calls to REST-only actions before invoking the handler', async () => {
    const userHandler = vi.fn();
    const { socketHandler } = await makeHandler('restOnly', userHandler, { transport: ['rest'] });
    const response = vi.fn();
    await socketHandler({ x: 1 }, response);
    expect(userHandler).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
  });
});
