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
| `securityLog.ts` | `securityWarn()` — logs a warning (with a `securityEvent` discriminator) whenever a security measure blocks a request |
| `createOperatorKeyGuard.ts` | Koa middleware `setupKoa` attaches last (ahead of every route): 400 for a MongoDB operator key in the query string or body (sc-633) |

## Operator keys (`operatorKeys`, sc-633)

`setupKoa` attaches `createOperatorKeyGuard` after the body parser, the request logger and the security middleware —
the last app-wide middleware, so ahead of every route: nexus's REST actions (the catch-all `/:name/actions/:action` and
each action's explicit route), nexus's own auth routes, and anything the app or mxdb registers (`/mcp`, webhooks). It
refuses with 400 (`{ error: { message } }`, logged as the `operator-injection` security event):

- a `$`-prefixed key anywhere in the query string or the body — always;
- a dotted key (`address.postcode`, which MongoDB reads as a path) — only when the app opts in with
  `operatorKeys.refuseDottedKeys: true` (off by default, so taking this version breaks no route that receives dotted
  names), and then unless `operatorKeys.isDottedKeyAllowed({ path, method })` exempts that request, e.g. a webhook whose
  provider sends dotted names (Meta's `hub.mode`, an inbound email's header map).

It reads the body as the body parser left it (JSON, or a form parsed with qs, which nests `a[$ne]=x`) — before any
route's `to.deserialise`, which turns `@error` objects into Errors and ISO strings into DateTimes and would hide what is
inside them from later checks. Koa parses the query string flat, so a `$` key is the only way an operator arrives there.
Socket traffic is not HTTP and is not seen here — an app checks socket payloads itself. `operatorKeys: false` turns the
guard off. It is walked iteratively; a request nested more than `MAX_REQUEST_DEPTH` (64) levels deep is refused the same
way, and the logged key path is cut to 200 characters. App-wide only: `withSecurity` takes a `RouteSecurityConfig`,
which has no `operatorKeys` (the guard runs before any route's own middleware).

## Logging blocked requests

Every security rejection emits a `logger.warn` via `securityWarn()` so blocks are trackable rather than
silent — rate limits (global, per-route, per-action), CORS-origin blocks, disallowed transport,
unauthorized calls, and over-size bodies. Each log carries `securityEvent` plus context (IP, path, action,
origin, limits) for filtering/alerting. It uses the request-scoped logger directly (no silent fallback), so
a missing logger surfaces rather than hiding the event.

`auth-blocked` (sc-378) is a sign-in or session refused by an authentication safeguard (a bad signature, a replayed
challenge, an OAuth state or audience mismatch, a malformed key, an off-site redirect). Those `[Auth]` failures go
through `securityWarn` from `../auth/authEventLog.ts`; see [../auth/AGENTS.md](../auth/AGENTS.md#auth-event-log-sc-378).

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

**Behind a TLS-terminating proxy** (Fly.io, a load balancer; `ssl: { mode: 'off' }`) the socket is plain HTTP.
`trustedProxyHops > 0` sets Koa's `app.proxy`, so `ctx.secure` follows the proxy's `X-Forwarded-Proto`, and the REST
connection cookie (`nexus-conn`) is issued `Secure` from it. With no proxy trusted a client-sent `X-Forwarded-Proto`
is ignored. Session cookies are always `Secure`.

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
