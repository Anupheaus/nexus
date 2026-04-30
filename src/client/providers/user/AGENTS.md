# client/providers/user — User State Provider (migration shim)

> **Migration in progress:** `useUser` and `AuthenticatedOnly` have moved to `src/client/auth/`.
> This folder's `index.ts` re-exports them from there. The shim will be removed in Task 9.

Exposes the currently authenticated user and auth status throughout the React tree.

## Files

| File | Purpose |
|------|---------|
| `AuthenticationProvider.tsx` | React provider — syncs auth state from the socket connection and makes user available via context |
| `index.ts` | Re-export shim — forwards `useUser` and `AuthenticatedOnly` from `../../auth/` during migration |

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
