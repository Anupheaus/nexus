# HTTP, Koa, and lifecycle

`startServer` wires **Socket.IO**, an internal **Koa** app, and **Engine.IO** so browser clients can use WebSockets while ordinary HTTP requests are still served by your routes.

## Return value

`await startServer(config)` resolves to:

| Field | Description |
|-------|-------------|
| `app` | Koa application instance |
| `io` | Socket.IO server |

Use `io` for extra namespaces in `onRegisterNamespaces`, or for tests.

## REST alongside sockets

Engine.IO intercepts URLs under the namespace path. The library installs middleware so requests **without** a `transport` query parameter are forwarded to **Koa** instead of being treated as socket handshakes. That keeps REST and sockets on compatible paths without fragile listener ordering (important for HMR and proxies).

## Extending HTTP: `onRegisterRoutes`

Pass an async callback that receives a **`koa-router`** instance; your routes are mounted on the internal Koa app.

```ts
await startServer({
  // ...
  onRegisterRoutes: async (router) => {
    router.get('/health', (ctx) => {
      ctx.body = 'ok';
    });
  },
});
```

Because those handlers run in the same connection/cookie model as sockets, code using **`createAsyncContext`** can read per-connection values set over the socket. See [Async context](./async-context.md).

## Socket lifecycle hooks

`ServerConfig` includes optional callbacks:

| Hook | When |
|------|------|
| `onStartup` | After socket server setup, before accepting work |
| `onClientConnecting` | Per socket, before handlers are registered |
| `onClientConnected` | After handlers are registered for that socket |
| `onClientDisconnected` | When a socket disconnects |
| `onBeforeHandle` | Awaited before each action/subscription handler |
| `onRegisterNamespaces` | After `io` exists; register more namespaces |
| `onRegisterRoutes` | Register Koa routes on `router` |

## Logging

Optional **`logger`** (`@anupheaus/common` `Logger`) replaces the default `Socket-API` logger. **`clientLoggingService`** integrates client log forwarding when configured.

## Related

- [Server guide](./server-guide.md)
- [Authentication](./authentication.md)
