[![CI](https://github.com/Anupheaus/socket-api/actions/workflows/publish.yml/badge.svg)](https://github.com/Anupheaus/socket-api/actions/workflows/publish.yml)
[![Coverage](https://codecov.io/gh/Anupheaus/socket-api/branch/main/graph/badge.svg)](https://codecov.io/gh/Anupheaus/socket-api)
[![Version](https://img.shields.io/github/v/tag/Anupheaus/socket-api?label=version)](https://github.com/Anupheaus/socket-api/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

# @anupheaus/socket-api

A typed, structured real-time API library built on [Socket.IO](https://socket.io). Define **actions** (RPC-style request/response), **events** (server-to-client push), and **subscriptions** (streaming data) with full TypeScript type safety shared between server and client.

## Installation

```bash
npm install @anupheaus/socket-api socket.io socket.io-client
```

> `socket.io` and `socket.io-client` are peer dependencies.

## Documentation

Extended guides and per-feature notes live under [`docs/`](./docs/AGENTS.md):

| Doc | Description |
|-----|-------------|
| [docs/server-guide.md](./docs/server-guide.md) | Server setup, handlers, context, HTTP/Koa |
| [docs/client-guide.md](./docs/client-guide.md) | React provider, hooks, patterns |
| [docs/contracts.md](./docs/contracts.md) | `defineAction` / `defineEvent` / `defineSubscription` |
| [docs/actions.md](./docs/actions.md) | RPC (client→server and server→client) |
| [docs/events.md](./docs/events.md) | Server-pushed events |
| [docs/subscriptions.md](./docs/subscriptions.md) | Streaming subscribe/unsubscribe |
| [docs/authentication.md](./docs/authentication.md) | JWT and `useUser` |
| [docs/async-context.md](./docs/async-context.md) | `createAsyncContext` and shared WebSocket/REST scope |
| [docs/http-koa-lifecycle.md](./docs/http-koa-lifecycle.md) | `startServer` lifecycle, routes, namespaces |

## Package entry points

| Import path | Use for |
|---|---|
| `@anupheaus/socket-api` | Auto-resolves to server types in Node, client types in browser (via `node`/`browser` export conditions) |
| `@anupheaus/socket-api/common` | Shared contract definitions (actions, events, subscriptions) |
| `@anupheaus/socket-api/server` | Server-side setup and handlers (explicit) |
| `@anupheaus/socket-api/client` | React client components and hooks (explicit) |

The root import is the preferred choice for `defineAuthentication` — bundlers (Vite, webpack) pick the `browser` condition automatically; Node.js picks `node`.

---

## Quick start

### 1. Define contracts (shared)

Define typed contracts once and share them between server and client:

```ts
// contracts.ts
import { defineAction, defineEvent, defineSubscription } from '@anupheaus/socket-api/common';

// RPC-style: request → response
export const getUser = defineAction<{ id: string }, { name: string; email: string }>()('getUser');

// Server pushes to client, no response
export const notifyEvent = defineEvent<{ message: string }>('notify');

// Client subscribes, server streams updates
export const liveStats = defineSubscription<{ interval: number }, { count: number }>()('liveStats');
```

### 2. Server setup

```ts
import http from 'http';
import { startServer, createServerActionHandler, createServerSubscription } from '@anupheaus/socket-api/server';
import { getUser, notifyEvent, liveStats } from './contracts';

const server = http.createServer();

await startServer({
  name: 'api',           // must match the client's name prop
  server,
  actions: [
    createServerActionHandler(getUser, async ({ id }) => {
      return { name: 'Alice', email: 'alice@example.com' };
    }),
  ],
  subscriptions: [
    createServerSubscription(liveStats, async ({ request, update, onUnsubscribe }) => {
      let count = 0;
      const timer = setInterval(() => update({ count: ++count }), request.interval);
      onUnsubscribe(() => clearInterval(timer));
      return { count: 0 }; // initial value
    }),
  ],
});

server.listen(3000);
```

To emit an event to a connected client from within an action or subscription handler:

```ts
import { useEvent } from '@anupheaus/socket-api/server';
import { notifyEvent } from './contracts';

// inside a handler:
const notify = useEvent(notifyEvent);
notify({ message: 'Hello!' });
```

### 3. Client setup

Wrap your app with `<SocketAPI>` then use the hooks anywhere inside:

```tsx
import { SocketAPI, useAction, useEvent, useSubscription } from '@anupheaus/socket-api/client';
import { getUser, notifyEvent, liveStats } from './contracts';

function App() {
  return (
    <SocketAPI name="api">
      <MyPage />
    </SocketAPI>
  );
}

function MyPage() {
  // Imperative call
  const { getUser } = useAction(getUser);

  // Reactive form — re-fetches automatically, returns { response, isLoading, error }
  const { useGetUser } = useAction(getUser);
  const { response, isLoading } = useGetUser({ id: '123' });

  // Server events
  const onNotify = useEvent(notifyEvent);
  onNotify(({ message }) => console.log(message));

  // Subscriptions
  const { subscribe, unsubscribe, onCallback } = useSubscription(liveStats);
  onCallback(({ count }) => console.log('count:', count));

  return (
    <button onClick={() => subscribe({ interval: 500 })}>Start</button>
  );
}
```

---

## API reference

### Common — `defineAction / defineEvent / defineSubscription`

```ts
defineAction<Request, Response>()(name)
defineEvent<Payload>(name)
defineSubscription<Request, Response>()(name)
```

These return typed contract objects used by both server handlers and client hooks.

Use the **same** `defineAction` contract for:

- **Client → server**: `createServerActionHandler` + client `useAction`
- **Server → client**: server `useAction` (`@anupheaus/socket-api/server`) + client `useServerActionHandler`

Both directions use the same wire name `socket-api.actions.{actionName}`; Socket.IO keeps client→server and server→client traffic distinct on the connection.

---

### Server

#### `startServer(options)`

| Option | Type | Description |
|---|---|---|
| `name` | `string` | Socket namespace identifier, must match client |
| `server` | `http.Server` | Node HTTP server to attach to |
| `auth` | `AuthConfig` | Optional. Result of `configureAuthentication(...)` — registers signin/signout routes and validates sessions on connect |
| `actions` | `ServerAction[]` | Registered action handlers |
| `subscriptions` | `ServerSubscription[]` | Registered subscription handlers |

#### `createServerActionHandler(contract, handler)`

Registers a handler for the given action contract (client-invoked RPC). The handler receives the typed request and must return the typed response (or throw).

#### `createServerSubscription(contract, handler)`

Handler receives `{ request, subscriptionId, update, onUnsubscribe }`:

| Param | Description |
|---|---|
| `request` | The typed subscription request |
| `subscriptionId` | Unique ID for this subscription instance |
| `update(response)` | Push a new value to the client |
| `onUnsubscribe(fn)` | Register a cleanup callback |

Must return the initial response value.

#### `useSocketAPI()` (server-side)

Call inside any action/subscription handler to access the current socket context:

```ts
const { getClient, setUser } = useSocketAPI();
setUser({ id: 'user-123' });       // authenticate the client
const client = getClient();        // current socket client info
```

#### `useEvent(contract)` (server-side)

Returns a function to push the event to the current connected client.

#### `useAction(contract)` (server-side)

Import from `@anupheaus/socket-api/server` (not the client entry point). Call inside an action or subscription handler (any code with `useSocketAPI()` context). Returns an async function `invoke(request) => Promise<response>` that emits to the **current** connected client and resolves when the client handler responds (or throws if the client returns an error payload).

Must be paired with `useServerActionHandler` on the client for the same `defineAction` contract.

Only **one** `useServerActionHandler` per action in the React tree; a second registration throws. The client ack is exactly that handler’s return value, so a successful **array** response stays an array (no accidental unwrapping).

---

### Client

#### `<SocketAPI name host?>`

Root provider. Place at the top of your React tree.

| Prop | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Must match server's `name` |
| `host` | `string` | `window.location.host` | Override the server host |

#### `useAction(contract)`

Returns an object with two keys per contract:

- `actionName(request) → Promise<Response>` — imperative call
- `useActionName(request) → { response, isLoading, error }` — reactive, auto-calls on mount

```ts
const { getUser, useGetUser } = useAction(getUserAction);

// imperative
const result = await getUser({ id: '123' });

// reactive
const { response, isLoading } = useGetUser({ id: '123' });
```

#### `useSubscription(contract)`

```ts
const { subscribe, unsubscribe, onCallback } = useSubscription(liveStats);

onCallback(data => console.log(data));  // register update handler
subscribe({ interval: 1000 });          // start streaming
unsubscribe();                          // stop streaming
```

#### `useServerActionHandler(contract)` (client-side)

Registers the handler for a **server-initiated** action (same `defineAction` as server `useAction`). Same pattern as `useEvent`: call the returned function with your handler, typically during render. Duplicate handlers for the same action throw at registration time.

```ts
useServerActionHandler(confirmClose)(({ saveDraft }) => {
  return { confirmed: true };
});
```

#### `useEvent(contract)` (client-side)

```ts
const { onNotify } = useEvent(notifyEvent);
onNotify(({ message }) => alert(message));
```

#### `useSocketAPI()` (client-side)

```ts
const { clientId, onConnectionStateChanged, testDisconnect, testReconnect } = useSocketAPI();
```

---

## Server async context (`createAsyncContext`)

The server uses a typed `AsyncLocalStorage`-based context system to share per-connection state across handlers without prop-drilling. This is what powers scoped values like `logger`, `authData`, and `client` internally — but you can extend it for your own per-connection state.

### How it works

`createAsyncContext(schema)` returns typed `set*` / `use*` accessors and a `wrap` function. Values are stored in a `WeakMap` keyed by a **scope object** (the logical connection), so different connections never see each other's data.

```ts
import { createAsyncContext, optional, required } from '@anupheaus/socket-api/server';

const { wrap, setTenantId, useTenantId } = createAsyncContext({
  tenantId: required<string>(),   // useX() throws if not set
  locale:   optional<string>(),   // useX() returns undefined if not set
});
```

### `wrap(scopeObject, handler)` — establish a scope

```ts
// Fixed scope object
const handler = wrap(connection, () => {
  setTenantId('acme');
  return processSomething();
});
handler(); // runs under the connection's scope
```

```ts
// Scope derived from handler arguments (captured at registration time)
const handler = wrap(
  (req: Request) => getConnection(req), // scope selector — called with the same args as the handler
  (req: Request) => {
    setTenantId(req.tenantId);
  }
);
handler(req); // selector picks the scope object; handler runs inside it
```

Handlers registered via `wrap` capture the **scope chain at the time of registration** and restore it on every invocation — even when called asynchronously (e.g. deferred callbacks, `setTimeout`).

### Reading values

```ts
// Inside any handler running under the scope:
const tenantId = useTenantId(); // throws if required and not set
const locale = useLocale();     // returns undefined if optional and not set
```

### Per-connection state across WebSocket and REST

By default the library uses a `Connection` object as the scope, resolved from an HTTP-only cookie (`socket-api-conn`). This means the same logical client — whether connecting over WebSocket or REST — shares one scope bucket. Any value set during a WebSocket handler is visible to subsequent REST requests from the same browser.

```ts
// In a WebSocket action handler (server-side):
setTenantId('acme');

// In a REST route handler for the same client (same cookie):
const tenantId = useTenantId(); // → 'acme'
```

### Scoping rules

| Situation | Behaviour |
|---|---|
| `required` key not set | `useX()` throws |
| `optional` key not set | `useX()` returns `undefined` |
| Value set inside `wrap(obj, ...)` | Stored on `obj`; visible to inner `wrap` calls with the same or child chain |
| Value set outside any `wrap` | Stored globally (fallback for all scopes) |
| Nested `wrap` with same key | Inner value shadows outer; outer is restored after inner exits |

---

## Authentication

Authentication uses a typed factory, `defineAuthentication<UserType, CredentialsType>()`, that returns `configureAuthentication` (server) and `useAuthentication` (server + client). Sessions are stored as **HttpOnly cookies** — no localStorage, no JWT in JavaScript.

### 1. Define the auth shape (shared)

```ts
import { defineAuthentication } from '@anupheaus/socket-api';

export const { configureAuthentication, useAuthentication } =
  defineAuthentication<MyUser, { email: string; password: string }>();
```

### 2. Configure on the server

```ts
await startServer({
  name: 'api',
  server,
  auth: configureAuthentication({
    mode: 'jwt',
    store: myJwtStore,         // implements SocketAPIAuthStore
    onAuthenticate: async ({ email, password }) => findUser(email, password) ?? undefined,
    onGetUser: async (userId) => getUserById(userId),
  }),
});
```

`myJwtStore` must implement `SocketAPIAuthStore` — `create`, `findById`, `findBySessionToken`, `findByDevice`, and `update`.

### 3. Sign in on the client

```tsx
function LoginForm() {
  const { signIn } = useAuthentication();
  return (
    <button onClick={() => signIn({ email: 'alice@example.com', password: 's3cr3t' })}>
      Sign in
    </button>
  );
}
```

`signIn` POSTs credentials to `/{name}/socketAPI/signin`, the server sets an HttpOnly cookie, and the socket reconnects automatically so the session is picked up immediately.

### 4. Read the current user

```tsx
function Header() {
  const { user, signOut } = useAuthentication<MyUser>();
  // user is reactive — only triggers re-renders if destructured
  return user ? <span>{user.name} <button onClick={signOut}>Sign out</button></span> : null;
}
```

### Server-side access

Inside any action or subscription handler:

```ts
const { user, setUser, signOut } = useAuthentication<MyUser>();
```

`setUser` also pushes the updated user to the client via the `socketAPIUserChanged` internal event when `syncUserToClient` is `true` (default).

---

## Testing

```bash
# Unit + integration + E2E (excludes slow perf smoke; starts a real server for tests/e2e/)
npm test

# E2E only (starts a real server)
npm run test:e2e

# Sequential RPC smoke / loose throughput (separate server on namespace test-perf)
npm run test:perf

# CI: everything above including perf
npm run test-ci
```

Dev webpack (`npm start` / `npm run server`) uses **`tests/harness/`** as the demo client + server entry (see `webpack.config.js`).

---

## License

Apache-2.0
