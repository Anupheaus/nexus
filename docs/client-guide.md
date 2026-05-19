# Client guide

This document explains how to use **@anupheaus/nexus** in a React app: wrapping the tree with `SocketAPI`, calling server actions, listening for events, handling subscriptions, and optional server-initiated RPC.

## Prerequisites

- React 18 (as used by this package)
- Peer dependency: `socket.io-client`

## Imports

```tsx
import {
  SocketAPI,
  useAction,
  useEvent,
  useSubscription,
  useServerActionHandler,
  useUser,
  useSocketAPI,
} from '@anupheaus/nexus/client';
```

Import the **same** contract objects the server uses:

```ts
import { getUser, notifyEvent, liveStats, serverAsksConfirm } from './contracts';
```

## Root provider

Place **`SocketAPI`** high in the tree. **`name`** must match the server `startServer({ name })` value.

```tsx
<SocketAPI name="api" host={optionalHostOverride}>
  <App />
</SocketAPI>
```

| Prop | Purpose |
|------|---------|
| `name` | Namespace identifier; required |
| `host` | Defaults to `window.location.host` |
| `logger` | Optional `@anupheaus/common` logger |
| `auth` | Object passed on the socket handshake (`socket.handshake.auth` on server) |
| `tokenKeyName` | LocalStorage key for JWT (default `nexus-token`) |
| `onInvalidToken` | Called when stored token is invalid |

Internally the tree is: Logger → Socket → Subscription → Authentication providers.

## Calling server actions (client → server)

```ts
const { getUser, useGetUser } = useAction(getUser);

// Imperative
const user = await getUser({ id: '123' });

// Reactive hook: auto-invokes with given args; exposes { response, isLoading, error }
const { response, isLoading } = useGetUser({ id: '123' });
```

Errors from the server that are encoded as `{ error }` are surfaced on the client according to the hook implementation. See [Actions](./actions.md).

## Listening for server events

```ts
const { onNotify } = useEvent(notifyEvent);
onNotify(({ message }) => {
  console.log(message);
});
```

Pattern: get a named registrar from `useEvent`, then call it with your handler (typically during render, similar to `useEffect`-style registration managed by the library).

## Subscriptions

```ts
const { subscribe, unsubscribe, onCallback } = useSubscription(liveStats);

onCallback((data) => console.log(data));
subscribe({ interval: 500 });
// later:
unsubscribe();
```

See [Subscriptions](./subscriptions.md) for server-side pairing.

## Server-initiated actions (server → client)

Register **one** handler per action contract in the React tree:

```ts
useServerActionHandler(confirmClose)(({ saveDraft }) => {
  return { confirmed: true };
});
```

Duplicate registration throws. The return value is sent back to the server as the acknowledgement.

## Current user (after server `setUser`)

```ts
const user = useUser<MyUserType>();
```

Requires the server to have authenticated the connection via `setUser` and JWT configuration. See [Authentication](./authentication.md).

## Low-level socket access

`useSocketAPI` on the client re-exports the socket layer helpers (connection state, testing hooks, etc.):

```ts
const {
  clientId,
  isConnected,
  onConnectionStateChanged,
  testDisconnect,
  testReconnect,
  // ...
} = useSocketAPI();
```

Use typed actions/events/subscriptions for application logic; use this when you need connection lifecycle or debugging.

## Contracts

Always share definitions from `@anupheaus/nexus/common` with the server. See [Contracts](./contracts.md).

## Next steps

- [Events](./events.md) — one-way push semantics
- [Actions](./actions.md) — bidirectional RPC and acknowledgements
