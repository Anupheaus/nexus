# @anupheaus/socket-api — documentation

Guides and feature references for the typed Socket.IO API layer.

## Guides

| Document | Description |
|----------|-------------|
| [Server guide](./server-guide.md) | Install, bootstrap, handlers, context, HTTP/Koa, and lifecycle from the server perspective |
| [Client guide](./client-guide.md) | React provider, hooks, connection state, and patterns from the browser perspective |

## Feature topics

| Document | Description |
|----------|-------------|
| [Contracts](./contracts.md) | `defineAction`, `defineEvent`, `defineSubscription` in `@anupheaus/socket-api/common` |
| [Actions](./actions.md) | Client→server and server→client RPC, acknowledgements, errors |
| [Events](./events.md) | Server-pushed one-way messages and client listeners |
| [Subscriptions](./subscriptions.md) | Subscribe/unsubscribe streaming and `update()` from the server |
| [Authentication](./authentication.md) | JWT, `setUser`, token storage, reconnect, `useUser` |
| [Async context](./async-context.md) | `createAsyncContext`, per-connection scope, WebSocket + REST sharing |
| [HTTP, Koa, and lifecycle](./http-koa-lifecycle.md) | `startServer` return value, REST alongside sockets, hooks and extension points |

## Elsewhere

- [README](../README.md) — installation, quick start, and condensed API reference
- [agent.md](../agent.md) — maintainer/agent orientation and key source paths
