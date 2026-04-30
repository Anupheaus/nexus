# client — React Client Library

React hooks and providers for consuming a socket-api server from a React application. Import from `@anupheaus/socket-api/client`.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [hooks/](hooks/AGENTS.md) | `useAction`, `useEvent`, `useSubscription` — the primary consumer API |
| [providers/](providers/AGENTS.md) | `SocketProvider` and supporting context providers — mount these at your app root |
| [auth/](auth/AGENTS.md) | `defineAuthentication`, `useAuthentication`, `AuthenticationProvider`, `AuthenticatedOnly`, `useUser` — hooks, providers, components, and utilities for client-side auth |

## Quick start

**1. Wrap your app:**
```tsx
import { SocketProvider } from '@anupheaus/socket-api/client';

<SocketProvider url="https://api.example.com" name="my-socket">
  <App />
</SocketProvider>
```

**2. Call actions:**
```tsx
import { useAction } from '@anupheaus/socket-api/client';
import { getUserAction } from '../shared/contracts';

const { getUser, useGetUser } = useAction(getUserAction);
// imperative: const user = await getUser({ id: '123' });
// reactive:   const { response, isLoading } = useGetUser({ id: '123' });
```

**3. Subscribe to live data:**
```tsx
import { useSubscription } from '@anupheaus/socket-api/client';
import { liveStatsSubscription } from '../shared/contracts';

const { subscribe, onCallback } = useSubscription(liveStatsSubscription);
onCallback(setStats);
subscribe(undefined);
```

**4. Listen for events:**
```tsx
import { useEvent } from '@anupheaus/socket-api/client';
import { userUpdatedEvent } from '../shared/contracts';

const onUserUpdated = useEvent(userUpdatedEvent);
onUserUpdated((user) => console.log('updated', user));
```
