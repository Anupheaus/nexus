# Async context and connection scope

> createAsyncContext: per-connection state readable anywhere in scope, shared between WebSocket and REST.
>
> Status: accepted · Version 1

`createAsyncContext({ tenantId: required<string>(), locale: optional<string>() })`, from `@anupheaus/nexus/server`, returns `wrap` plus a `setX`/`useX` accessor per key, so values can be read anywhere inside a logical connection scope without threading parameters through every callback. `useX()` throws when a `required` key is unset and returns `undefined` for `optional`.

```ts
const run = wrap(connection, () => { setTenantId('acme'); return doWork(); });
run();
```

Nested `wrap` calls shadow keys, and the outer values are restored when the inner one completes.

Scope follows a `Connection` object derived from the `nexus-conn` cookie by default, so state set during a WebSocket handler is readable in a later REST request from the same browser session. The library uses this internally for the logger, auth data and client handles; extend it for tenant ids, feature flags or experiment assignment, as long as you set values on the same scope object the library uses for that connection.
