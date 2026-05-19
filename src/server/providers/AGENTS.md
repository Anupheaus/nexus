# server/providers — Low-Level Server Providers

Internal modules that set up the HTTP, socket, and connection infrastructure. Most of this is wired together automatically by `startServer` — you do not interact with these directly unless building framework extensions.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [socket/](socket/AGENTS.md) | Socket.IO server creation and client-connected lifecycle |
| [connection/](connection/AGENTS.md) | Session tracking and async context binding per connection |
| [authentication/](authentication/AGENTS.md) | `useAuthentication()` hook for accessing user state in handlers |
| `koa/` | Koa HTTP app setup (body parser, request logger, security middleware) |
| `logger/` | Request logging middleware |

## Files

| File | Purpose |
|------|---------|
| `useClient.ts` | `useClient()` — returns the raw `Socket` instance for the current connection, or `undefined` if called outside a socket context |

## Key export

`useSocketAPI()` — available from `@anupheaus/nexus/server` — returns the socket-api API surface for the current connection:

```ts
const { getClient, setUser, getUser, config } = useSocketAPI();
```
