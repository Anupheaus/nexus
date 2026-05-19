import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
// Must be hoisted so vi.mock factory closures can reference them.

const { mockIo, mockSetClient } = vi.hoisted(() => {
  const mockIo = {
    on: vi.fn(),
    engine: { use: vi.fn() },
    use: vi.fn(),
  };
  return { mockIo, mockSetClient: vi.fn() };
});

vi.mock('./createServerSocket', () => ({ createServerSocket: vi.fn(() => mockIo) }));

// wrap: when called as wrap(scopeSelector, fn) or wrap(object, fn), return fn so the
// connection handler registered on the socket is the raw delegate — testable directly.
// When called as wrap(fn) (single-arg form used for server 'listening'/'close'), also return fn.
vi.mock('../../async-context', () => ({
  setClient: mockSetClient,
  wrap: vi.fn((...args: unknown[]) => {
    // Two-arg form: wrap(scopeSelector | object, delegate) → return delegate
    if (args.length >= 2 && typeof args[1] === 'function') return args[1];
    // Single-arg form: wrap(delegate) → return delegate
    if (args.length >= 1 && typeof args[0] === 'function') return args[0];
    return undefined;
  }),
}));

vi.mock('../authentication', () => ({
  useAuthentication: vi.fn(() => ({ user: null })),
}));

// ── helpers ────────────────────────────────────────────────────────────────────

function makeConnection() {
  return {
    openWebSocket: vi.fn(),
    closeWebSocket: vi.fn(),
  };
}

function makeRegistry(connection = makeConnection()) {
  return {
    fromSocket: vi.fn(() => connection),
    fromRequest: vi.fn(),
    connection,
  };
}

function makeServer() {
  return {
    on: vi.fn(),
    address: vi.fn(() => ({ port: 3000 })),
  };
}

function makeLogger() {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    silly: vi.fn(),
    always: vi.fn(),
    createSubLogger: vi.fn(function () { return logger; }),
  };
  return logger;
}

function makeClient(id = 'client-1') {
  const handlers: Record<string, Function> = {};
  const client = {
    id,
    request: { headers: { 'user-agent': 'test-ua', 'accept-language': 'en' } },
    handshake: { address: '127.0.0.1' },
    on: vi.fn((event: string, fn: Function) => { handlers[event] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
    _handlers: handlers,
  };
  return client as unknown as Socket & { _handlers: Record<string, Function> };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('setupSocket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns onClientConnected and io', async () => {
    const { setupSocket } = await import('./setupSocket');
    const result = setupSocket('api', makeServer() as never, makeLogger() as never, undefined, makeRegistry() as never);
    expect(typeof result.onClientConnected).toBe('function');
    expect(result.io).toBe(mockIo);
  });

  it('calls createServerSocket with the configured name', async () => {
    const { createServerSocket } = await import('./createServerSocket');
    const { setupSocket } = await import('./setupSocket');
    setupSocket('my-api', makeServer() as never, makeLogger() as never, undefined, makeRegistry() as never);
    expect(createServerSocket).toHaveBeenCalledWith('my-api', expect.anything(), expect.anything());
  });

  it('registers a connection handler on the socket', async () => {
    const { setupSocket } = await import('./setupSocket');
    setupSocket('api', makeServer() as never, makeLogger() as never, undefined, makeRegistry() as never);
    expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('opens the web socket when a client connects', async () => {
    const { setupSocket } = await import('./setupSocket');
    const connection = makeConnection();
    const registry = makeRegistry(connection);
    setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    expect(connectionCall).toBeDefined();
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    expect(connection.openWebSocket).toHaveBeenCalled();
  });

  it('calls setClient with the connected socket', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient('client-abc');
    await connectionHandler(client);

    expect(mockSetClient).toHaveBeenCalledWith(client);
  });

  it('creates a sub-logger scoped to the client id on connect', async () => {
    const { setupSocket } = await import('./setupSocket');
    const logger = makeLogger();
    const registry = makeRegistry();
    setupSocket('api', makeServer() as never, logger as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient('client-xyz');
    await connectionHandler(client);

    expect(logger.createSubLogger).toHaveBeenCalledWith('client-xyz', expect.objectContaining({
      globalMeta: expect.objectContaining({ clientId: 'client-xyz' }),
    }));
  });

  it('calls onClientConnected callbacks when a client connects', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    const { onClientConnected } = setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const callback = vi.fn(() => undefined);
    onClientConnected(callback);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    expect(callback).toHaveBeenCalledWith({ client });
  });

  it('does not invoke callbacks registered after a client has already connected', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    const { onClientConnected } = setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    // Registered after the connection event fires
    const lateCallback = vi.fn(() => undefined);
    onClientConnected(lateCallback);

    expect(lateCallback).not.toHaveBeenCalled();
  });

  it('invokes all registered onClientConnected callbacks, not just the first', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    const { onClientConnected } = setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const first = vi.fn(() => undefined);
    const second = vi.fn(() => undefined);
    onClientConnected(first);
    onClientConnected(second);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    await connectionHandler(makeClient());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('registers a disconnect handler on the client socket during connection', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    expect(client.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('closes the web socket when a client disconnects', async () => {
    const { setupSocket } = await import('./setupSocket');
    const connection = makeConnection();
    const registry = makeRegistry(connection);
    setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    const disconnectHandler = (client as never as { _handlers: Record<string, Function> })._handlers['disconnect'];
    expect(disconnectHandler).toBeDefined();
    await disconnectHandler();

    expect(connection.closeWebSocket).toHaveBeenCalled();
  });

  it('does not call closeWebSocket before a client has disconnected', async () => {
    const { setupSocket } = await import('./setupSocket');
    const connection = makeConnection();
    const registry = makeRegistry(connection);
    setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    // Disconnect has not been triggered yet
    expect(connection.closeWebSocket).not.toHaveBeenCalled();
  });

  it('disconnect callbacks from onClientConnected are called after disconnect fires', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    const { onClientConnected } = setupSocket('api', makeServer() as never, makeLogger() as never, undefined, registry as never);

    const disconnectCb = vi.fn();
    // onClientConnected callback returns a disconnect callback
    onClientConnected(vi.fn(() => disconnectCb));

    const connectionCall = mockIo.on.mock.calls.find(([event]) => event === 'connection');
    const connectionHandler = connectionCall![1] as Function;
    const client = makeClient();
    await connectionHandler(client);

    // Simulate disconnect
    const disconnectHandler = (client as never as { _handlers: Record<string, Function> })._handlers['disconnect'];
    await disconnectHandler();

    expect(disconnectCb).toHaveBeenCalledWith(client);
  });
});
