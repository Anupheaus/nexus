# client/providers/socket — WebSocket Connection Provider

Creates and manages the Socket.IO client connection. `SocketProvider` must wrap your app (or the subtree that uses socket-api hooks).

## Files

| File | Purpose |
|------|---------|
| `SocketProvider.tsx` | React provider — establishes the socket connection and makes it available to all children |
| `createClientSocket.ts` | Internal factory that builds the `socket.io-client` instance with the custom parser and correct WS/WSS protocol |
| `SocketContext.ts` | React context — exposes `connect`, `disconnect`, and event registration to consumers |
| `useSocket.ts` | Hook to access the socket context; throws if `SocketProvider` is not present |

## Usage

```tsx
// App.tsx
import { SocketProvider } from '@anupheaus/socket-api/client';

<SocketProvider url="https://api.example.com" name="my-socket">
  <YourApp />
</SocketProvider>
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `url` | `string` | WebSocket server URL |
| `name` | `string` | Socket namespace name — must match the `name` passed to `startServer` |
| `autoConnect` | `boolean?` | Connect immediately on mount (default: `true`) |
