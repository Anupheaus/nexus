# server/providers/socket — Socket.IO Server Setup

Internal setup for the Socket.IO server instance. Not used directly by consumers.

## Files

| File | Purpose |
|------|---------|
| `createServerSocket.ts` | Creates the `socket.io` `Server` with the custom `SocketIOParser` and path filtering (`allowRequest`) |
| `setupSocket.ts` | Attaches the Socket.IO server to the HTTP server and registers the client-connected lifecycle hook |
| `SocketContext.ts` | Stores the active `Socket` in the ALS so handlers can access it via `useClient()` |
| `internalUseSocket.ts` | Internal hook to emit events on the current socket from within a handler |
