# server — Node.js Server Library

The server-side half of socket-api. Provides typed action, subscription, and event handlers over Socket.IO, with built-in JWT auth, rate limiting, REST fallback, and concurrency control.

Import from `@anupheaus/socket-api/server`.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [actions/](actions/AGENTS.md) | `createServerActionHandler` — register typed request/response handlers |
| [subscriptions/](subscriptions/AGENTS.md) | `createServerSubscription` — register live data stream handlers |
| [events/](events/AGENTS.md) | `useEvent` — push one-way events to clients |
| [auth/](auth/AGENTS.md) | `defineAuthentication` — JWT auth with sign-in/sign-out endpoints |
| [security/](security/AGENTS.md) | Rate limiting, CORS, body size limits, and security headers |
| [async-context/](async-context/AGENTS.md) | `useConfig`, `useLogger`, `useClient` — per-socket state via AsyncLocalStorage |
| [handler/](handler/AGENTS.md) | Internal handler factory (concurrency, auth checks, error sanitisation) |
| [providers/](providers/AGENTS.md) | Internal socket, Koa, and connection infrastructure |

## Minimal example

```ts
import http from 'http';
import { startServer, createServerActionHandler } from '@anupheaus/socket-api/server';
import { defineAction } from '@anupheaus/socket-api/common';

const greetAction = defineAction<{ name: string }, string>()('greet');
const handleGreet = createServerActionHandler(greetAction, async ({ name }) => `Hello, ${name}!`);

const server = http.createServer();
await startServer({ name: 'my-api', server, actions: [handleGreet] });
server.listen(3000);
```

## `startServer` config

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Namespace name — must match `SocketProvider name` on the client |
| `server` | `http.Server` | Your Node HTTP server |
| `actions` | `SocketAPIServerAction[]` | Action handlers |
| `subscriptions` | `SocketAPIServerSubscription[]` | Subscription handlers |
| `auth` | `AuthConfig` | From `defineAuthentication().configureAuthentication(...)` |
| `security` | `SecurityConfig` | Rate limit, CORS, body size overrides |
| `privateKey` | `string` | PEM private key for JWT signing |
| `onBeforeHandle` | `(socket) => void` | Called before every action/subscription invocation |
| `onClientConnected` | `(socket) => void` | Called when a client connects |
| `onClientDisconnected` | `(socket) => void` | Called when a client disconnects |
| `onRegisterRoutes` | `(router) => void` | Add custom Koa routes |
