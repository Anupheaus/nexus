# server/async-context — Async Local Storage Context

Provides per-socket/per-request state (config, current socket, logger, auth data) via Node's `AsyncLocalStorage`. Handlers access this state through hooks like `useConfig()`, `useLogger()` without needing to pass values through every call.

## Files

| File | Purpose |
|------|---------|
| `createAsyncContext.ts` | Generic ALS factory — given a slot definition, returns typed `set*` and `use*` accessors plus a `wrap()` helper |
| `nexusContext.ts` | The nexus instance of the context: exports `wrap`, `useConfig`, `useLogger`, `useClient`, `useAuthData`, and their `set*` counterparts |
| `types.ts` | `required<T>()` and `optional<T>()` helpers for slot definitions |

## How it works

`wrap(client, handler)` runs `handler` inside an ALS scope that has the current `Socket` bound. Any async work that flows from that handler — including across `await` boundaries and nested calls — can call `useClient()` and get the right socket back.

```ts
// Inside any handler (action, subscription, event):
import { useLogger, useClient } from '../async-context/nexusContext';

const logger = useLogger(); // Logger scoped to this server instance
const client = useClient(); // The Socket for the current client connection
```

## Custom context

If you need to carry additional per-request state, create your own context with `createAsyncContext`:

```ts
import { createAsyncContext } from '@anupheaus/nexus/server/async-context';
import { required } from '@anupheaus/nexus/server/async-context/types';

const { wrap, useConfig, setConfig } = createAsyncContext({
  tenantId: required<string>(),
});
```
