# client/hooks — React Hooks

Hooks for invoking actions, listening to events, and managing subscriptions. All hooks require a `SocketProvider` ancestor.

## Files

| File | Purpose |
|------|---------|
| `useAction.ts` | Call server actions and track loading/error state |
| `useEvent.ts` | Listen for server-emitted events with auto-cleanup |
| `useSubscription.ts` | Subscribe to live server data streams |
| `useAuthentication.ts` | Re-exports from `client/auth` — access current user and auth methods |
| `useServerActionHandler.ts` | Register a handler for server-initiated actions (advanced use) |

## `useAction`

Two calling patterns:

**Callback (imperative):**
```tsx
const [getUser, { isLoading, error }] = useAction(getUserAction);
// call manually:
const user = await getUser({ id: '123' });
```

**Reactive (declarative):** pass a request directly; re-fetches whenever the request value changes:
```tsx
const [user, { isLoading, error }] = useAction(getUserAction, { id: userId });
// re-fetches automatically when `userId` changes
```

## `useEvent`

```tsx
useEvent(userUpdatedEvent, (user) => {
  console.log('User updated:', user);
});
```

Listener is automatically removed on unmount.

## `useSubscription`

```tsx
const [stats, { isLoading }] = useSubscription(liveStatsSubscription, undefined, {
  onUpdate: (newStats) => console.log(newStats),
});
```

Subscribes on mount, unsubscribes on unmount.
