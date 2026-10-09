# HTTP, Koa and lifecycle

> startServer's return value, REST beside sockets, route registration and every socket lifecycle hook.
>
> Status: accepted · Version 1

`startServer(config)` wires Socket.IO, an internal Koa app and Engine.IO, and resolves to `{ app, io }`. Use `io` for extra namespaces in `onRegisterNamespaces`, or in tests.

## REST alongside sockets

Engine.IO intercepts URLs under the namespace path. The library installs middleware so requests without a `transport` query parameter are forwarded to Koa instead of being treated as handshakes. REST and sockets then share paths without depending on listener order, which matters behind proxies and with HMR.

## Extending HTTP

```ts
await startServer({
  onRegisterRoutes: async router => {
    router.get('/health', ctx => { ctx.body = 'ok'; });
  },
});
```

Those handlers run in the same connection and cookie model as sockets, so `createAsyncContext` values set over the socket are readable there.

## Lifecycle hooks

| Hook | When |
|---|---|
| `onStartup` | after socket server setup, before accepting work |
| `onClientConnecting` | per socket, before handlers are registered |
| `onClientConnected` | after handlers are registered for that socket |
| `onClientDisconnected` | on disconnect |
| `onBeforeHandle` | awaited before each action or subscription handler |
| `onRegisterNamespaces` | after `io` exists |
| `onRegisterRoutes` | register Koa routes |

An optional `logger` (from `@anupheaus/common`) replaces the default `Socket-API` logger, and `clientLoggingService` forwards client logs when configured.
