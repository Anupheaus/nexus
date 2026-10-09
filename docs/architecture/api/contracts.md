# Contracts: defineAction, defineEvent, defineSubscription

> defineAction, defineEvent and defineSubscription: the three typed contracts and the wire names they produce.
>
> Status: accepted · Version 1

Contracts are typed descriptors shared by the server and the client, imported from `@anupheaus/nexus/common`. Each carries its wire name.

```ts
export const getUser = defineAction<{ id: string }, { name: string; email: string }>()('getUser');
export const notify = defineEvent<{ message: string }>('notify');
export const liveStats = defineSubscription<{ interval: number }, { count: number }>()('liveStats');
```

- **Actions** — one request, one response. Client-to-server and server-to-client calls reuse the same wire name, `nexus.actions.{name}`.
- **Events** — one-way server-to-client push, `nexus.events.{name}`.
- **Subscriptions** — the client subscribes with one request and the server pushes many responses, `nexus.subscriptions.{name}`.

Keep contracts in a module both bundles import so names and payload types cannot drift, and choose stable name strings: they map directly to internal event names.
