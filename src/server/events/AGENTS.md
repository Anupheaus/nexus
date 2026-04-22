# server/events — Event Broadcasting

Push one-way events from the server to connected clients.

## Files

| File | Purpose |
|------|---------|
| `useEvent.ts` | Hook to emit a typed event to the current client (or broadcast) from within a handler |

## Usage

```ts
import { useEvent } from '@anupheaus/socket-api/server';
import { userUpdatedEvent } from '../shared/contracts';

const handleUpdateUser = createServerActionHandler(updateUserAction, async (user) => {
  await db.users.update(user);
  const emit = useEvent(userUpdatedEvent);
  await emit(user); // sends to the connected client that made the request
});
```

Events are fire-and-forget — they do not return a response. The client receives them via `useEvent` on the client side.
