# Contracts (common package)

Contracts are **typed descriptors** shared by the server and client. They carry the Socket.IO event name and TypeScript generics for request/response payloads.

**Import path:** `@anupheaus/socket-api/common`

## `defineAction<Request, Response>()(name)`

Creates an **RPC-style** contract: one request shape, one response shape.

```ts
export const getUser = defineAction<{ id: string }, { name: string; email: string }>()('getUser');
```

Used for:

- **Client → server:** `createServerActionHandler` + client `useAction`
- **Server → client:** server `useAction` (from `/server`) + client `useServerActionHandler`

Both directions reuse the same wire name: `socket-api.actions.{name}`.

## `defineEvent<Payload>(name)`

Creates a **one-way** server → client push contract (no acknowledgement payload type on the wire for the event itself).

```ts
export const notify = defineEvent<{ message: string }>('notify');
```

## `defineSubscription<Request, Response>()(name)`

Creates a **streaming** contract: the client sends a subscribe request; the server may push many `Response` values via `update()`.

```ts
export const liveStats = defineSubscription<{ interval: number }, { count: number }>()('liveStats');
```

## Practices

- Keep contracts in a **shared module** imported by both bundles to avoid drift.
- Choose stable string `name` values; they map directly to internal event names.
- See [Actions](./actions.md), [Events](./events.md), and [Subscriptions](./subscriptions.md) for how each contract type is used end-to-end.
