# Guides

Setting up nexus: authentication, async context, HTTP/Koa and lifecycle hooks.

## Docs

- [Async context and connection scope](async-context.md): createAsyncContext: per-connection state readable anywhere in scope, shared between WebSocket and REST.
- [Authentication](authentication.md): How defineAuthentication wires sessions: server config, the sign-in and sign-out routes, client state and the store.
- [HTTP, Koa and lifecycle](http-and-lifecycle.md): startServer's return value, REST beside sockets, route registration and every socket lifecycle hook.
- [nexus — repo overview](repo-overview.md): What @anupheaus/nexus is, what it depends on, and who reads its docs.
