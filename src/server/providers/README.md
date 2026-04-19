# server/providers — Low-Level Server Providers

Internal modules that set up the HTTP, socket, and connection infrastructure. Most of this is wired together automatically by `startServer` — you do not interact with these directly unless building framework extensions.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [socket/](socket/README.md) | Socket.IO server creation and client-connected lifecycle |
| [connection/](connection/README.md) | Session tracking and async context binding per connection |
| [authentication/](authentication/README.md) | `useAuthentication()` hook for accessing user state in handlers |
| `koa/` | Koa HTTP app setup (body parser, request logger, security middleware) |
| `logger/` | Request logging middleware |

## Key export

`useSocketAPI()` — available from `@anupheaus/socket-api/server` — returns the socket-api API surface for the current connection:

```ts
const { getClient, setUser, getUser, config } = useSocketAPI();
```
