import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockRequestLoggerMiddleware = vi.fn();
const mockSecurityMiddleware = vi.fn();
const mockBodyParserMiddleware = vi.fn();

vi.mock('koa-bodyparser', () => ({
  default: vi.fn(() => mockBodyParserMiddleware),
}));

vi.mock('../logger', () => ({
  createRequestLogger: vi.fn(() => mockRequestLoggerMiddleware),
}));

vi.mock('../../security', () => ({
  createSecurityMiddleware: vi.fn(() => mockSecurityMiddleware),
}));

vi.mock('../../async-context/nexusContext', () => ({
  wrap: vi.fn((_selector: unknown, fn: Function) => fn),
}));

import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { createRequestLogger } from '../logger';
import { createSecurityMiddleware } from '../../security';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeRegistry() {
  return { fromRequest: vi.fn(), fromSocket: vi.fn() };
}

function makeServer() {
  return { on: vi.fn() };
}

function makeSecurity(maxBodySizeKb = 1024) {
  return {
    maxBodySizeKb,
    rateLimit: false as const,
    securityHeaders: false as const,
    cors: null,
    trustedProxyHops: 0,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('setupKoa', () => {
  let useSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Spy on Koa.prototype.use before calling setupKoa so every instance
    // created inside the function has its `use` calls recorded.
    useSpy = vi.spyOn(Koa.prototype, 'use');
  });

  it('passes maxBodySizeKb to body-parser as jsonLimit and formLimit', async () => {
    const { setupKoa } = await import('./setupKoa');
    setupKoa(makeServer() as never, makeRegistry() as never, makeSecurity(512) as never);
    expect(bodyParser).toHaveBeenCalledWith(
      expect.objectContaining({ jsonLimit: '512kb', formLimit: '512kb' }),
    );
  });

  it('attaches the request logger middleware to the app', async () => {
    const { setupKoa } = await import('./setupKoa');
    setupKoa(makeServer() as never, makeRegistry() as never, makeSecurity() as never);
    expect(createRequestLogger).toHaveBeenCalled();
    expect(useSpy).toHaveBeenCalledWith(mockRequestLoggerMiddleware);
  });

  it('attaches security middleware created with the resolved security config', async () => {
    const { setupKoa } = await import('./setupKoa');
    const security = makeSecurity();
    setupKoa(makeServer() as never, makeRegistry() as never, security as never);
    expect(createSecurityMiddleware).toHaveBeenCalledWith(security, expect.any(Koa));
    expect(useSpy).toHaveBeenCalledWith(mockSecurityMiddleware);
  });

  it('wires a request listener on the HTTP server', async () => {
    const { setupKoa } = await import('./setupKoa');
    const server = makeServer();
    setupKoa(server as never, makeRegistry() as never, makeSecurity() as never);
    expect(server.on).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('returns the Koa app instance', async () => {
    const { setupKoa } = await import('./setupKoa');
    const result = setupKoa(makeServer() as never, makeRegistry() as never, makeSecurity() as never);
    expect(typeof result.use).toBe('function');
    expect(typeof result.callback).toBe('function');
  });
});
