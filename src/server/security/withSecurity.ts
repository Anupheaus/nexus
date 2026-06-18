import type Koa from 'koa';
import type { SecurityConfig } from './SecurityConfig';
import { mergeSecurityConfig, SECURITY_DEFAULTS } from './SecurityConfig';
import { RateLimiter } from './RateLimiter';
import { getResolvedSecurity, setResolvedSecurity } from './createSecurityMiddleware';
import { getClientIp } from './getClientIp';
import { securityWarn } from './securityLog';

export function withSecurity(overrides: SecurityConfig): Koa.Middleware {
  // Eagerly build the per-route rate limiter if the override specifies one.
  // Uses the override values merged over SECURITY_DEFAULTS so windowMs/message
  // fall back to defaults when not specified in the override.
  const routeRateLimitConfig = overrides.rateLimit === false
    ? null
    : overrides.rateLimit != null
      ? { ...SECURITY_DEFAULTS.rateLimit, ...overrides.rateLimit }
      : null; // null = no additional per-route rate limiter (global handles it)

  const routeRateLimiter = routeRateLimitConfig != null
    ? new RateLimiter(routeRateLimitConfig.maxRequests, routeRateLimitConfig.windowMs)
    : null;

  const routeRateLimitMessage = routeRateLimitConfig?.message ?? null;
  const routeMaxBodyBytes = overrides.maxBodySizeKb != null ? overrides.maxBodySizeKb * 1024 : 0;

  return async (ctx, next) => {
    const base = getResolvedSecurity(ctx);
    if (base == null) {
      // Global middleware was not applied — should not happen in normal usage.
      await next();
      return;
    }

    const merged = mergeSecurityConfig(base, overrides);
    setResolvedSecurity(ctx, merged);

    if (routeRateLimiter != null) {
      const ip = getClientIp(ctx, merged.trustedProxyHops);
      if (!routeRateLimiter.check(ip)) {
        securityWarn('Rate limit exceeded', { securityEvent: 'rate-limit', scope: 'route', ip, path: ctx.path });
        ctx.status = 429;
        ctx.body = { error: routeRateLimitMessage! };
        return;
      }
    }

    if (routeMaxBodyBytes > 0) {
      const contentLength = ctx.request.length ?? 0;
      if (contentLength > routeMaxBodyBytes) {
        securityWarn('Request body exceeded the configured size limit', { securityEvent: 'body-size', path: ctx.path, limitBytes: routeMaxBodyBytes, sizeBytes: contentLength });
        ctx.status = 413;
        ctx.body = { error: 'Request body too large' };
        return;
      }
    }

    await next();
  };
}
