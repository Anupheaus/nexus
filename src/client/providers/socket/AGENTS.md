# client/providers/socket — WebSocket Connection Provider

Creates and manages the Socket.IO client connection. `SocketProvider` must wrap your app (or the subtree that uses nexus hooks).

## Files

| File | Purpose |
|------|---------|
| `SocketProvider.tsx` | React provider — establishes the socket connection and makes it available to all children |
| `createClientSocket.ts` | Internal factory that builds the `socket.io-client` instance with the custom parser, WS/WSS protocol, and WebSocket transport |
| `SocketContext.ts` | React context — exposes `connect`, `disconnect`, and event registration to consumers |
| `useSocket.ts` | Hook to access the socket context; throws if `SocketProvider` is not present |
| `tokenStorage.ts` | `TokenStorage` interface for non-cookie token persistence (Capacitor) |
| `clientLogRelayLevel.ts` | `setClientLogRelayLevel(level)` (exported from `@anupheaus/nexus/client`): the lowest level the client relays to the server over `nexus.log`; the relay listener reads it per entry, so a change applies at once. Default 0 (everything). Lets an app follow a server-pushed level (a subscription) so quiet levels cost no socket traffic; the server still decides what it keeps |

## Usage

```tsx
// App.tsx
import { SocketProvider } from '@anupheaus/nexus/client';

<SocketProvider host="api.example.com" name="my-socket">
  <YourApp />
</SocketProvider>
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `host` | `string?` | WebSocket server host (no protocol prefix). Defaults to `window.location.host` |
| `name` | `string` | Socket namespace name — must match the `name` passed to `startServer` |
| `auth` | `Record<string, string>?` | Auth object passed in the socket.io handshake (available as `socket.handshake.auth` on the server) |
| `autoConnect` | `boolean?` | Connect immediately on mount (default: `true`). When `false`, the socket is not created until `connect()` is called |
| `tokenStorage` | `TokenStorage?` | Token storage for environments that cannot rely on HttpOnly cookies (e.g. Capacitor) |
| `children` | `ReactNode?` | Subtree that will have access to the socket context |

Disconnects are logged at **warn** with Socket.IO `reason` and transport name. Common reasons: `ping timeout` (server or tab stalled), `transport close`, `io server disconnect`.
