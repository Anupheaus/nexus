import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { EventEmitter } from 'events';
import type { Logger } from '@anupheaus/common';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger;
}

/** Minimal EventEmitter that acts as a fake HTTP/HTTPS server. */
class FakeServer extends EventEmitter {
  public listenArgs: unknown[] = [];
  public closeCalled = false;
  public closeError: Error | undefined;
  public setSecureContext = vi.fn();

  constructor() {
    super();
    // Increase limit to silence MaxListenersExceededWarning when many tests
    // each attach a 'connection' listener to the same shared FakeServer instance.
    this.setMaxListeners(50);
  }

  listen(...args: unknown[]): this {
    this.listenArgs = args;
    // invoke the resolve callback immediately (last argument when it's a function)
    const cb = args.find(a => typeof a === 'function') as (() => void) | undefined;
    cb?.();
    return this;
  }

  close(cb: (err?: Error) => void): this {
    this.closeCalled = true;
    cb(this.closeError);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// We mock selfsigned-ca entirely so no filesystem access occurs.
const mockCertLoad = vi.fn();
const mockCertSave = vi.fn();
const mockCertInstall = vi.fn();
const mockCertIsInstalled = vi.fn();
const mockCertCreate = vi.fn();
const mockCertCreateRootCa = vi.fn();

class MockCert {
  public readonly path: string;
  public key = 'mock-key';
  public cert = 'mock-cert';
  public caCert = 'mock-ca-cert';

  constructor(path: string) {
    this.path = path;
  }

  load = mockCertLoad;
  save = mockCertSave;
  install = mockCertInstall;
  isInstalled = mockCertIsInstalled;
  create = mockCertCreate;
  createRootCa = mockCertCreateRootCa;
}

vi.mock('selfsigned-ca', () => ({ Cert: MockCert }));

// Mock https.createServer to return our FakeServer
const fakeHttpsServer = new FakeServer();
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>();
  return { ...actual, createServer: vi.fn(() => fakeHttpsServer) };
});

const fakeHttpServer = new FakeServer();
vi.mock('http', () => ({
  createServer: vi.fn(() => fakeHttpServer),
}));

// Re-import after mocks are in place
const { createSSLServer } = await import('./createSSLServer');
const { createServer: httpsCreateServer } = await import('https');
const { createServer: httpCreateServer } = await import('http');

// Convenience: a self-signed ssl config (the default mode) for the bulk of the tests.
const selfSigned = (host = 'localhost', certsPath = './certs') => ({ host, certsPath }) as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSSLServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHttpsServer.listenArgs = [];
    fakeHttpsServer.closeCalled = false;
    fakeHttpsServer.closeError = undefined;
    fakeHttpServer.listenArgs = [];
    fakeHttpServer.closeCalled = false;
    fakeHttpServer.closeError = undefined;
    // Default: cert load succeeds (cert files already exist)
    mockCertLoad.mockResolvedValue(undefined);
    mockCertIsInstalled.mockResolvedValue(true);
    mockCertSave.mockResolvedValue(undefined);
    mockCertInstall.mockResolvedValue(undefined);
    mockCertCreate.mockReturnValue(undefined);
    mockCertCreateRootCa.mockReturnValue(undefined);
  });

  // -------------------------------------------------------------------------
  // certsPath normalisation (self-signed mode)
  // -------------------------------------------------------------------------

  describe('certsPath normalisation', () => {
    it('strips a trailing forward slash from certsPath', async () => {
      const logger = makeLogger();
      await createSSLServer({ ssl: selfSigned('localhost', './certs/'), port: 3000, logger });
      expect(logger.debug).toHaveBeenCalledWith('SSL certificates path', { certsPath: './certs' });
    });

    it('strips a trailing backslash from certsPath', async () => {
      const logger = makeLogger();
      await createSSLServer({ ssl: selfSigned('localhost', './certs\\'), port: 3000, logger });
      expect(logger.debug).toHaveBeenCalledWith('SSL certificates path', { certsPath: './certs' });
    });

    it('leaves a path without a trailing separator unchanged', async () => {
      const logger = makeLogger();
      await createSSLServer({ ssl: selfSigned('localhost', './certs'), port: 3000, logger });
      expect(logger.debug).toHaveBeenCalledWith('SSL certificates path', { certsPath: './certs' });
    });

    it('strips multiple consecutive trailing separators from certsPath', async () => {
      const logger = makeLogger();
      await createSSLServer({ ssl: selfSigned('localhost', './certs//'), port: 3000, logger });
      expect(logger.debug).toHaveBeenCalledWith('SSL certificates path', { certsPath: './certs' });
    });
  });

  // -------------------------------------------------------------------------
  // Server creation — happy path (existing cert)
  // -------------------------------------------------------------------------

  describe('when existing server cert loads successfully', () => {
    it('returns an object with server, startListening, and stopListening', async () => {
      const result = await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('startListening');
      expect(result).toHaveProperty('stopListening');
      expect(typeof result.startListening).toBe('function');
      expect(typeof result.stopListening).toBe('function');
    });

    it('creates an HTTPS server using the loaded cert material', async () => {
      await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });
      expect(httpsCreateServer).toHaveBeenCalledWith(expect.objectContaining({
        key: 'mock-key',
        cert: 'mock-cert',
        ca: 'mock-ca-cert',
        rejectUnauthorized: false,
        requestCert: false,
      }));
    });

    it('does not attempt to create or install a certificate when loading succeeds', async () => {
      await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });
      expect(mockCertCreate).not.toHaveBeenCalled();
      expect(mockCertCreateRootCa).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Certificate provisioning — load fails
  // -------------------------------------------------------------------------

  describe('when server cert needs to be provisioned (load fails)', () => {
    // serverCert.load() fails; rootCaCert.load() succeeds on the second call
    beforeEach(() => {
      mockCertLoad
        .mockRejectedValueOnce(new Error('cert files not found'))
        .mockResolvedValueOnce(undefined);
    });

    it('creates and saves a server cert when load fails and the root CA is already installed', async () => {
      mockCertIsInstalled.mockResolvedValue(true);

      await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });

      expect(mockCertCreate).toHaveBeenCalledOnce();
      expect(mockCertSave).toHaveBeenCalledOnce();
      expect(mockCertCreateRootCa).not.toHaveBeenCalled();
      expect(mockCertInstall).not.toHaveBeenCalled();
      expect(httpsCreateServer).toHaveBeenCalled();
    });

    it('installs the root CA before creating a server cert when root CA is not yet installed', async () => {
      mockCertIsInstalled.mockResolvedValue(false);

      await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });

      expect(mockCertInstall).toHaveBeenCalledOnce();
      expect(mockCertCreate).toHaveBeenCalledOnce();
      expect(mockCertSave).toHaveBeenCalledOnce();
      expect(mockCertCreateRootCa).not.toHaveBeenCalled();
      expect(httpsCreateServer).toHaveBeenCalled();
    });

    it('creates a brand-new root CA when root CA load also fails, then provisions the server cert', async () => {
      // Override: rootCaCert.load() also fails on the second call
      mockCertLoad
        .mockReset()
        .mockRejectedValueOnce(new Error('cert files not found'))
        .mockRejectedValueOnce(new Error('root CA not found'));
      mockCertSave.mockResolvedValue(undefined);
      mockCertInstall.mockResolvedValue(undefined);

      await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });

      expect(mockCertCreateRootCa).toHaveBeenCalledOnce();
      expect(mockCertInstall).toHaveBeenCalledOnce();
      expect(mockCertCreate).toHaveBeenCalledOnce();
      expect(httpsCreateServer).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Provided-certificate mode
  // -------------------------------------------------------------------------

  describe("mode: 'provided'", () => {
    it('creates an HTTPS server from the supplied PEMs and generates no certificate', async () => {
      await createSSLServer({
        ssl: { mode: 'provided', cert: 'pem-cert', key: 'pem-key', ca: 'pem-ca' },
        port: 3000,
        logger: makeLogger(),
      });

      expect(httpsCreateServer).toHaveBeenCalledWith(expect.objectContaining({
        key: 'pem-key',
        cert: 'pem-cert',
        ca: 'pem-ca',
        rejectUnauthorized: false,
        requestCert: false,
      }));
      // No self-signed generation should happen.
      expect(mockCertLoad).not.toHaveBeenCalled();
      expect(mockCertCreate).not.toHaveBeenCalled();
      expect(mockCertCreateRootCa).not.toHaveBeenCalled();
    });

    it('listens on the configured port', async () => {
      const { startListening } = await createSSLServer({
        ssl: { mode: 'provided', cert: 'pem-cert', key: 'pem-key' },
        port: 8443,
        logger: makeLogger(),
      });
      await startListening();
      expect(fakeHttpsServer.listenArgs[0]).toBe(8443);
    });

    it('hot-swaps the cert via setSecureContext when updateCertificate is called', async () => {
      const { updateCertificate } = await createSSLServer({
        ssl: { mode: 'provided', cert: 'pem-cert', key: 'pem-key', ca: 'pem-ca' },
        port: 3000,
        logger: makeLogger(),
      });

      updateCertificate({ cert: 'renewed-cert', key: 'renewed-key', ca: 'renewed-ca' });

      expect(fakeHttpsServer.setSecureContext).toHaveBeenCalledWith({
        cert: 'renewed-cert',
        key: 'renewed-key',
        ca: 'renewed-ca',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Off mode (plain HTTP)
  // -------------------------------------------------------------------------

  describe("mode: 'off'", () => {
    it('creates a plain HTTP server and no HTTPS server or certificate', async () => {
      const { server } = await createSSLServer({ ssl: { mode: 'off' }, port: 3000, logger: makeLogger() });

      expect(server).toBe(fakeHttpServer);
      expect(httpCreateServer).toHaveBeenCalled();
      expect(httpsCreateServer).not.toHaveBeenCalled();
      expect(mockCertLoad).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // startListening
  // -------------------------------------------------------------------------

  describe('startListening', () => {
    it('calls server.listen with the configured port', async () => {
      const { startListening } = await createSSLServer({ ssl: selfSigned(), port: 8443, logger: makeLogger() });
      await startListening();
      expect(fakeHttpsServer.listenArgs[0]).toBe(8443);
    });

    it('resolves when listen callback fires', async () => {
      const { startListening } = await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });
      await expect(startListening()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // stopListening
  // -------------------------------------------------------------------------

  describe('stopListening', () => {
    it('closes the server and resolves when there are no open connections', async () => {
      const { stopListening } = await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });
      await expect(stopListening()).resolves.toBeUndefined();
      expect(fakeHttpsServer.closeCalled).toBe(true);
    });

    it('rejects when server.close returns an error', async () => {
      fakeHttpsServer.closeError = new Error('server already closed');
      const { stopListening } = await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });
      await expect(stopListening()).rejects.toThrow('server already closed');
    });

    it('destroys open connections before closing the server', async () => {
      const { server, stopListening } = await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });

      // Simulate a connected client
      const fakeConnection = new EventEmitter() as EventEmitter & { destroy: MockInstance };
      fakeConnection.setMaxListeners(50);
      fakeConnection.destroy = vi.fn();
      server.emit('connection', fakeConnection);

      await stopListening();
      expect(fakeConnection.destroy).toHaveBeenCalled();
    });

    it('removes a connection from the tracked set when it closes', async () => {
      const { server, stopListening } = await createSSLServer({ ssl: selfSigned(), port: 3000, logger: makeLogger() });

      const fakeConnection = new EventEmitter() as EventEmitter & { destroy: MockInstance };
      fakeConnection.setMaxListeners(50);
      fakeConnection.destroy = vi.fn();
      server.emit('connection', fakeConnection);

      // Simulate connection closing before stopListening is called
      fakeConnection.emit('close');

      await stopListening();
      // destroy should NOT have been called — the connection was already removed
      expect(fakeConnection.destroy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // SSL-to-HTTP fallback (self-signed)
  // -------------------------------------------------------------------------

  describe('SSL-to-HTTP fallback', () => {
    it('falls back to a plain HTTP server when https.createServer throws', async () => {
      vi.mocked(httpsCreateServer).mockImplementationOnce(() => { throw new Error('TLS handshake failed'); });
      const logger = makeLogger();

      const { server } = await createSSLServer({ ssl: selfSigned(), port: 3000, logger });

      expect(server).toBe(fakeHttpServer);
      expect(httpCreateServer).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Starting normal server...');
    });
  });
});
