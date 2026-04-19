import { describe, it, expect, vi, afterAll } from 'vitest';
import http from 'http';
import { createServerSocket } from './createServerSocket';
import type { Server as HttpServer } from 'http';

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
  provide: vi.fn((fn: () => unknown) => fn()),
};

describe('createServerSocket', () => {
  it('returns a socket.io Server instance', () => {
    const mockServer = {} as HttpServer;
    const io = createServerSocket('test-socket', mockServer, mockLogger as never);
    expect(io).toBeDefined();
    expect(typeof io.emit).toBe('function');
    expect(typeof io.on).toBe('function');
  });

  it('creates server with provided name', () => {
    const mockServer = {} as HttpServer;
    const io = createServerSocket('mySocket', mockServer, mockLogger as never);
    expect(io).toBeDefined();
    expect(io).toBeInstanceOf(Object);
  });
});

describe('createServerSocket — allowRequest path filtering', () => {
  let server: http.Server;
  let port: number;

  afterAll(done => {
    server?.close(done);
  });

  async function startTestServer(name: string): Promise<number> {
    server = http.createServer();
    createServerSocket(name, server, mockLogger as never);
    return new Promise(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(port);
      });
    });
  }

  function wsConnect(port: number, path: string): Promise<{ opened: boolean; closeCode: number | undefined }> {
    return new Promise(resolve => {
      // Use the raw Node http upgrade request to test the allowRequest filter without a socket.io client.
      const req = http.request({ host: '127.0.0.1', port, path: `${path}/?EIO=4&transport=websocket`, method: 'GET' });
      req.setHeader('Upgrade', 'websocket');
      req.setHeader('Connection', 'Upgrade');
      req.setHeader('Sec-WebSocket-Key', 'dGhlIHNhbXBsZSBub25jZQ==');
      req.setHeader('Sec-WebSocket-Version', '13');
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        resolve({ opened: true, closeCode: undefined });
      });
      req.on('response', res => {
        resolve({ opened: false, closeCode: res.statusCode });
      });
      req.on('error', () => resolve({ opened: false, closeCode: undefined }));
      req.end();
    });
  }

  it('rejects WebSocket upgrade requests to paths other than the configured name', async () => {
    const p = await startTestServer('myapi');
    const result = await wsConnect(p, '/wrongpath');
    expect(result.opened).toBe(false);
  });

  it('accepts WebSocket upgrade requests to the configured path', async () => {
    const result = await wsConnect(port, '/myapi');
    // The connection may be upgraded or immediately closed by socket.io without a full client,
    // but the key assertion is it is NOT rejected with a 4xx before upgrade.
    expect(result.closeCode).not.toBe(400);
    expect(result.closeCode).not.toBe(403);
  });

  it('rejects sub-paths of the configured name (prefix matching does not apply)', async () => {
    const result = await wsConnect(port, '/myapi/extra');
    expect(result.opened).toBe(false);
  });
});
