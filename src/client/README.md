# client — React Client Library

React hooks and providers for consuming a socket-api server from a React application. Import from `@anupheaus/socket-api/client`.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [hooks/](hooks/README.md) | `useAction`, `useEvent`, `useSubscription` — the primary consumer API |
| [providers/](providers/README.md) | `SocketProvider` and supporting context providers — mount these at your app root |
| [auth/](auth/README.md) | `defineAuthentication` — client-side login/logout setup |

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

const [getUser, { isLoading }] = useAction(getUserAction);
const user = await getUser({ id: '123' });
```

**3. Subscribe to live data:**
```tsx
import { useSubscription } from '@anupheaus/socket-api/client';
import { liveStatsSubscription } from '../shared/contracts';

const [stats] = useSubscription(liveStatsSubscription, undefined, {
  onUpdate: setStats,
});
```

**4. Listen for events:**
```tsx
import { useEvent } from '@anupheaus/socket-api/client';
import { userUpdatedEvent } from '../shared/contracts';

useEvent(userUpdatedEvent, (user) => console.log('updated', user));
```
