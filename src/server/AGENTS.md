# server — Node.js Server Library

The server-side half of socket-api. Provides typed action, subscription, and event handlers over Socket.IO, with built-in JWT auth, rate limiting, REST fallback, and concurrency control.

Import from `@anupheaus/nexus/server`.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [actions/](actions/AGENTS.md) | `createServerActionHandler` — register typed request/response handlers |
| [subscriptions/](subscriptions/AGENTS.md) | `createServerSubscription` — register live data stream handlers |
| [events/](events/AGENTS.md) | `useEvent` — push one-way events to clients |
| [auth/](auth/AGENTS.md) | `defineAuthentication` — JWT, WebAuthn, and Google OAuth authentication |
| [security/](security/AGENTS.md) | Rate limiting, CORS, body size limits, and security headers |
| [async-context/](async-context/AGENTS.md) | `useConfig`, `useLogger`, `useClient` — per-socket state via AsyncLocalStorage |
| [handler/](handler/AGENTS.md) | Internal handler factory (concurrency, auth checks, error sanitisation) |
| [providers/](providers/AGENTS.md) | Internal socket, Koa, and connection infrastructure |
| [ssl/](ssl/AGENTS.md) | `createSSLServer` — optional built-in SSL server creation via `selfsigned-ca` |

## Minimal example

```ts
import http from 'http';
import { startServer, createServerActionHandler } from '@anupheaus/nexus/server';
import { defineAction } from '@anupheaus/nexus/common';

const greetAction = defineAction<{ name: string }, string>()('greet');
const handleGreet = createServerActionHandler(greetAction, async ({ name }) => `Hello, ${name}!`);

// Option A: pass an existing server
const server = http.createServer();
const { app, io } = await startServer({ name: 'my-api', server, actions: [handleGreet] });
server.listen(3000);

// Option B: let startServer manage SSL internally
const { app, io, startListening, stopListening } = await startServer({
  name: 'my-api',
  ssl: { host: 'localhost', port: 3000, certsPath: './certs' },
  actions: [handleGreet],
});
await startListening();
// later:
await stopListening();
```

## `startServer` config

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Namespace name — must match `SocketProvider name` on the client |
| `server` | `http.Server` | Your Node HTTP server (mutually exclusive with `ssl`) |
| `ssl` | `SSLConfig` | SSL config — when provided (instead of `server`), `startServer` creates and manages the HTTPS server |
| `actions` | `NexusServerAction[]` | Action handlers |
| `subscriptions` | `NexusServerSubscription[]` | Subscription handlers |
| `auth` | `AuthConfig` | From `defineAuthentication().configureAuthentication(...)` |
| `security` | `SecurityConfig` | Rate limit, CORS, body size overrides |
| `privateKey` | `string` | PEM private key for JWT signing |
| `onBeforeHandle` | `(socket) => void` | Called before every action/subscription invocation |
| `onClientConnected` | `(socket) => void` | Called when a client connects |
| `onClientDisconnected` | `(socket) => void` | Called when a client disconnects |
| `onRegisterRoutes` | `(router) => void` | Add custom Koa routes |

## `startServer` return value

| Field | Type | Description |
|-------|------|-------------|
| `app` | `Koa` | The Koa application instance |
| `io` | `Server` | The Socket.IO server instance |
| `server` | `AnyHttpServer` | The underlying HTTP/HTTPS server |
| `startListening` | `() => Promise<void>` | Start listening on the configured port — no-op when an external `server` was provided |
| `stopListening` | `() => Promise<void>` | Stop listening and destroy all connections — no-op when an external `server` was provided |

## Internal files (root level)

| File | Purpose |
|------|---------|
| `contexts.ts` | Module-level `Context` map — thin key/value store used to share singletons (e.g. socket server) across the server codebase without prop-drilling |
| `internalModels.ts` | Shared server-side type aliases: `AnyHttpServer` (HTTP/HTTPS/HTTP2 union) and `Client` (typed Socket.IO socket) |
| `jwt.ts` | Server JWT utilities — `createTokenFromUser` (RS256 sign, generates key-pair if none provided), `extractUserFromToken` (verify + decode), `encodePrivateKey` |
