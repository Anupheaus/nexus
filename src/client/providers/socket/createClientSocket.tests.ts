import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClientSocket } from './createClientSocket';

describe('createClientSocket', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    silly: vi.fn(),
    provide: vi.fn((fn: () => unknown) => fn()),
  };

  beforeEach(() => {
    vi.stubGlobal('window', { location: { hostname: 'localhost', host: 'localhost', protocol: 'https:' } });
  });

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
