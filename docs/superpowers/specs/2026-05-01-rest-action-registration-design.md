# Design: REST Action Registration Aligned with Socket Actions

**Date:** 2026-05-01  
**Status:** Approved

## Problem

REST action routes are registered eagerly into a global module-level `Map` (`restActionRegistry`) the moment `createServerActionHandler` is called — regardless of whether that handler is ever passed to `startServer`. This means actions created anywhere in the codebase silently acquire REST routes even if the developer never included them in the server configuration. Socket handlers work correctly: they are only registered for actions explicitly passed into `startServer.actions`.

## Goal

REST actions should only gain routes when their `NexusServerAction` is included in the `actions` array passed to `startServer` — mirroring the socket registration model exactly.

## Design

### Unified handler object shape

All server-side handler types are given a consistent object interface instead of being bare `() => void` aliases.

```ts
// Base — shared by both actions and subscriptions
interface NexusServerHandler {
  registerSocket(): void;
}

// Actions carry their REST entry in addition to socket registration
interface NexusServerAction extends NexusServerHandler {
  restEntry: RestActionRegistryEntry;  // internal type, not exported publicly
}

// Subscriptions are socket-only, no REST surface
interface NexusServerSubscription extends NexusServerHandler {}
```

`RestActionRegistryEntry` remains an internal implementation detail:

```ts
interface RestActionRegistryEntry {
  action: NexusAction<string, unknown, unknown>;
  handler: NexusServerHandlerFunction<unknown, unknown>;
  limitGate: ActionLimitGate;
}
```

### Registration flow

**Socket registration** (unchanged in behaviour):  
`setupHandlers` calls `handler.registerSocket()` on every item in `[...actions, ...subscriptions]`. This registers the socket event listener on the connected client — same timing as before, just via a method call instead of invoking the function directly.

**REST registration** (fixed):  
`registerRestActions` receives `NexusServerAction[]` as a parameter. It builds a local `Map<name, RestActionRegistryEntry>` from only those actions and uses it for both the catch-all POST route and any explicit method/URL routes. No global state involved.

**Auth actions** (fixed as a consequence):  
`registerAuthRoutes` currently discards the return values of the action creator calls. After the change it returns `NexusServerAction[]`. `startServer` combines these with the user-provided actions before calling `registerRestActions`:

```ts
const authActions = auth ? registerAuthRoutes(auth) : [];
registerRestActions(router, name, registry, [...(actions ?? []), ...authActions]);
```

Auth actions' `registerSocket()` methods are intentionally never called — they are REST-only (cookie-setting endpoints cannot work over a socket ack).

### Global registry eliminated

`restActionRegistry.ts` and its test file are deleted. The registry was the root cause: it accumulated every created action at module load time. The new design passes entries explicitly through function arguments with no shared mutable state.

## Files changed

| File | Change |
|------|--------|
| `src/server/handler/createServerHandler.ts` | Returns `{ registerSocket(): void }` instead of `() => void` |
| `src/server/actions/createServerActionHandler.ts` | Returns `NexusServerAction` object with `restEntry`; removes `registerRestAction` call |
| `src/server/subscriptions/createServerSubscription.ts` | Returns `NexusServerSubscription` object with `registerSocket()` |
| `src/server/handler/setupHandlers.ts` | Calls `handler.registerSocket()` instead of `handler()` |
| `src/server/actions/registerRestActions.ts` | Accepts `NexusServerAction[]` param; builds local map; removes global registry imports |
| `src/server/auth/registerAuthRoutes.ts` | Returns `NexusServerAction[]` |
| `src/server/startServer.ts` | Collects auth actions; passes combined list to `registerRestActions` |
| `src/server/actions/restActionRegistry.ts` | **Deleted** |
| `src/server/actions/restActionRegistry.tests.ts` | **Deleted** |
| `src/server/actions/registerRestActions.tests.ts` | Updated: builds `NexusServerAction` objects directly instead of populating global registry |
| `src/server/auth/registerAuthRoutes.tests.ts` | Updated: asserts return value contains the expected actions |
| `src/server/actions/createServerActionHandler.tests.ts` | Updated: factory test checks object shape instead of `instanceof Function` |

## Error handling / edge cases

- If an action with `transport: ['socket']` is invoked via REST, the existing 405 transport-enforcement check in `executeRestEntry` still fires — no change needed there.
- Auth actions not being passed to `setupHandlers` is intentional and preserved — they must remain REST-only.
- `createServerHandler` still maintains its `registeredHandlers` Set guard against duplicate socket handler registration; this is unaffected by the shape change.

## Testing

- All existing `registerRestActions` integration tests are preserved in behaviour; only the setup (populating via direct construction rather than global registry) changes.
- The `registerAuthRoutes` tests gain an assertion that the returned array contains the expected action objects.
- The `createServerActionHandler` factory unit test is updated to check for `restEntry` and `registerSocket` on the returned object.
- No new test files are needed — the existing suite covers all cases.
