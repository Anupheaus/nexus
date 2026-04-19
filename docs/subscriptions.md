# Subscriptions (streaming)

Subscriptions let a client **start** a stream with an initial request, receive **many** typed updates from the server, and **stop** cleanly.

## Contract

```ts
import { defineSubscription } from '@anupheaus/socket-api/common';

export const liveStats = defineSubscription<{ interval: number }, { count: number }>()('liveStats');
```

## Server: `createServerSubscription`

```ts
createServerSubscription(liveStats, async ({ request, subscriptionId, update, onUnsubscribe }) => {
  let count = 0;
  const timer = setInterval(() => update({ count: ++count }), request.interval);
  onUnsubscribe(() => clearInterval(timer));
  return { count: 0 }; // initial value delivered to the client
});
```

| Parameter | Role |
|-----------|------|
| `request` | Typed payload from `subscribe(request)` on the client |
| `subscriptionId` | Unique id for this subscription instance |
| `update(response)` | Push a new value to the subscriber |
| `onUnsubscribe(fn)` | Register cleanup when the client unsubscribes or disconnects |

You **must** return the initial response value from the handler.

## Client: `useSubscription`

```ts
const { subscribe, unsubscribe, onCallback } = useSubscription(liveStats);

onCallback(({ count }) => console.log('count:', count));
subscribe({ interval: 500 });
// ...
unsubscribe();
```

Register `onCallback` before or in tandem with `subscribe` depending on your UI needs so you do not miss early updates.

## Wire format

Subscription channel pattern: `socket-api.subscriptions.{subscriptionName}`.

## Related

- [Contracts](./contracts.md)
- [Server guide](./server-guide.md) / [Client guide](./client-guide.md)
