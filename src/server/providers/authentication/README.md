# server/providers/authentication — Auth State Hook

Provides the `useAuthentication()` hook that gives handlers access to the current user session and auth operations.

## Files

| File | Purpose |
|------|---------|
| `useAuthentication.ts` | Hook returning `{ user, setUser, signOut, impersonateUser }` scoped to the current async context |

## Return type

| Member | Type | Description |
|--------|------|-------------|
| `user` | `User \| undefined` | The current user for this request, or `undefined` if unauthenticated |
| `setUser` | `(user: User) => void` | Overwrite the user for the current async context |
| `signOut` | `() => Promise<void>` | Clear the session cookie and nullify the current user |
| `impersonateUser` | `(user: User, fn: () => Promise<void>) => Promise<void>` | Run `fn` as a different user without changing the real session |
| `createInvite` | `(userId: string, baseUrl: string) => Promise<string>` | Creates an invite record in the store, returns `${baseUrl}?requestId=<id>`. WebAuthn mode only — throws in JWT mode. |

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
