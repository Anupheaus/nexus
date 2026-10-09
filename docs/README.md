# Vision docs

Architecture decisions, patterns and coding standards. Each doc is short and covers one topic: scan this index, then open only the docs your task touches. Every folder also has an `index.md` describing what's in it.

These files are maintained by the Architect agent in Forge and synced from there, so edits made here by hand will be overwritten. To change or record a decision, tell any Forge agent; it goes to the Architect.

## [APIs](architecture/api/index.md)

The contracts nexus exposes: actions, events and subscriptions, with their wire names.

- [Actions (RPC)](architecture/api/actions.md): How to register and call request/response actions in both directions, and how errors surface.
- [Contracts: defineAction, defineEvent, defineSubscription](architecture/api/contracts.md): defineAction, defineEvent and defineSubscription: the three typed contracts and the wire names they produce.
- [Events (server push)](architecture/api/events.md): Server-pushed one-way events: how the server emits to the current connection and the client subscribes.
- [Subscriptions (streaming)](architecture/api/subscriptions.md): Streaming subscriptions: subscribe, push updates with update(), unsubscribe, and the initial response rule.

## [Guides](guides/index.md)

Setting up nexus: authentication, async context, HTTP/Koa and lifecycle hooks.

- [Async context and connection scope](guides/async-context.md): createAsyncContext: per-connection state readable anywhere in scope, shared between WebSocket and REST.
- [Authentication](guides/authentication.md): How defineAuthentication wires sessions: server config, the sign-in and sign-out routes, client state and the store.
- [HTTP, Koa and lifecycle](guides/http-and-lifecycle.md): startServer's return value, REST beside sockets, route registration and every socket lifecycle hook.
- [nexus — repo overview](guides/repo-overview.md): What @anupheaus/nexus is, what it depends on, and who reads its docs.
