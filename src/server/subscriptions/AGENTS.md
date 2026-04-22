# server/subscriptions — Subscription Handlers

Register handlers for live data streams. Clients subscribe on mount and unsubscribe on unmount. The server can push updates at any time via `update()`.

## Files

| File | Purpose |
|------|---------|
| `createServerSubscription.ts` | Creates a typed subscription handler with subscribe/unsubscribe lifecycle and per-socket isolation |

## Usage

```ts
import { createServerSubscription } from '@anupheaus/socket-api/server';
import { liveStatsSubscription } from '../shared/contracts';

const handleLiveStats = createServerSubscription(
  liveStatsSubscription,
  async ({ request, update, onUnsubscribe }) => {
    // Send initial data:
    const stats = await db.stats.current();

    // Set up a live feed:
    const interval = setInterval(async () => {
      update(await db.stats.current()); // push to client
    }, 1000);

    // Clean up when the client unsubscribes:
    onUnsubscribe(() => clearInterval(interval));

    return stats; // returned as the initial response
  }
);

await startServer({ subscriptions: [handleLiveStats], ... });
```

## Security

Subscription handlers are scoped per-socket. A client cannot unsubscribe another client's subscription, even if it knows the subscription ID.

## Handler parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `request` | `Request` | The typed request from the client |
| `subscriptionId` | `string` | Unique ID for this subscription instance |
| `update` | `(response: Response) => void` | Call to push a new value to the client |
| `onUnsubscribe` | `(handler: () => void) => void` | Register a cleanup function called when the client unsubscribes or disconnects |
