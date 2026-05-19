import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server as HttpServer } from 'http';
import type { Logger } from '@anupheaus/common';

// ---------------------------------------------------------------------------
// Mock all heavyweight infrastructure so we can test just the server-resolution
// branching inside startServer.
// ---------------------------------------------------------------------------

const mockSetupKoa = vi.fn(() => ({ use: vi.fn(), callback: vi.fn(() => vi.fn()) }));
const mockSetupSocket = vi.fn(() => ({
  onClientConnected: vi.fn(),
  io: { engine: { use: vi.fn() }, use: vi.fn() },
}));
const mockRegisterRestActions = vi.fn();
const mockSetConfig = vi.fn();
const mockSetLogger = vi.fn();
const mockSetAuthConfig = vi.fn();
const mockResolveSecurityConfig = vi.fn(() => ({}));
const mockSetupHandlers = vi.fn();
const mockCleanupSocketSubscriptions = vi.fn();
const mockConnectionRegistry = vi.fn().mockImplementation(() => ({
  fromSocket: vi.fn(),
  fromRequest: vi.fn(),
}));

vi.mock('./providers', () => ({
  setupKoa: mockSetupKoa,
  setupSocket: mockSetupSocket,
}));
vi.mock('./actions', () => ({
  registerRestActions: mockRegisterRestActions,
}));
vi.mock('./async-context/socketApiContext', () => ({
  setConfig: mockSetConfig,
  setLogger: mockSetLogger,
  setClient: vi.fn(),
  wrap: vi.fn((_getCtx: unknown, fn: (...args: unknown[]) => unknown) => fn),
}));
vi.mock('./security', () => ({
  resolveSecurityConfig: mockResolveSecurityConfig,
}));
vi.mock('./providers/connection', () => ({
  ConnectionRegistry: mockConnectionRegistry,
}));
vi.mock('./handler', () => ({
  setupHandlers: mockSetupHandlers,
}));
vi.mock('./subscriptions', () => ({
  cleanupSocketSubscriptions: mockCleanupSocketSubscriptions,
}));
vi.mock('./auth', () => ({
  setAuthConfig: mockSetAuthConfig,
  registerAuthRoutes: vi.fn(() => []),
  validateSessionCookie: vi.fn(),
}));
vi.mock('./providers/authentication/useAuthentication', () => ({
  useAuthentication: vi.fn(() => ({ setUser: vi.fn() })),
}));

// Mock createSSLServer so no real filesystem/certificate work happens
const mockCreateSSLServer = vi.fn();
vi.mock('./ssl', () => ({
  createSSLServer: (...args: unknown[]) => mockCreateSSLServer(...args),
}));

// ---------------------------------------------------------------------------
// Patch Logger.provide so it just runs the callback directly
// ---------------------------------------------------------------------------

vi.mock('@anupheaus/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anupheaus/common')>();
  class PatchedLogger {
    constructor(public name: string) { }
    info = vi.fn();
    error = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    provide = vi.fn(async (fn: () => unknown) => fn());
  }
  return { ...actual, Logger: PatchedLogger };
});

// Import after mocks are registered
const { startServer } = await import('./startServer');

// ---------------------------------------------------------------------------
// Shared fake server
// ---------------------------------------------------------------------------

function makeFakeHttpServer(): HttpServer {
  return { on: vi.fn() } as unknown as HttpServer;
}

function makeFakeSSLResult(server: HttpServer = makeFakeHttpServer()) {
  return {
    server,
    startListening: vi.fn().mockResolvedValue(undefined),
    stopListening: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startServer — server/ssl resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep setupKoa returning a minimal Koa-like object with a `use` method that
    // can be chained, and router-like behaviour
    mockSetupKoa.mockReturnValue({ use: vi.fn(), callback: vi.fn(() => vi.fn()) });
    mockSetupSocket.mockReturnValue({
      onClientConnected: vi.fn(),
      io: { engine: { use: vi.fn() }, use: vi.fn() },
    });
  });

  // -------------------------------------------------------------------------
  // Neither server nor ssl — must throw
  // -------------------------------------------------------------------------

  it('throws when neither server nor ssl is provided', async () => {
    await expect(startServer({ name: 'test' } as never))
      .rejects
      .toThrow('Either server or ssl must be provided to startServer');
  });

  // -------------------------------------------------------------------------
  // server provided — external lifecycle
  // -------------------------------------------------------------------------

  describe('when server is provided', () => {
    it('uses the provided server and does not call createSSLServer', async () => {
      const externalServer = makeFakeHttpServer();
      await startServer({ name: 'test', server: externalServer });
      expect(mockCreateSSLServer).not.toHaveBeenCalled();
      expect(mockSetupKoa).toHaveBeenCalledWith(externalServer, expect.anything(), expect.anything());
    });

    it('returns startListening that resolves without error (no-op)', async () => {
      const externalServer = makeFakeHttpServer();
      const { startListening } = await startServer({ name: 'test', server: externalServer });
      await expect(startListening()).resolves.toBeUndefined();
    });

    it('returns stopListening that resolves without error (no-op)', async () => {
      const externalServer = makeFakeHttpServer();
      const { stopListening } = await startServer({ name: 'test', server: externalServer });
      await expect(stopListening()).resolves.toBeUndefined();
    });

    it('returns the provided server in the result', async () => {
      const externalServer = makeFakeHttpServer();
      const result = await startServer({ name: 'test', server: externalServer });
      expect(result.server).toBe(externalServer);
    });
  });

  // -------------------------------------------------------------------------
  // ssl provided — internal lifecycle
  // -------------------------------------------------------------------------

  describe('when ssl is provided', () => {
    it('calls createSSLServer with all defaults when ssl config is empty', async () => {
      const sslResult = makeFakeSSLResult();
      mockCreateSSLServer.mockResolvedValue(sslResult);

      await startServer({ name: 'test', ssl: {} });

      expect(mockCreateSSLServer).toHaveBeenCalledWith({
        host: 'localhost',
        port: 443,
        certsPath: './certs',
        logger: expect.anything(),
      });
    });

    it('passes explicit port and ssl fields through to createSSLServer', async () => {
      const sslResult = makeFakeSSLResult();
      mockCreateSSLServer.mockResolvedValue(sslResult);

      await startServer({ name: 'test', port: 8443, ssl: { host: 'myhost', certsPath: '/etc/ssl' } });

      expect(mockCreateSSLServer).toHaveBeenCalledWith({
        host: 'myhost',
        port: 8443,
        certsPath: '/etc/ssl',
        logger: expect.anything(),
      });
    });

    it('defaults only the missing fields when partial ssl config is provided', async () => {
      const sslResult = makeFakeSSLResult();
      mockCreateSSLServer.mockResolvedValue(sslResult);

      await startServer({ name: 'test', port: 9000, ssl: {} });

      expect(mockCreateSSLServer).toHaveBeenCalledWith({
        host: 'localhost',
        port: 9000,
        certsPath: './certs',
        logger: expect.anything(),
      });
    });

    it('forwards the top-level logger to createSSLServer', async () => {
      const sslResult = makeFakeSSLResult();
      mockCreateSSLServer.mockResolvedValue(sslResult);

      const customLogger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        provide: vi.fn(async (fn: () => unknown) => fn()),
      } as unknown as Logger;
      await startServer({ name: 'test', ssl: {}, logger: customLogger });

      expect(mockCreateSSLServer).toHaveBeenCalledWith(expect.objectContaining({ logger: customLogger }));
    });

    it('returns the server from createSSLServer', async () => {
      const internalServer = makeFakeHttpServer();
      const sslResult = makeFakeSSLResult(internalServer);
      mockCreateSSLServer.mockResolvedValue(sslResult);

      const result = await startServer({ name: 'test', ssl: {} });
      expect(result.server).toBe(internalServer);
    });

    it('returns startListening and stopListening from createSSLServer', async () => {
      const sslResult = makeFakeSSLResult();
      mockCreateSSLServer.mockResolvedValue(sslResult);

      const { startListening, stopListening } = await startServer({ name: 'test', ssl: {} });

      await startListening();
      expect(sslResult.startListening).toHaveBeenCalled();

      await stopListening();
      expect(sslResult.stopListening).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------

  it('returns app and io alongside server lifecycle fields', async () => {
    const externalServer = makeFakeHttpServer();
    const result = await startServer({ name: 'test', server: externalServer });
    expect(result).toHaveProperty('app');
    expect(result).toHaveProperty('io');
    expect(result).toHaveProperty('server');
    expect(result).toHaveProperty('startListening');
    expect(result).toHaveProperty('stopListening');
  });
});
