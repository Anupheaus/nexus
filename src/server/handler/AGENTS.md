# server/handler — Core Message Handler

Internal factory layer that wraps socket.io event listeners with authentication, logging, rate limiting, concurrency control, and error handling. You do not use this directly — `createServerActionHandler` and `createServerSubscription` build on top of it.

## Files

| File | Purpose |
|------|---------|
| `createServerHandler.ts` | Generic factory that attaches a socket.io `on()` listener with the full middleware stack |
| `handlerUtils.ts` | `NexusServerHandlerActionUtils` type, transport-specific factory functions (`createSocketHandlerUtils`, `createRestHandlerUtils`), cookie helpers, and the redirect symbol |
| `actionLimitGate.ts` | Implements concurrency and queue limits — controls how many invocations run simultaneously |
| `setupHandlers.ts` | Called once per connected client to register all action and subscription handlers on that socket |

## Handler lifecycle (per invocation)

1. Request received via socket ACK
2. `onBeforeHandle` hook called (if configured on the server)
3. Auth check — unauthenticated clients are rejected unless `isPublic: true`
4. Concurrency gate — waits if the concurrent limit is reached, queues if queue is configured, rejects if queue is full
5. Handler function called
6. Response sent back via ACK
7. Errors are sanitised (stack traces stripped) before being returned to the client

## Concurrency model

`actionLimitGate` uses a token-bucket approach:
- `concurrent.max` — maximum simultaneous in-flight invocations (shared across all clients)
- `queue.max` — maximum waiting requests when all slots are busy
- `queue.timeout` — milliseconds a queued request may wait before failing with a timeout error
