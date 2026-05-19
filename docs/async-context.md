# Async context (`createAsyncContext`)

The server uses a typed **AsyncLocalStorage**-style helper so values can be read anywhere inside a logical **connection scope** without threading parameters through every callback.

**Import:** `@anupheaus/nexus/server` (re-exported async-context module)

## Defining a schema

```ts
import { createAsyncContext, optional, required } from '@anupheaus/nexus/server';

const { wrap, setTenantId, useTenantId } = createAsyncContext({
  tenantId: required<string>(),
  locale: optional<string>(),
});
```

- **`required`** — `useX()` throws if unset.
- **`optional`** — `useX()` returns `undefined` if unset.

## Establishing scope: `wrap`

`wrap(scopeObject, handler)` runs `handler` with values stored on that scope (and restored afterward). You can use a **fixed** scope or a **selector** that derives the scope from handler arguments.

```ts
const run = wrap(connection, () => {
  setTenantId('acme');
  return doWork();
});
run();
```

Nested `wrap` calls shadow keys; outer values restore when the inner completes.

## WebSocket and REST sharing the same scope

By default the library ties scope to a **Connection** object derived from an HTTP-only cookie (`nexus-conn`). That means state you set during a WebSocket handler can be read in a later **REST** request from the same browser session.

## Library usage

Internally, `logger`, auth data, and client handles use this pattern. You can extend it for tenant ids, feature flags, or experiment assignment as long as you respect the same scope object the library uses for that connection.

## Related

- [HTTP, Koa, and lifecycle](./http-koa-lifecycle.md) — where Koa attaches to the engine
- [Server guide](./server-guide.md)
