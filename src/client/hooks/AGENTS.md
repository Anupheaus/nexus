# client/hooks — React Hooks

Hooks for invoking actions, listening to events, and managing subscriptions. All hooks require a `SocketProvider` ancestor.

## Files

| File | Purpose |
|------|---------|
| `useAction.ts` | Call server actions and track loading/error state |
| `useEvent.ts` | Listen for server-emitted events with auto-cleanup |
| `useSubscription.ts` | Subscribe to live server data streams |
| `useServerActionHandler.ts` | Register a handler for server-initiated actions (advanced use) |
| `resolveTransport.ts` | `resolveTransport` / `isRestOnly` — determines whether to use socket, REST, or wait based on an action's `transport` constraint and current connection state |

## `useAction`

Returns a named-key object `{ [actionName], [useActionName], isConnected }`. Two usage patterns:

**Imperative:**
```tsx
const { getUser } = useAction(getUserAction);
const user = await getUser({ id: '123' });
```

**Reactive:** re-fetches automatically when the request value changes:
```tsx
const { useGetUser } = useAction(getUserAction);
const { response, isLoading, error } = useGetUser({ id: userId });
```

## `useEvent`

Returns a setter function. Call it with your handler during render — the handler ref is updated on every render and removed on unmount.

```tsx
const onUserUpdated = useEvent(userUpdatedEvent);
onUserUpdated((user) => {
  console.log('User updated:', user);
});
```

## `useSubscription`

Returns `{ subscribe, unsubscribe, onCallback }`. Call `onCallback` to register an update handler, then `subscribe` to start streaming.

```tsx
const { subscribe, unsubscribe, onCallback } = useSubscription(liveStatsSubscription);
onCallback((newStats) => console.log(newStats));
subscribe(undefined); // pass request args here
```
