# Server guide

This document explains how to run and extend **@anupheaus/socket-api** on Node.js: attaching to an HTTP server, registering handlers, emitting to clients, and integrating REST routes with the same per-connection context as WebSockets.

## Prerequisites

- An existing `http.Server` (or compatible) instance
- Peer dependencies: `socket.io` (matching the version range in the package)
- A stable `privateKey` string when you use built-in JWT authentication (see [Authentication](./authentication.md))

## Imports

```ts
import {
  startServer,
  createServerActionHandler,
  createServerSubscription,
  useSocketAPI,
  useEvent,
  useAction,
} from '@anupheaus/socket-api/server';
```

Shared contracts come from `@anupheaus/socket-api/common`:

```ts
import { defineAction, defineEvent, defineSubscription } from '@anupheaus/socket-api/common';
```

## Minimal bootstrap

1. **Name** — The `name` option is the Socket.IO namespace segment and **must match** the client `<SocketAPI name="...">` prop.
2. **Server** — Pass the Node HTTP server you will call `.listen()` on (or already listening).
3. **Actions / subscriptions** — Arrays of handlers created with `createServerActionHandler` and `createServerSubscription`.

```ts
import http from 'http';
import { startServer, createServerActionHandler } from '@anupheaus/socket-api/server';
import { myAction } from './contracts';

const server = http.createServer();

await startServer({
  name: 'api',
  server,
  privateKey: process.env.JWT_PRIVATE_KEY!,
  actions: [
    createServerActionHandler(myAction, async (request) => {
      return { /* typed response */ };
    }),
  ],
});

server.listen(3000);
```

`startServer` resolves to `{ app, io }` where `app` is the internal Koa instance and `io` is the Socket.IO server — useful for tests or extra namespaces (see [HTTP, Koa, and lifecycle](./http-koa-lifecycle.md)).

## Handler responsibilities

| Mechanism | Registration | Your code |
|-----------|--------------|-----------|
| **Action** (client calls server) | `createServerActionHandler(contract, fn)` | `fn(request)` → `response` or throw |
| **Subscription** | `createServerSubscription(contract, fn)` | `fn({ request, subscriptionId, update, onUnsubscribe })` → initial value; call `update()` for pushes |
| **Event** (server → client) | No registration | `const emit = useEvent(contract); emit(payload);` inside a handler |

Details: [Actions](./actions.md), [Events](./events.md), [Subscriptions](./subscriptions.md).

## Per-request / per-connection context

Inside any action or subscription handler you can use:

```ts
const { getClient, setUser } = useSocketAPI();
```

- **`setUser`** — Marks the connection authenticated and issues a JWT when `privateKey` is configured.
- **`getClient`** — Current socket metadata for this invocation.

The library also provides a typed **async context** (`createAsyncContext`) so values follow the logical connection across async work and optional REST handlers. See [Async context](./async-context.md).

## Server-initiated RPC (server → client)

For the same `defineAction` contract:

1. On the server, inside a handler with socket context, use **`useAction(contract)`** from **`@anupheaus/socket-api/server`** (not the client package). It returns `invoke(request) => Promise<response>`.
2. On the client, register **exactly one** **`useServerActionHandler(contract)`** per action in the React tree.

See [Actions](./actions.md#server-initiated-actions-server--client).

## Pushing events to the current client

```ts
import { useEvent } from '@anupheaus/socket-api/server';

const notify = useEvent(myEvent);
notify({ message: 'Hello' });
```

Call this only when a handler is running under the connection scope established for that socket.

## Contracts

Define actions, events, and subscriptions once in shared code; import the same objects on server and client. See [Contracts](./contracts.md).

## Wire naming (for debugging)

- Actions: `socket-api.actions.{actionName}`
- Events: `socket-api.events.{eventName}`
- Subscriptions: `socket-api.subscriptions.{subscriptionName}`

## Next steps

- [Authentication](./authentication.md) — JWT flow and optional key persistence hooks
- [HTTP, Koa, and lifecycle](./http-koa-lifecycle.md) — `onRegisterRoutes`, `onRegisterNamespaces`, connection hooks
