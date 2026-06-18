import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withSecurity } from './withSecurity';
import { createSecurityMiddleware } from './createSecurityMiddleware';
import { resolveSecurityConfig } from './SecurityConfig';
import { setLogger } from '../async-context/nexusContext';
import type Koa from 'koa';

// Rejections (429 / 413) log via useLogger().createSubLogger('Nexus Security'); provide one whose
// sub-logger is itself so those paths don't throw.
const mockLogger: any = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), silly: vi.fn(), debug: vi.fn() };
mockLogger.createSubLogger = () => mockLogger;

function makeMockApp() {
  return { proxy: false } as unknown as Koa;
}

function makeMockCtx(ip = '1.2.3.4', contentLength?: number) {
  const ctx = {
    ip,
    method: 'GET',
    get: vi.fn((h: string) => h.toLowerCase() === 'content-length' && contentLength != null ? String(contentLength) : ''),
    set: vi.fn(),
    state: {} as Record<symbol, unknown>,
    status: 200,
    body: undefined as unknown,
    request: { length: contentLength ?? 0 },
  };
  return ctx as unknown as Koa.Context;
}

describe('withSecurity', () => {
  beforeEach(() => { vi.useFakeTimers(); setLogger(mockLogger as never); mockLogger.warn.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('rate limit override', () => {
    it('applies a tighter per-route rate limit', async () => {
      const next = vi.fn().mockResolvedValue(undefined);
      const routeMw = withSecurity({ rateLimit: { maxRequests: 2, windowMs: 60_000 } });
      const globalConfig = resolveSecurityConfig({ rateLimit: false, securityHeaders: false });
      const globalMw = createSecurityMiddleware(globalConfig, makeMockApp());

      for (let i = 0; i < 2; i++) {
        const ctx = makeMockCtx('10.0.0.1');
        await globalMw(ctx, async () => { await routeMw(ctx, next); });
      }

      const blockedCtx = makeMockCtx('10.0.0.1');
      await globalMw(blockedCtx, async () => { await routeMw(blockedCtx, next); });

      expect(blockedCtx.status).toBe(429);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ securityEvent: 'rate-limit', scope: 'route', ip: '10.0.0.1' }),
      );
    });

    it('deep merges rateLimit — inherits windowMs from global', async () => {
      const routeMw = withSecurity({ rateLimit: { maxRequests: 1 } });
      const globalConfig = resolveSecurityConfig({ rateLimit: false, securityHeaders: false });
      const globalMw = createSecurityMiddleware(globalConfig, makeMockApp());
      const next = vi.fn().mockResolvedValue(undefined);

      const ctx1 = makeMockCtx('11.0.0.1');
      await globalMw(ctx1, async () => { await routeMw(ctx1, next); });

      const ctx2 = makeMockCtx('11.0.0.1');
      await globalMw(ctx2, async () => { await routeMw(ctx2, next); });
      expect(ctx2.status).toBe(429);

      // After window expires the limit resets
      vi.advanceTimersByTime(60_000);
      const ctx3 = makeMockCtx('11.0.0.1');
      await globalMw(ctx3, async () => { await routeMw(ctx3, next); });
      expect(ctx3.status).toBe(200);
    });

    it('disabling per-route rate limit does not add extra blocking', async () => {
      const next = vi.fn().mockResolvedValue(undefined);
      const routeMw = withSecurity({ rateLimit: false });
      const globalConfig = resolveSecurityConfig({ rateLimit: false, securityHeaders: false });
      const globalMw = createSecurityMiddleware(globalConfig, makeMockApp());

      for (let i = 0; i < 200; i++) {
        const ctx = makeMockCtx('12.0.0.1');
        await globalMw(ctx, async () => { await routeMw(ctx, next); });
      }
      expect(next).toHaveBeenCalledTimes(200);
    });
  });

  describe('body size override', () => {
    it('rejects request exceeding the per-route body size limit', async () => {
      const next = vi.fn().mockResolvedValue(undefined);
      const routeMw = withSecurity({ maxBodySizeKb: 1 }); // 1 KB
      const globalConfig = resolveSecurityConfig({ rateLimit: false, securityHeaders: false, maxBodySizeKb: 512 });
      const globalMw = createSecurityMiddleware(globalConfig, makeMockApp());

      const ctx = makeMockCtx('13.0.0.1', 2048); // 2 KB
      await globalMw(ctx, async () => { await routeMw(ctx, next); });

      expect(ctx.status).toBe(413);
      expect((ctx.body as any).error).toBe('Request body too large');
      expect(next).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ securityEvent: 'body-size' }),
      );
    });

    it('allows request within the per-route body size limit', async () => {
      const next = vi.fn().mockResolvedValue(undefined);
      const routeMw = withSecurity({ maxBodySizeKb: 10 });
      const globalConfig = resolveSecurityConfig({ rateLimit: false, securityHeaders: false });
      const globalMw = createSecurityMiddleware(globalConfig, makeMockApp());

      const ctx = makeMockCtx('14.0.0.1', 5 * 1024); // 5 KB — within 10 KB limit
      await globalMw(ctx, async () => { await routeMw(ctx, next); });

      expect(next).toHaveBeenCalled();
    });

    it('does not check body size when maxBodySizeKb is not overridden', async () => {
      const next = vi.fn().mockResolvedValue(undefined);
      const routeMw = withSecurity({ rateLimit: false }); // no maxBodySizeKb
      const globalConfig = resolveSecurityConfig({ rateLimit: false, securityHeaders: false });
      const globalMw = createSecurityMiddleware(globalConfig, makeMockApp());

      const ctx = makeMockCtx('15.0.0.1', 999 * 1024);
      await globalMw(ctx, async () => { await routeMw(ctx, next); });

      expect(next).toHaveBeenCalled();
    });
  });
});
