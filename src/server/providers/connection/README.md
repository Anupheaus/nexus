# server/providers/connection — Connection Tracking

Tracks active HTTP and socket connections, mapping each to its async context so that middleware and handlers can look up the correct ALS scope for any request.

## Files

| File | Purpose |
|------|---------|
| `Connection.ts` | Stores the async context slots (config, logger, client, auth state) for one connection |
| `ConnectionRegistry.ts` | Maintains the map of all active connections; assigns session IDs (`crypto.randomUUID()`), sets the session cookie, and retrieves connections by request or socket ID |

## Session cookie

`ConnectionRegistry` issues an `HttpOnly; Secure; SameSite=Strict` session cookie on the first HTTP request. This cookie ties subsequent socket and REST requests to the same session context.

## Internal use only

This module is wired in by `setupKoa` and `setupSocket`. You do not interact with it directly in application code.
