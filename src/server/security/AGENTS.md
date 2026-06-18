# server/security — Rate Limiting, CORS & Security Headers

Configurable security policies applied globally to all HTTP and socket requests. Sensible defaults are active out of the box — override only what you need.

## Files

| File | Purpose |
|------|---------|
| `SecurityConfig.ts` | `SecurityConfig` input interface and `ResolvedSecurityConfig` with defaults |
| `createSecurityMiddleware.ts` | Koa middleware that enforces rate limits, CORS, body size, and security headers |
| `RateLimiter.ts` | In-memory fixed-window rate limiter (keyed by IP, optionally by an extra key e.g. action name) |
| `withSecurity.ts` | Per-route security override — wrap a Koa handler to apply stricter or looser settings |
| `getClientIp.ts` | Resolves the real client IP from the socket peer + `X-Forwarded-For`, honouring `trustedProxyHops` |

## Client IP & trusted proxies (`trustedProxyHops`)

Everything keyed by IP (the global limiter, `withSecurity` limiters, and per-action `server.rateLimit`) uses
`getClientIp(ctx, trustedProxyHops)` rather than Koa's `ctx.ip`. Hops are counted **inward from the
server** so prepended `X-Forwarded-For` values can't spoof the key:

| `trustedProxyHops` | Resolves to | Use when |
|--------------------|-------------|----------|
| `0` | the raw socket peer (XFF ignored) | the Node server is directly internet-facing (terminates TLS itself) |
| `1` (default) | the right-most XFF entry | exactly one trusted proxy/LB sets `X-Forwarded-For` |
| `N` | the Nth address counting inward | N chained trusted proxies |

Set it to the **actual** number of trusted proxies in front of the server — too high lets clients spoof their
IP, too low keys everyone behind a proxy onto the proxy's IP. The default is `1`; set `trustedProxyHops: 0`
when nothing trusted sits in front.

## Defaults

| Policy | Default |
|--------|---------|
| Rate limit | 100 requests / 60 seconds per IP |
| CORS | Disabled (same-origin only) |
| Max body size | 512 KB |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block` |

## Configuring globally

```ts
await startServer({
  security: {
    rateLimit: { maxAttempts: 200, windowMs: 60_000 },
    cors: { origin: 'https://app.example.com' },
    maxBodySize: 1_024 * 1_024, // 1 MB
  },
  ...
});
```

## Per-route override

```ts
import { withSecurity } from '@anupheaus/nexus/server';

router.post('/upload', withSecurity({ maxBodySize: 50 * 1024 * 1024 }, uploadHandler));
```
