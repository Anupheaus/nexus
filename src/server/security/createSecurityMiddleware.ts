import type Koa from 'koa';
import type { CorsConfig, ResolvedSecurityConfig } from './SecurityConfig';
import { RateLimiter } from './RateLimiter';
import { getClientIp } from './getClientIp';
import { securityWarn } from './securityLog';

const SECURITY_STATE_KEY = Symbol('resolvedSecurity');

export function getResolvedSecurity(ctx: Koa.Context): ResolvedSecurityConfig | undefined {
  return (ctx.state as Record<symbol, ResolvedSecurityConfig>)[SECURITY_STATE_KEY];
}

export function setResolvedSecurity(ctx: Koa.Context, config: ResolvedSecurityConfig): void {
  (ctx.state as Record<symbol, ResolvedSecurityConfig>)[SECURITY_STATE_KEY] = config;
}

export function createSecurityMiddleware(config: ResolvedSecurityConfig, app: Koa): Koa.Middleware {
  if (config.trustedProxyHops > 0) app.proxy = true;

  const rateLimiterConfig = config.rateLimit !== false ? config.rateLimit : null;
  const rateLimiter = rateLimiterConfig != null
    ? new RateLimiter(rateLimiterConfig.maxRequests, rateLimiterConfig.windowMs)
    : null;

  return async (ctx, next) => {
    setResolvedSecurity(ctx, config);

    if (config.securityHeaders) {
      ctx.set('X-Frame-Options', 'DENY');
      ctx.set('X-Content-Type-Options', 'nosniff');
      ctx.set('Referrer-Policy', 'no-referrer');
      ctx.set('X-XSS-Protection', '0');
      ctx.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (config.cors !== false) {
      const origin = ctx.get('Origin');
      if (origin) {
        if (!isOriginAllowed(origin, config.cors.allowedOrigins)) {
          securityWarn('Blocked request from a disallowed CORS origin', { securityEvent: 'cors-origin-blocked', origin, path: ctx.path });
          ctx.status = 403;
          ctx.body = { error: 'CORS: origin not allowed' };
          return;
        }
        ctx.set('Access-Control-Allow-Origin', origin);
        ctx.set('Vary', 'Origin');
        ctx.set('Access-Control-Allow-Methods', config.cors.allowedMethods.join(', '));
        ctx.set('Access-Control-Allow-Headers', config.cors.allowedHeaders.join(', '));
        ctx.set('Access-Control-Max-Age', String(config.cors.maxAgeSeconds));
        if (ctx.method === 'OPTIONS') {
          ctx.status = 204;
          return;
        }
      }
    }

    if (rateLimiter != null) {
      const ip = getClientIp(ctx, config.trustedProxyHops);
      if (!rateLimiter.check(ip)) {
        securityWarn('Rate limit exceeded', { securityEvent: 'rate-limit', scope: 'global', ip, path: ctx.path });
        ctx.status = 429;
        ctx.body = { error: rateLimiterConfig!.message };
        return;
      }
    }

    await next();
  };
}

function isOriginAllowed(origin: string, allowedOrigins: CorsConfig['allowedOrigins']): boolean {
  if (typeof allowedOrigins === 'string') return origin === allowedOrigins;
  if (allowedOrigins instanceof RegExp) return allowedOrigins.test(origin);
  return allowedOrigins.includes(origin);
}
