# Manual Socket Connect / Disconnect

**Date:** 2026-04-19
**Status:** Approved

## Summary

Add the ability for consumers to control when the socket connects and disconnects at will, rather than always auto-connecting on mount. `connect()` and `disconnect()` are async operations that return promises. An `autoConnect` prop on `<Nexus>` controls whether the socket connects on mount.

## Decisions

| Question | Decision |
|---|---|
| Control surface | `autoConnect` prop on `<Nexus>` + `connect`/`disconnect` on `useSocket()` |
| Disconnect semantics | Temporary/resumable — `connect()` can reconnect after `disconnect()` |
| `testDisconnect` / `testReconnect` | Removed entirely |
| Invalid-state calls | No-op + warning log (promise resolves immediately) |
| `autoConnect={false}` behaviour | Defers socket creation entirely — nothing created until `connect()` is called |
| Return type | Promises — `connect()` resolves on connect, rejects on failure; `disconnect()` always resolves |

## Architecture

### `Nexus` / `SocketProvider` props

Add `autoConnect?: boolean` (default `true`) to both. The prop is threaded straight through to `SocketProvider`.

### Socket creation gating

Currently `SocketProvider` creates the socket in a `useMemo` on every `uniqueConnectionId` change and auto-connects on initial mount (`uniqueConnectionId === ''`).

With this change:
- A new `manualConnectRef = useRef(false)` flag is introduced alongside the existing `reconnectRef`.
- When `autoConnect={false}` and `connect()` has not been called yet, the `useMemo` skips socket creation entirely — `socketRef.current` stays `undefined`.
- `connect()` sets `manualConnectRef.current = true` and calls `setUniqueConnectionId(Math.uniqueId())` to trigger the `useMemo`, which then creates and connects the socket.
- `disconnect()` calls the existing `disconnectSocket()` and clears `socketRef.current`. This leaves the provider alive so `connect()` can reconnect later.

### `connect()` promise

`connect()` returns a `Promise<void>` that:
- **Resolves** when the socket emits `connect`.
- **Rejects** when the socket emits `connect_error` (passes the error through).
- **Resolves immediately** (with a warning log) if the socket is already connected.

The promise is wired by attaching one-time `connect` / `connect_error` listeners to the new socket before calling `.connect()`.

### `disconnect()` promise

`disconnect()` returns a `Promise<void>` that:
- Always resolves once `disconnectSocket()` completes (synchronous).
- Resolves immediately (with a warning log) if already disconnected.

### `SocketContext` interface changes

```ts
// Added
connect(): Promise<void>;
disconnect(): Promise<void>;

// Removed
testDisconnect(): void;
testReconnect(): void;
```

### `useSocket()` hook changes

```ts
// Added to return value
connect(): Promise<void>;
disconnect(): Promise<void>;

// Removed from return value
testDisconnect(): void;
testReconnect(): void;
```

### `Nexus` prop changes

```tsx
interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  auth?: Record<string, string>;
  autoConnect?: boolean; // NEW — default true
  children?: ReactNode;
}
```

## Error handling

- `connect()` rejects with the Socket.IO `connect_error` Error object. Callers are responsible for catching and displaying errors.
- If `connect()` is called while already connected: log a warning, return a resolved promise.
- If `disconnect()` is called while already disconnected: log a warning, return a resolved promise.

## Affected files

| File | Change |
|---|---|
| `src/client/Nexus.tsx` | Add `autoConnect` prop, thread to `SocketProvider` |
| `src/client/providers/socket/SocketProvider.tsx` | Gate socket creation, implement `connect`/`disconnect`, remove `testDisconnect`/`testReconnect` |
| `src/client/providers/socket/SocketContext.ts` | Add `connect`/`disconnect`, remove `testDisconnect`/`testReconnect` |
| `src/client/providers/socket/useSocket.ts` | Expose `connect`/`disconnect`, remove `testDisconnect`/`testReconnect` |
| `tests/harness/client/ConnectionTest.tsx` | Replace `testDisconnect`/`testReconnect` calls with `disconnect()`/`connect()` |
| `src/client/hooks/useAuthentication.tests.ts` | Replace `testDisconnect`/`testReconnect` calls with `disconnect()`/`connect()` |

## Out of scope

- SSE transport
- Exposing `autoConnect` state reactively (consumers can read `isConnected` instead)
- Subscription/action re-hydration on reconnect (already handled by `onConnectionStateChanged` callbacks)
