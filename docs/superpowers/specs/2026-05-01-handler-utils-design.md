# Handler Utils Design

**Date:** 2026-05-01  
**Status:** Approved

## Overview

Introduce `NexusServerHandlerActionUtils` — a typed utils object passed as the second argument to every server action handler. It provides transport-aware utilities (headers, cookies, redirect) and exposes which transport the current invocation arrived on.

Alongside this, action definitions gain a `transport` field that restricts which transports an action may be called on, enforced on both client and server.

The existing `responseHeaders` / `setResponseHeader` mechanism in the async context is removed — it is fully replaced by this design.

---

## Section 1 — Types

All types and helpers live in a new file: `src/server/handler/handlerUtils.ts`.

```ts
export type TransportType = 'socket' | 'rest';

export interface CookieOptions {
  httpOnly?: boolean;   // default true
  secure?: boolean;     // default true
  sameSite?: 'Strict' | 'Lax' | 'None';  // default 'Strict'
  path?: string;        // default '/'
  maxAge?: number;      // seconds
  expires?: Date;
}

const REDIRECT_SYMBOL: unique symbol = Symbol('socket-api.redirect');

export interface RedirectResult {
  readonly type: typeof REDIRECT_SYMBOL;
  readonly url: string;
}

export function isRedirectResult(value: unknown): value is RedirectResult {
  return typeof value === 'object' && value !== null && (value as any).type === REDIRECT_SYMBOL;
}

export interface NexusServerHandlerActionUtils {
  transportType: TransportType;
  requestId: string;
  headers: Record<string, string | string[] | undefined>;
  setHeaders(headers: Record<string, string>): void;
  setCookie(name: string, value: string, options?: CookieOptions): void;
  getCookie(name: string): string | undefined;
  removeCookie(name: string): void;
  redirect(url: string): RedirectResult;
}
```

`REDIRECT_SYMBOL` is module-private — only `redirect()` can produce a valid `RedirectResult`. The REST handler uses `isRedirectResult(value)` to detect it and issue a 302.

### Utils reference

| Util | Transport | Notes |
|---|---|---|
| `transportType` | both | `'socket'` or `'rest'` |
| `requestId` | both | Unique ID for this invocation; matches server log output |
| `headers` | both | Socket: handshake headers. REST: HTTP request headers |
| `setHeaders` | REST only | Throws on socket |
| `setCookie` | REST only | Throws on socket |
| `getCookie` | REST only | Throws on socket |
| `removeCookie` | REST only | Throws on socket; sets `Max-Age=0` |
| `redirect` | REST only | Throws on socket; returns `RedirectResult` → 302 |

Error message for REST-only utils called from socket: `"<utilName> is only available in REST action handlers"`.

---

## Section 2 — Factory functions

Two factory functions in `handlerUtils.ts` construct transport-specific utils:

```ts
export function createSocketHandlerUtils(
  socket: Socket,
  requestId: string,
): NexusServerHandlerActionUtils {
  return {
    transportType: 'socket',
    requestId,
    headers: socket.handshake.headers as Record<string, string | string[] | undefined>,
    setHeaders:   () => { throw restOnlyError('setHeaders'); },
    setCookie:    () => { throw restOnlyError('setCookie'); },
    getCookie:    () => { throw restOnlyError('getCookie'); },
    removeCookie: () => { throw restOnlyError('removeCookie'); },
    redirect:     () => { throw restOnlyError('redirect'); },
  };
}

export function createRestHandlerUtils(
  req: IncomingMessage,
  headerMap: Map<string, string>,
  requestId: string,
): NexusServerHandlerActionUtils {
  return {
    transportType: 'rest',
    requestId,
    headers: req.headers as Record<string, string | string[] | undefined>,
    setHeaders:   (headers) => { for (const [k, v] of Object.entries(headers)) headerMap.set(k, v); },
    setCookie:    (name, value, opts) => { headerMap.set('Set-Cookie', buildSetCookieHeader(name, value, opts)); },
    getCookie:    (name) => parseCookie(req.headers.cookie, name),
    removeCookie: (name) => { headerMap.set('Set-Cookie', buildSetCookieHeader(name, '', { maxAge: 0 })); },
    redirect:     (url) => ({ type: REDIRECT_SYMBOL, url }),
  };
}
```

Private helpers `buildSetCookieHeader` and `parseCookie` live in the same file, replacing the manual cookie string construction in `signinRoute.ts`.

---

## Section 3 — Handler invocation changes

### Socket path (`createServerHandler.ts`)

`createSocketHandlerUtils(useClient()!, requestId)` is constructed per invocation (the `requestId` is already generated here) and passed as the second argument:

```ts
// before
handler(request)

// after
handler(request, createSocketHandlerUtils(useClient()!, requestId))
```

### REST path (`registerRestActions.ts`)

`createRestHandlerUtils(req, headerMap, requestId)` is constructed once per request after the `headerMap` is created. The REST path bypasses `wrapAckHandler` to gain fine-grained control over status codes:

```ts
try {
  const result = await entry.limitGate.run(() => entry.handler(request, utils));
  if (isRedirectResult(result)) { ctx.redirect(result.url); ctx.status = 302; return; }
  ctx.status = 200;
  ctx.body = result ?? {};
} catch (err) {
  const statusCode = err instanceof BaseError ? (err.toJSON().statusCode ?? 400) : 500;
  ctx.status = statusCode;
  ctx.body = { error: { message: err instanceof Error ? err.message : String(err) } };
}
```

`BaseError` is the `Error` class from `@anupheaus/common`. All custom error subclasses inherit it and serialise `statusCode` via `toJSON()`. This covers:

| Class | statusCode |
|---|---|
| `ApiError` | from props (public getter) |
| `AuthenticationError` | 401 |
| `ServerError` | 500 |
| `InternalError` | 500 |
| `NotImplementedError` | 404 |
| Native/unknown errors | 500 (fallback) |

The socket path keeps `wrapAckHandler` unchanged — it only handles socket ACK serialisation and does not care about HTTP status codes.

---

## Section 4 — ALS cleanup and migration

`socketApiContext.ts` loses three exports that are fully superseded by the utils:

- `setResponseHeaders` (slot setter)
- `useResponseHeaders` (slot reader)
- `setResponseHeader` (convenience function)

The one existing caller, `signinRoute.ts`, migrates to destructured utils:

```ts
// before
setResponseHeader('Set-Cookie', buildSetCookieHeader(sessionToken));

// after (handler receives utils as second param, destructured)
createServerActionHandler(signInAction, async (req, { setCookie }) => {
  // ...
  setCookie(COOKIE_NAME, sessionToken, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
}, { isPublic: true });
```

The `buildSetCookieHeader` helper in `signinRoute.ts` is deleted — that logic moves into `handlerUtils.ts` as the shared private helper.

---

## Section 5 — `transport` on action definitions

### Definition

```ts
// defineAction.ts
export interface DefineActionOptions {
  server?: NexusActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions;
  /** Which transports this action is callable on. Default: both. */
  transport?: Array<'socket' | 'rest'>;
}
```

Guard: if `rest` config is provided alongside a `transport` that excludes `'rest'`, throw at registration time.

`signInAction` in `internalActions.ts` gains `transport: ['rest']`.

### Server-side enforcement

Both socket listener and REST registry entry are **always registered** for every action. Transport validation runs at the very top of each handler path — before auth, before the limit gate:

- **Socket handler**: if `action.transport` is set and excludes `'socket'` → ACK `{ error: 'This action is only available via REST' }` and return
- **REST handler**: if `action.transport` is set and excludes `'rest'` → `ctx.status = 405`, body `{ error: 'This action is only available via socket' }`

This means misrouted calls get a clear, immediate rejection rather than a timeout or a misleading 404.

### Client-side enforcement

`useAction.ts` replaces the scattered `!action.rest` / `getIsConnected()` checks with a single helper:

```ts
function resolveTransport(
  action: NexusAction<any, any, any>,
  isConnected: boolean,
): 'socket' | 'rest' | 'wait' {
  const t = action.transport;
  const restOnly  = t != null && !t.includes('socket');
  const socketOnly = t != null && !t.includes('rest');

  if (restOnly)   return 'rest';
  if (socketOnly) return isConnected ? 'socket' : 'wait';
  // default: prefer socket when connected, fall back to REST
  return isConnected ? 'socket' : 'rest';
}
```

- `'rest'` → call `callRest` immediately (both direct call and reactive hook)
- `'socket'` → emit on the socket (both direct call and reactive hook)
- `'wait'` → socket-only action, not yet connected:
  - Reactive hook (`useXxx`): defers invocation until `onConnected` fires
  - Direct call (action function): throws `"Cannot call socket-only action while disconnected"` immediately

---

## Section 6 — File-level summary

### New files

| File | Purpose |
|---|---|
| `src/server/handler/handlerUtils.ts` | `NexusServerHandlerActionUtils`, factories, cookie helpers, redirect symbol |

### Modified files

| File | Changes |
|---|---|
| `src/common/defineAction.ts` | Add `transport?: Array<'socket' \| 'rest'>` to `NexusAction` and `DefineActionOptions`; guard against `rest` + socket-only contradiction |
| `src/common/internalActions.ts` | Add `transport: ['rest']` to `signInAction` |
| `src/server/handler/createServerHandler.ts` | Pass `createSocketHandlerUtils` to handler; add transport check at top |
| `src/server/actions/registerRestActions.ts` | Pass `createRestHandlerUtils` to handler; add 405 transport check; replace `wrapAckHandler` error path with `BaseError.toJSON().statusCode`; handle `isRedirectResult` → 302 |
| `src/server/actions/createServerActionHandler.ts` | Always register both handlers; transport check moved to runtime |
| `src/server/async-context/socketApiContext.ts` | Remove `responseHeaders`, `setResponseHeaders`, `useResponseHeaders`, `setResponseHeader` |
| `src/client/hooks/useAction.ts` | Replace `!action.rest` transport logic with `resolveTransport` helper |

### Moved and renamed files

Auth action files move from `src/server/auth/routes/` to `src/server/actions/` with `Route` → `Action` rename:

| From | To |
|---|---|
| `src/server/auth/routes/signinRoute.ts` | `src/server/actions/signinAction.ts` |
| `src/server/auth/routes/signinRoute.tests.ts` | `src/server/actions/signinAction.tests.ts` |
| `src/server/auth/routes/signoutRoute.ts` | `src/server/actions/signoutAction.ts` |
| `src/server/auth/routes/signoutRoute.tests.ts` | `src/server/actions/signoutAction.tests.ts` |
| `src/server/auth/routes/webauthnRegisterRoute.ts` | `src/server/actions/webauthnRegisterAction.ts` |
| `src/server/auth/routes/webauthnRegisterRoute.tests.ts` | `src/server/actions/webauthnRegisterAction.tests.ts` |
| `src/server/auth/routes/webauthnReauthRoute.ts` | `src/server/actions/webauthnReauthAction.ts` |
| `src/server/auth/routes/webauthnReauthRoute.tests.ts` | `src/server/actions/webauthnReauthAction.tests.ts` |
| `src/server/auth/routes/webauthnInviteRoute.ts` | `src/server/actions/webauthnInviteAction.ts` |
| `src/server/auth/routes/webauthnInviteRoute.tests.ts` | `src/server/actions/webauthnInviteAction.tests.ts` |

### Deleted

- `src/server/auth/routes/` directory (empty after moves)
- `src/server/auth/routes/AGENTS.md`

### AGENTS.md updates required

- `src/server/handler/AGENTS.md` — add `handlerUtils.ts` to file table
- `src/server/actions/AGENTS.md` — add moved auth action files; update file table
- `src/server/auth/AGENTS.md` — remove `routes/` subfolder reference
- `src/server/async-context/AGENTS.md` — remove `setResponseHeader` from API surface
