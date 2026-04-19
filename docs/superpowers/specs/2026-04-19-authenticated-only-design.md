---
title: AuthenticatedOnly Component
date: 2026-04-19
status: approved
---

# AuthenticatedOnly Component

## Overview

A React authentication gate component that conditionally renders its children only when the current user is authenticated. Renders an optional fallback (default `null`) when unauthenticated.

## Location

- **New file:** `src/client/providers/user/AuthenticatedOnly.tsx`
- **Export via:** `src/client/providers/user/index.ts`
- **Re-export via:** `src/client/index.ts`

## API

```tsx
interface Props {
  children: ReactNode;
  fallback?: ReactNode;  // defaults to null
}
```

### Behaviour

- Calls `useUser()` to obtain the reactive `user` value from `UserContext`.
- If `user` is truthy, renders `children`.
- If `user` is `undefined` / falsy, renders `fallback` (default `null`).
- Reactively updates when auth state changes (user signs in or signs out) because `useUser()` observes `DistributedState<SocketAPIUser | undefined>`.

## Implementation

```tsx
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useUser } from './useUser';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export const AuthenticatedOnly = createComponent('AuthenticatedOnly', ({ children, fallback = null }: Props) => {
  const { user } = useUser();
  return user ? <>{children}</> : <>{fallback}</>;
});
```

## Usage Example

```tsx
<AuthenticatedOnly fallback={<LoginPage />}>
  <Dashboard />
</AuthenticatedOnly>
```

## Constraints & Notes

- Must be rendered inside `SocketAPI` (which wraps `AuthenticationProvider` → `UserContext`). `useUser()` throws if the context is not available.
- Children access the authenticated user via `useUser()` directly — no render prop.
- No new context, provider, or state is introduced.

## Testing

- Unit test: renders children when `user` is set; renders fallback when `user` is `undefined`.
- Unit test: renders `null` (not fallback) when no `fallback` prop is provided and user is unauthenticated.
- Unit test: switches from fallback → children when user state transitions to authenticated.
