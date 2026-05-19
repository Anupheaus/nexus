# server/security — Rate Limiting, CORS & Security Headers

Configurable security policies applied globally to all HTTP and socket requests. Sensible defaults are active out of the box — override only what you need.

## Files

| File | Purpose |
|------|---------|
| `SecurityConfig.ts` | `SecurityConfig` input interface and `ResolvedSecurityConfig` with defaults |
| `createSecurityMiddleware.ts` | Koa middleware that enforces rate limits, CORS, body size, and security headers |
| `RateLimiter.ts` | In-memory sliding-window rate limiter (keyed by IP, optionally by route) |
| `withSecurity.ts` | Per-route security override — wrap a Koa handler to apply stricter or looser settings |

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
