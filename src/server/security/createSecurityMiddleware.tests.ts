import { describe, it, expect, vi } from 'vitest';
import { createSecurityMiddleware, getResolvedSecurity } from './createSecurityMiddleware';
import { resolveSecurityConfig } from './SecurityConfig';
import type Koa from 'koa';

function makeMockApp() {
  return { proxy: false } as unknown as Koa;
}

function makeMockCtx(overrides: Partial<{
  ip: string;
  method: string;
  headers: Record<string, string>;
  status: number;
  body: unknown;
}> = {}) {
  const headers: Record<string, string> = overrides.headers ?? {};
  const ctx = {
    ip: overrides.ip ?? '1.2.3.4',
    method: overrides.method ?? 'GET',
    get: (h: string) => headers[h.toLowerCase()] ?? '',
    set: vi.fn(),
    state: {} as Record<string, unknown>,
    status: overrides.status ?? 200,
    body: overrides.body ?? undefined,
  };
  return ctx as unknown as Koa.Context;
}

describe('createSecurityMiddleware', () => {
  describe('proxy trust', () => {
    it('sets app.proxy=true when trustedProxyHops > 0', () => {
      const app = makeMockApp();
      createSecurityMiddleware(resolveSecurityConfig({ trustedProxyHops: 1 }), app);
      expect(app.proxy).toBe(true);
    });

    it('leaves app.proxy false when trustedProxyHops is 0', () => {
      const app = makeMockApp();
      createSecurityMiddleware(resolveSecurityConfig({ trustedProxyHops: 0 }), app);
      expect(app.proxy).toBe(false);
    });
  });

  describe('security headers', () => {
    it('sets security headers when enabled', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({ securityHeaders: true }), app);
      const ctx = makeMockCtx();
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(ctx.set).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(ctx.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(ctx.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
      expect(ctx.set).toHaveBeenCalledWith('X-XSS-Protection', '0');
      expect(ctx.set).toHaveBeenCalledWith('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    });

    it('skips security headers when disabled', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({ securityHeaders: false }), app);
      const ctx = makeMockCtx();
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(ctx.set).not.toHaveBeenCalledWith('X-Frame-Options', expect.anything());
    });
  });

  describe('CORS', () => {
    it('returns 403 when origin is not allowed', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: 'https://allowed.com' },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      const ctx = makeMockCtx({ headers: { origin: 'https://bad.com' } });
      const next = vi.fn();
      await mw(ctx, next);
      expect(ctx.status).toBe(403);
      expect((ctx.body as any).error).toBe('CORS: origin not allowed');
      expect(next).not.toHaveBeenCalled();
    });

    it('sets CORS headers when origin matches a string', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: 'https://allowed.com' },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      const ctx = makeMockCtx({ headers: { origin: 'https://allowed.com' } });
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(ctx.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://allowed.com');
      expect(next).toHaveBeenCalled();
    });

    it('matches origin against array', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: ['https://a.com', 'https://b.com'] },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      const ctx = makeMockCtx({ headers: { origin: 'https://b.com' } });
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(ctx.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://b.com');
    });

    it('matches origin against RegExp', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: /^https:\/\/.*\.myapp\.com$/ },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      const ctx = makeMockCtx({ headers: { origin: 'https://sub.myapp.com' } });
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(ctx.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://sub.myapp.com');
    });

    it('handles OPTIONS preflight with 204', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: 'https://allowed.com' },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      const ctx = makeMockCtx({ method: 'OPTIONS', headers: { origin: 'https://allowed.com' } });
      const next = vi.fn();
      await mw(ctx, next);
      expect(ctx.status).toBe(204);
      expect(next).not.toHaveBeenCalled();
    });

    it('skips CORS when no Origin header', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: 'https://allowed.com' },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      const ctx = makeMockCtx(); // no origin header
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(ctx.set).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything());
      expect(next).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('returns 429 after exceeding the limit', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        rateLimit: { maxRequests: 2, windowMs: 60_000 },
        securityHeaders: false,
      }), app);
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(makeMockCtx({ ip: '9.9.9.9' }), next);
      await mw(makeMockCtx({ ip: '9.9.9.9' }), next);
      const ctx = makeMockCtx({ ip: '9.9.9.9' });
      await mw(ctx, next);
      expect(ctx.status).toBe(429);
      expect((ctx.body as any).error).toBeDefined();
    });

    it('skips rate limiting when disabled', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        rateLimit: false,
        securityHeaders: false,
      }), app);
      const next = vi.fn().mockResolvedValue(undefined);
      for (let i = 0; i < 200; i++) await mw(makeMockCtx({ ip: '8.8.8.8' }), next);
      expect(next).toHaveBeenCalledTimes(200);
    });
  });

  describe('ctx.state resolution', () => {
    it('stores resolved config on ctx.state for withSecurity to read', async () => {
      const app = makeMockApp();
      const config = resolveSecurityConfig({ securityHeaders: false, rateLimit: false });
      const mw = createSecurityMiddleware(config, app);
      const ctx = makeMockCtx();
      const next = vi.fn().mockResolvedValue(undefined);
      await mw(ctx, next);
      expect(getResolvedSecurity(ctx)).toEqual(config);
    });
  });
});
