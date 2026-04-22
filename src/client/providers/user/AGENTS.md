# client/providers/user — User State Provider

Exposes the currently authenticated user and auth status throughout the React tree.

## Files

| File | Purpose |
|------|---------|
| `AuthenticationProvider.tsx` | React provider — syncs auth state from the socket connection and makes user available via context |
| `UserContext.ts` | React context — holds the `user` object and `isAuthenticated` flag |
| `useUser.ts` | Hook to access the current user; throws if `SocketProvider` is not present |
| `AuthenticatedOnly.tsx` | Renders children only when a user is authenticated; shows a fallback otherwise |

## Usage

```tsx
// Protect a route or component:
import { AuthenticatedOnly } from '@anupheaus/socket-api/client';

<AuthenticatedOnly fallback={<LoginPage />}>
  <Dashboard />
</AuthenticatedOnly>
```

```tsx
// Access current user anywhere inside SocketProvider:
import { useUser } from '@anupheaus/socket-api/client';

const { user, isAuthenticated } = useUser();
```
