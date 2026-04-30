# Agent instructions

## Documentation in this repo

Human-oriented guides and feature docs (prefer these when explaining usage or adding examples):

- **Index:** [docs/AGENTS.md](./docs/AGENTS.md)
- **Guides:** [docs/server-guide.md](./docs/server-guide.md), [docs/client-guide.md](./docs/client-guide.md)
- **Features:** [docs/contracts.md](./docs/contracts.md), [docs/actions.md](./docs/actions.md), [docs/events.md](./docs/events.md), [docs/subscriptions.md](./docs/subscriptions.md), [docs/authentication.md](./docs/authentication.md), [docs/async-context.md](./docs/async-context.md), [docs/http-koa-lifecycle.md](./docs/http-koa-lifecycle.md)
- **Quick reference:** [README.md](./README.md)

## Before making changes

- **Read**: [`README.md`](./README.md) — quick start and full API reference for this package

`@anupheaus/socket-api` is a real-time API library built on Socket.IO. It provides a typed, structured way to define and consume **actions** (request/response RPC), **events** (server-to-client push), and **subscriptions** (streaming data with subscribe/unsubscribe).

## Package structure

The package exports three entry points:

- **`@anupheaus/socket-api/server`** – Server-side setup and handlers
- **`@anupheaus/socket-api/client`** – React client components and hooks
- **`@anupheaus/socket-api/common`** – Shared definitions (actions, events, subscriptions, models)

## How it works

### 1. Define contracts (common)

Use the definition helpers to create typed contracts shared by server and client:

```ts
// Actions: request → response (RPC-style)
const myAction = defineAction<{ id: string }, { name: string }>()('myAction');

// Events: server pushes to client (no response)
const myEvent = defineEvent<{ message: string }>('myEvent');

// Subscriptions: client subscribes, server streams updates
const mySubscription = defineSubscription<{ query: string }, { results: string[] }>()('mySubscription');
```

### 2. Server setup

Attach the socket API to an HTTP server:

```ts
import http from 'http';
import { startServer, createServerActionHandler, createServerSubscription } from '@anupheaus/socket-api/server';

const server = http.createServer();
await startServer({
  name: 'api',
  server,
  privateKey: '...', // for JWT auth
  actions: [
    createServerActionHandler(myAction, async ({ id }) => ({ name: await fetchName(id) })),
  ],
  subscriptions: [
    createServerSubscription(mySubscription, async ({ request, subscriptionId, update, onUnsubscribe }) => {
      const interval = setInterval(() => update({ results: [...] }), 1000);
      onUnsubscribe(() => clearInterval(interval));
      return { results: [] };
    }),
  ],
});
server.listen(3000);
```

- **Actions** – Handler receives the request and returns the response.
- **Subscriptions** – Handler receives `request`, `subscriptionId`, `update(response)` to push data, and `onUnsubscribe(handler)` for cleanup.
- **Events** – Use `useEvent(myEvent)` on the server and call the returned function to emit to the connected client.

### 3. Client setup

Wrap the app with `SocketAPI` and use the hooks:

```tsx
import { SocketAPI, useAction, useEvent, useSubscription } from '@anupheaus/socket-api/client';

<SocketAPI name="api">
  <MyApp />
</SocketAPI>
```

- **`useAction(action)`** – Returns `actionName(request)` (Promise) and `useActionName(request)` (reactive state).
- **`useEvent(event)`** – Returns a setter; call it with a handler to listen for server events.
- **`useSubscription(subscription)`** – Returns `subscribe(request)`, `unsubscribe()`, and `onCallback(handler)`.

### 4. Authentication

Authentication uses `defineAuthentication<UserType, CredentialsType>()` — a typed factory that returns `configureAuthentication` (server-only) and `useAuthentication` (client + server):

```ts
// shared (e.g. auth.ts)
import { defineAuthentication } from '@anupheaus/socket-api';
export const { configureAuthentication, useAuthentication } =
  defineAuthentication<MyUser, { email: string; password: string }>();
```

- **Server**: pass `auth: configureAuthentication({ mode: 'jwt', store, onAuthenticate, onGetUser })` to `startServer`. On socket connect the library validates the session cookie and calls `setUser(user)` automatically.
- **Client**: `const { user, signIn, signOut } = useAuthentication()` — `user` is reactive (re-renders on change only if destructured). `signIn(credentials)` POSTs to the signin endpoint and reconnects the socket. Sessions are HttpOnly cookies — no localStorage, no JWT exposure.
- `useAuthentication()` on the **server** returns `{ user, setUser, signOut, impersonateUser }` for use inside action/subscription handlers.

## Key files

| Path | Purpose |
|------|---------|
| `src/server/startServer.ts` | Bootstraps Koa, Socket.IO, handlers, and auth routes |
| `src/server/handler/createServerHandler.ts` | Registers handlers; wraps errors as `{ error }` |
| `src/server/actions/createServerActionHandler.ts` | Client→server action handlers |
| `src/server/actions/useAction.ts` | Server→client RPC (`emitWithAck`; import from `/server`) |
| `src/server/subscriptions/createServerSubscription.ts` | Handles subscribe/unsubscribe and `update()` |
| `src/server/auth/defineAuthentication.ts` | Server-typed `defineAuthentication` factory |
| `src/server/auth/authConfig.ts` | Module-level auth config store (set by `startServer`) |
| `src/server/auth/validateSessionCookie.ts` | Cookie → session lookup → `setUser` on every socket connect |
| `src/server/auth/routes/signinRoute.ts` | `POST /{name}/socketAPI/signin` |
| `src/server/auth/routes/signoutRoute.ts` | `POST /{name}/socketAPI/signout` |
| `src/client/SocketAPI.tsx` | Root provider (Logger → Socket → Subscription → Auth) |
| `src/client/providers/socket/SocketProvider.tsx` | Socket connection; `on`/`off`/`reconnect` |
| `src/client/auth/useAuthentication.ts` | Client auth hook — reactive `user`, `signIn`, `signOut` |
| `src/client/auth/defineAuthentication.ts` | Client-typed `defineAuthentication` factory |
| `src/client/hooks/useAction.ts` | Calls server actions; handles `{ error }` responses |
| `src/client/hooks/useServerActionHandler.ts` | Handles server-initiated actions |
| `src/common/auth/authTypes.ts` | Shared auth record/store interfaces |
| `src/common/socket/SocketIOParser.ts` | Custom parser for serialisation (Dates, etc.) |

## Event naming

- Actions (both directions): `socket-api.actions.{actionName}`
- Events: `socket-api.events.{eventName}`
- Subscriptions: `socket-api.subscriptions.{subscriptionName}`

## Dependencies

- **`@anupheaus/common`** – Logger, utilities, types
- **`@anupheaus/react-ui`** – React components, `createComponent`, `LoggerProvider`, `useSubscription`
- **Socket.IO** – Transport layer

## Future / nice-to-have ideas

- **SSE transport for subscriptions and events** — Server-Sent Events would allow subscriptions and events to work without a WebSocket when one isn't available. HTTP/2 makes this efficient. Deliberately out of scope for now; subscriptions and events are socket-only. Worth a dedicated spec when the need arises.

## Folder AGENTS.md

Every `src/` folder with meaningful complexity has an `AGENTS.md`. These are the primary navigation aid — keep them accurate.

### When to update a folder AGENTS.md

Update the AGENTS.md in any folder you touch if:

- You **add or remove a file** — update the file table in that folder's AGENTS.md.
- You **rename or move a file** — update every AGENTS.md that references it (parent links, file tables).
- You **change a public API** (function signature, option name, hook return shape) — update the usage example in the AGENTS.md for that folder and any parent that shows the same example.
- You **add a new sub-folder** — add a row to the parent AGENTS.md's sub-folder table and create an AGENTS.md in the new folder.

### AGENTS.md hierarchy rules

- **Parent AGENTS.md** (e.g. `src/server/AGENTS.md`) list sub-folders with a one-line description and a link. They also show a minimal end-to-end usage example. Keep them brief.
- **Child AGENTS.md** (e.g. `src/server/actions/AGENTS.md`) contain the full file table, all options/parameters, and detailed usage examples.
- If a child grows complex sub-folders, apply the same pattern recursively.

### Locations

```
src/common/AGENTS.md           ← shared types & utilities
src/common/auth/AGENTS.md
src/common/socket/AGENTS.md
src/client/AGENTS.md           ← React client library
src/client/auth/AGENTS.md
src/client/hooks/AGENTS.md
src/client/providers/AGENTS.md
src/client/providers/socket/AGENTS.md
src/client/providers/subscription/AGENTS.md
src/server/AGENTS.md           ← Node.js server library
src/server/actions/AGENTS.md
src/server/async-context/AGENTS.md
src/server/auth/AGENTS.md
src/server/auth/routes/AGENTS.md
src/server/events/AGENTS.md
src/server/handler/AGENTS.md
src/server/providers/AGENTS.md
src/server/providers/authentication/AGENTS.md
src/server/providers/connection/AGENTS.md
src/server/providers/socket/AGENTS.md
src/server/security/AGENTS.md
src/server/subscriptions/AGENTS.md
```

## Testing

- Unit tests: `pnpm test` (Vitest)
- E2E tests: `pnpm test:e2e` – starts a real server; `socket.io-client` helpers live in `tests/e2e/`
- **Harness** (`tests/harness/`): shared demo app + `configureActions` / fixtures used by E2E, perf, and dev webpack entries

