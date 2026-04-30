# client/providers/user — User State Provider (migration shim)

> **Migration in progress:** `useUser`, `AuthenticatedOnly`, and `AuthenticationProvider` have moved to `src/client/auth/`.
> This folder's `index.ts` re-exports `useUser` and `AuthenticatedOnly` from there. The shim will be removed in Task 9.

Exposes the currently authenticated user and auth status throughout the React tree.

## Files

| File | Purpose |
|------|---------|
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
