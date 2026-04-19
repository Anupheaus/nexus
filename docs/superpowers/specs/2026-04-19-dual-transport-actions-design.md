# Dual-Transport Actions — Design Spec

**Date:** 2026-04-19
**Status:** Approved for implementation

---

## Overview

Actions currently work only over WebSocket. This change makes every action available over REST as well, with the transport selected automatically — socket when connected, REST when not. The calling code on both client and server is identical regardless of transport.

Subscriptions and events remain socket-only (they require server→client push, which REST does not support natively).

---

## 1. Action Definition

`defineAction` gains an optional `rest` field on `DefineActionOptions`.

```ts
export interface RestActionOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string; // e.g. '/users/:id' — path params must match request property names
}

export interface DefineActionOptions {
  server?: SocketAPIActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions; // explicit route; omit to use the auto catch-all
}
```

`SocketAPIAction` gains the `rest` field so the client can read it at call time:

```ts
export interface SocketAPIAction<Name extends string, Request, Response> {
  name: Name;
  requestType?: Request;
  responseType?: Response;
  server?: SocketAPIActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions;
}
```

### Usage

```ts
// Explicit route — GET /users/:id, path param maps to request.id
const getUser = defineAction<{ id: string }, User>()('getUser', {
  rest: { method: 'GET', url: '/users/:id' },
});

// Auto catch-all — POST /{name}/actions/createUser, full body is request
const createUser = defineAction<{ email: string; name: string }, User>()('createUser');
```

---

## 2. Server Registration

`createServerActionHandler` is unchanged at the call site. Internally it reads `action.rest` and registers the appropriate REST route in addition to the socket event listener.

### Auto catch-all

A single `POST /{name}/actions/:actionName` route is registered unconditionally in `startServer` alongside the auth routes (before `onRegisterRoutes`). It is shared across all auto actions. The route:

1. Reads `ctx.params.actionName`
2. Looks up the registered handler in a module-level action registry (keyed by action name)
3. Passes `ctx.request.body` as the typed request
4. Returns the response as JSON or an error envelope

### Explicit route

When `action.rest` is set, registers `{method} {url}` on the Koa router directly. The route:

1. Merges path params (`ctx.params`) + query string (GET) or JSON body (POST/PUT/PATCH/DELETE) into the typed request object
2. Calls the same handler function
3. Returns the response as JSON or an error envelope

### Shared handler wrapper

Both route types call through the same internal wrapper that applies:
- Auth check (reads `socketapi_session` cookie; returns `401` if missing/disabled on non-public actions)
- Async context setup (uses the `socket-api-conn` cookie via `ConnectionRegistry` so `useAuthentication()` and custom async contexts work identically inside REST handlers)
- Concurrency/queue limits via `ActionLimitGate` (shared counter with socket calls for the same action)
- Error serialisation: handler errors → `{ error: { message } }` JSON with HTTP `400`; unhandled → HTTP `500`

---

## 3. Client Transport Selection

`useAction` selects the transport per-call. No API change for callers.

```
Socket connected?
  Yes → emit socket-api.actions.{actionName} as today
  No  → REST fallback:
          action.rest defined?
            Yes → {method} {url} with path params extracted from request;
                  remaining fields in query string (GET) or JSON body (POST/PUT/PATCH/DELETE)
            No  → POST /{name}/actions/{actionName} with full request as JSON body
```

Response handling is identical in both paths — the same `throwIfAckError` / error envelope unwrapping applies. The reactive `useActionName` hook also falls back transparently.

### Request serialisation for explicit routes (client-side)

Given `rest: { method: 'GET', url: '/users/:id' }` and `request = { id: '123', includeDetails: true }`:

1. Extract path param keys from the URL template (`:id` → `['id']`)
2. Replace in URL: `/users/123`
3. Remaining keys (`includeDetails`) → query string for GET, JSON body for POST/PUT/PATCH/DELETE
4. Final: `GET /users/123?includeDetails=true`

---

## 4. Auth & Error Handling

| Concern | Behaviour |
|---|---|
| Auth (non-public actions) | Reads `socketapi_session` cookie; `401` if missing or session `isEnabled: false` |
| Public actions | No cookie required on either transport |
| Handler errors | `{ error: { message } }` JSON + HTTP `400` |
| Unhandled / unexpected | HTTP `500`, no internal details leaked |
| Async context | `ConnectionRegistry` uses `socket-api-conn` cookie to share context between REST and socket calls from the same client |
| Concurrency/queue | Shared `ActionLimitGate` counter across both transports per action |

---

## 5. HTTP Contract

### Auto catch-all

```
POST /{name}/actions/:actionName
Content-Type: application/json
Cookie: socketapi_session=<token>   (omit for isPublic actions)

Body: { ...RequestType }

→ 200 { ...ResponseType }
→ 400 { error: { message: string } }
→ 401 (auth required / invalid session)
→ 500 (unexpected server error)
```

### Explicit route (example)

```
GET /{url}?remainingFields=...
Cookie: socketapi_session=<token>

→ 200 { ...ResponseType }
→ 400 { error: { message: string } }
→ 401
→ 500
```

---

## 6. Out of Scope

- SSE transport for subscriptions/events (noted as future nice-to-have in `agent.md`)
- Subscriptions and events over REST — socket-only; they require server→client push
- OpenAPI / schema generation
- Rate limiting beyond the existing `ActionLimitGate`
- WebAuthn invite/register routes (separate plan)
