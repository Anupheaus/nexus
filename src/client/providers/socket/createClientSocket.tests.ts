import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClientSocket } from './createClientSocket';

// ---------------------------------- helpers ----------------------------------

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  silly: vi.fn(),
  provide: vi.fn((fn: () => unknown) => fn()),
};

/** Minimal TokenStorage stub. */
function makeTokenStorage(overrides?: {
  get?: (key: string) => Promise<string | null>;
  set?: (key: string, value: string) => Promise<void>;
  remove?: (key: string) => Promise<void>;
}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Invoke the auth provider captured from the socket options.
 * When tokenStorage is provided, createClientSocket sets auth to a callback
 * function `(cb) => void`; this helper calls it and returns the value passed
 * to `cb` as a promise so tests can await it cleanly.
 */
async function resolveAuthProvider(socket: ReturnType<typeof createClientSocket>): Promise<object> {
  const authOption = (socket.io.opts as Record<string, unknown>).auth;
  if (typeof authOption === 'function') {
    return new Promise<object>(resolve => authOption(resolve));
  }
  return authOption as object;
}

/** Simulate the server emitting an event on the socket. */
function emitOnSocket(socket: ReturnType<typeof createClientSocket>, event: string, ...args: unknown[]): void {
  // socket.io-client exposes listeners via socket.listeners(event).
  const listeners = socket.listeners(event) as Array<(...a: unknown[]) => void>;
  listeners.forEach(listener => listener(...args));
}

// ---------------------------------- setup ------------------------------------

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('window', { location: { hostname: 'localhost', host: 'localhost', protocol: 'https:' } });
  // Ensure localStorage is absent by default so dev-token tests are clean.
  vi.stubGlobal('localStorage', undefined);
});

// ---------------------------------- existing tests ---------------------------

describe('createClientSocket — basic configuration', () => {
  it('returns a socket.io client instance', () => {
    const socket = createClientSocket({ name: 'test-socket', logger: mockLogger as never });
    expect(socket).toBeDefined();
    expect(socket.io).toBeDefined();
    expect(typeof socket.connect).toBe('function');
    expect(typeof socket.disconnect).toBe('function');
  });

  it('uses provided host when given', () => {
    const socket = createClientSocket({ host: 'example.com', name: 'test', logger: mockLogger as never });
    expect((socket.io as any).uri).toContain('example.com');
  });

  it('uses window.location.hostname when host is undefined', () => {
    const socket = createClientSocket({ name: 'test', logger: mockLogger as never });
    expect((socket.io as any).uri).toContain('localhost');
  });

  it('configures socket with correct path from name', () => {
    const socket = createClientSocket({ host: 'host', name: 'mySocket', logger: mockLogger as never });
    expect(socket.io.opts.path).toBe('/mySocket');
  });

  it('has autoConnect disabled', () => {
    const socket = createClientSocket({ name: 'test', logger: mockLogger as never });
    expect(socket.io.opts.autoConnect).toBe(false);
  });
});

// ---------------------------------- tokenStorage auth tests ------------------

describe('createClientSocket — tokenStorage auth callback', () => {
  it('sends sessionToken merged with auth when tokenStorage.get returns a token', async () => {
    const tokenStorage = makeTokenStorage({ get: vi.fn().mockResolvedValue('tok-abc') });
    const socket = createClientSocket({
      name: 'app',
      logger: mockLogger as never,
      auth: { userId: 'u1' },
      tokenStorage,
    });

    const result = await resolveAuthProvider(socket);

    expect(result).toEqual({ userId: 'u1', sessionToken: 'tok-abc' });
  });

  it('sends plain auth when tokenStorage.get returns null', async () => {
    const tokenStorage = makeTokenStorage({ get: vi.fn().mockResolvedValue(null) });
    const socket = createClientSocket({
      name: 'app',
      logger: mockLogger as never,
      auth: { userId: 'u1' },
      tokenStorage,
    });

    const result = await resolveAuthProvider(socket);

    expect(result).toEqual({ userId: 'u1' });
  });

  it('sends plain auth when tokenStorage.get rejects (catch guard)', async () => {
    const tokenStorage = makeTokenStorage({
      get: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    });
    const socket = createClientSocket({
      name: 'app',
      logger: mockLogger as never,
      auth: { userId: 'u1' },
      tokenStorage,
    });

    const result = await resolveAuthProvider(socket);

    expect(result).toEqual({ userId: 'u1' });
  });

  it('sends empty object when auth is omitted and tokenStorage.get returns null', async () => {
    const tokenStorage = makeTokenStorage({ get: vi.fn().mockResolvedValue(null) });
    const socket = createClientSocket({ name: 'app', logger: mockLogger as never, tokenStorage });

    const result = await resolveAuthProvider(socket);

    expect(result).toEqual({});
  });

  it('sends sessionToken without extra auth fields when auth is omitted and token is present', async () => {
    const tokenStorage = makeTokenStorage({ get: vi.fn().mockResolvedValue('tok-xyz') });
    const socket = createClientSocket({ name: 'app', logger: mockLogger as never, tokenStorage });

    const result = await resolveAuthProvider(socket);

    expect(result).toEqual({ sessionToken: 'tok-xyz' });
  });

  it('passes the correct storage key to tokenStorage.get', async () => {
    const tokenStorage = makeTokenStorage();
    const socket = createClientSocket({ name: 'my-socket', logger: mockLogger as never, tokenStorage });

    // Trigger the auth callback so get() is called.
    await resolveAuthProvider(socket);

    expect(tokenStorage.get).toHaveBeenCalledWith('socketapi:session:my-socket');
  });
});

// ---------------------------------- tokenStorage event tests -----------------

describe('createClientSocket — tokenStorage event listeners', () => {
  it('calls tokenStorage.set with the correct key and token on socketapi:sessionToken', () => {
    const tokenStorage = makeTokenStorage();
    const socket = createClientSocket({ name: 'my-socket', logger: mockLogger as never, tokenStorage });

    emitOnSocket(socket, 'socketapi:sessionToken', 'new-token-value');

    expect(tokenStorage.set).toHaveBeenCalledWith('socketapi:session:my-socket', 'new-token-value');
    expect(tokenStorage.set).toHaveBeenCalledTimes(1);
  });

  it('calls tokenStorage.remove with the correct key on socketapi:sessionInvalid', () => {
    const tokenStorage = makeTokenStorage();
    const socket = createClientSocket({ name: 'my-socket', logger: mockLogger as never, tokenStorage });

    emitOnSocket(socket, 'socketapi:sessionInvalid');

    expect(tokenStorage.remove).toHaveBeenCalledWith('socketapi:session:my-socket');
    expect(tokenStorage.remove).toHaveBeenCalledTimes(1);
  });

  it('does not register socketapi:sessionToken listener when tokenStorage is absent', () => {
    const socket = createClientSocket({ name: 'my-socket', logger: mockLogger as never });

    const listeners = socket.listeners('socketapi:sessionToken');

    expect(listeners).toHaveLength(0);
  });

  it('does not register socketapi:sessionInvalid listener when tokenStorage is absent', () => {
    const socket = createClientSocket({ name: 'my-socket', logger: mockLogger as never });

    const listeners = socket.listeners('socketapi:sessionInvalid');

    expect(listeners).toHaveLength(0);
  });
});

// ---------------------------------- dev-mode guard tests ---------------------

describe('createClientSocket — dev-mode localStorage guard', () => {
  it('reads localStorage dev token only in non-production environments', () => {
    const getItemSpy = vi.fn().mockReturnValue('dev-tok');
    vi.stubGlobal('localStorage', { getItem: getItemSpy });

    // NODE_ENV is 'test' in vitest — treated as non-production.
    const socket = createClientSocket({ name: 'app', logger: mockLogger as never });

    // Auth should be the dev token object directly (not a callback function).
    const authOption = (socket.io.opts as Record<string, unknown>).auth;
    expect(authOption).toEqual({ sessionToken: 'dev-tok' });
    expect(getItemSpy).toHaveBeenCalledWith('socketapi:dev-session:app');
  });

  it('does not read localStorage when NODE_ENV is production', () => {
    const getItemSpy = vi.fn().mockReturnValue('dev-tok');
    vi.stubGlobal('localStorage', { getItem: getItemSpy });
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      createClientSocket({ name: 'app', logger: mockLogger as never });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('dev token takes priority over tokenStorage when both are present', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue('dev-tok') });
    const tokenStorage = makeTokenStorage({ get: vi.fn().mockResolvedValue('storage-tok') });

    const socket = createClientSocket({
      name: 'app',
      logger: mockLogger as never,
      tokenStorage,
    });

    // When a dev token is present, auth is a plain object — not a callback.
    const authOption = (socket.io.opts as Record<string, unknown>).auth;
    expect(authOption).toEqual({ sessionToken: 'dev-tok' });
    // tokenStorage.get should never have been called.
    expect(tokenStorage.get).not.toHaveBeenCalled();
  });
});
