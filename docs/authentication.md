# Authentication (JWT)

The library can issue and verify **JWTs** tied to the logical connection so the client stays authenticated across reconnects.

## Server

1. Pass a **`privateKey`** to `startServer` (used to sign tokens).
2. Inside any action or subscription handler, call **`setUser(user)`** from **`useSocketAPI()`** when you have established identity.

```ts
const { setUser } = useSocketAPI();
setUser({ id: 'user-123', name: 'Alice' });
```

Optional hooks on `ServerConfig` support persisting or loading user-specific secrets (`onSavePrivateKey`, `onLoadPrivateKey`) when you extend the model.

## Client

The **`AuthenticationProvider`** (inside `<SocketAPI>`) stores the token (default localStorage key `socket-api-token`, overridable via `tokenKeyName`).

Read the current user in components:

```ts
const user = useUser<MyUserType>();
```

## Reconnect action

The package defines **`socketAPIAuthenticateTokenAction`** (exported from `@anupheaus/socket-api/common`). The client uses it on reconnect to send the stored token so the server can restore session state.

If the token is invalid, you can react on the client with **`onInvalidToken`** on `<SocketAPI>`.

## Related

- [Server guide](./server-guide.md) — `startServer` options
- [Client guide](./client-guide.md) — `SocketAPI` props
- [Async context](./async-context.md) — connection-scoped state after auth
