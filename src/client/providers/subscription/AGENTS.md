# client/providers/subscription — Subscription State Provider

Manages active subscriptions for the connected client. Routes server-sent subscription updates to the correct `useSubscription` hook instances.

## Files

| File | Purpose |
|------|---------|
| `SubscriptionProvider.tsx` | React provider — tracks all active subscriptions and delivers incoming updates |
| `Subscription.ts` | Internal class that wraps a single subscription lifecycle (subscribe request, update delivery, unsubscribe cleanup) |

## Usage

`SubscriptionProvider` is included automatically inside `SocketProvider` — you do not need to add it separately. Use `useSubscription` in your components to consume subscriptions.

```tsx
// Already handled by SocketProvider:
<SocketProvider url="..." name="...">
  {/* SubscriptionProvider is mounted here internally */}
  <YourApp />
</SocketProvider>
```
