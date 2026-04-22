# client/providers — React Context Providers

React providers that establish the socket connection and share state (socket, subscriptions, user) across the component tree. Mount `SocketProvider` at the root of any subtree that uses socket-api hooks.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [socket/](socket/AGENTS.md) | `SocketProvider` — establishes and manages the WebSocket connection |
| [subscription/](subscription/AGENTS.md) | Routes incoming subscription updates to the correct hook instances |
| [user/](user/AGENTS.md) | `AuthenticatedOnly` component and `useUser` hook for auth-gated rendering |

## Typical setup

```tsx
import { SocketProvider } from '@anupheaus/socket-api/client';

function App() {
  return (
    <SocketProvider url="https://api.example.com" name="my-socket">
      <Router />
    </SocketProvider>
  );
}
```

`SocketProvider` automatically mounts the subscription and user providers internally.
