# server/providers/authentication — Auth State Hook

Provides the `useAuthentication()` hook that gives handlers access to the current user session and auth operations.

## Files

| File | Purpose |
|------|---------|
| `useAuthentication.ts` | Hook returning `{ user, setUser, signOut, impersonateUser }` scoped to the current async context |

## Usage

Call `useAuthentication()` inside any action, subscription, or event handler:

```ts
import { useAuthentication } from '@anupheaus/socket-api/server';

const handler = createServerActionHandler(someAction, async () => {
  const { user, signOut } = useAuthentication();
  if (!user) throw new Error('Not authenticated');
  // ...
});
```

For typed access, use the `useAuthentication` returned by `defineAuthentication` in `server/auth` instead — it carries your `User` generic type.
