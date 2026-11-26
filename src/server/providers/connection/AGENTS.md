# server/providers/connection — Connection Tracking

Tracks active HTTP and socket connections, mapping each to its async context so that middleware and handlers can look up the correct ALS scope for any request.

## Files

| File | Purpose |
|------|---------|
| `Connection.ts` | Stores the async context slots (config, logger, client, auth state) for one connection |
| `ConnectionRegistry.ts` | Maintains the map of all active connections; assigns session IDs (`crypto.randomUUID()`), sets the session cookie, and retrieves connections by request or socket ID |

## Session cookie

`ConnectionRegistry` issues an `HttpOnly; Secure; SameSite=Strict` session cookie on the first HTTP request. This cookie ties subsequent socket and REST requests to the same session context.

- **Appended, never replacing.** The `nexus-conn` cookie is added beside any `Set-Cookie` the response already has, and a REST handler's own cookies are appended after it (`registerRestActions`), so a sign-in on a new connection sends both `nexus-conn` and `nexus_session`.
- **One connection per request.** A request passes through more than one wrap (the HTTP server's, the REST action's); `fromRequest` remembers the connection each request resolved to, so a request without a cookie gets one connection and one cookie, not one at each wrap.
- **The user lives here.** The signed-in user, account and token are kept on the connection, shared by the browser's sockets and requests and outliving its sockets: sign-out clears them, and a socket with no session of its own clears any it finds (`socketAuthMiddleware.ts`).

## Internal use only

This module is wired in by `setupKoa` and `setupSocket`. You do not interact with it directly in application code.
