# Subscriptions (streaming)

> Streaming subscriptions: subscribe, push updates with update(), unsubscribe, and the initial response rule.
>
> Status: accepted · Version 1

A subscription starts a stream with one request, delivers many typed updates, and stops cleanly.

```ts
export const liveStats = defineSubscription<{ interval: number }, { count: number }>()('liveStats');
```

## Server: createServerSubscription

```ts
createServerSubscription(liveStats, async ({ request, subscriptionId, update, onUnsubscribe }) => {
  const timer = setInterval(() => update({ count: ++count }), request.interval);
  onUnsubscribe(() => clearInterval(timer));
  return { count: 0 };
});
```

| Parameter | Role |
|---|---|
| `request` | the payload from the client's `subscribe(request)` |
| `subscriptionId` | unique id for this subscription instance |
| `update(response)` | push a new value to the subscriber |
| `onUnsubscribe(fn)` | cleanup when the client unsubscribes or disconnects |

You must return the initial response value from the handler.

## Client: useSubscription

`const { subscribe, unsubscribe, onCallback } = useSubscription(liveStats)`. Register `onCallback` before or together with `subscribe` so no early update is missed.

Wire name: `nexus.subscriptions.{subscriptionName}`.
