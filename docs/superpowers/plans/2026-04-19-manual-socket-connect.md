# Manual Socket Connect / Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `autoConnect` prop to `<Nexus>` and `connect()` / `disconnect()` methods to `useSocket()` so consumers can control the socket connection lifecycle at will.

**Architecture:** `SocketContext` gains `connect(): Promise<void>` and `disconnect(): Promise<void>` (removing `testDisconnect`/`testReconnect`). `SocketProvider` gates socket creation behind a `connectRef` flag and resolves/rejects the `connect()` promise via one-time listeners wired inside the existing `useMemo`. `useSocket` forwards the new methods to consumers.

**Tech Stack:** React, Socket.IO client, TypeScript, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/client/providers/socket/SocketContext.ts` | Add `connect`/`disconnect` to interface; remove `testDisconnect`/`testReconnect`; update stubs |
| `src/client/providers/socket/SocketProvider.tsx` | Add `autoConnect` prop; gate socket creation; implement `connect`/`disconnect`; wire promise; remove test helpers |
| `src/client/Nexus.tsx` | Add `autoConnect` prop; thread to `SocketProvider` |
| `src/client/providers/socket/useSocket.ts` | Expose `connect`/`disconnect`; remove `testDisconnect`/`testReconnect` |
| `src/client/hooks/useAuthentication.tests.ts` | Update context mock: swap test helpers for `connect`/`disconnect` |
| `tests/harness/client/ConnectionTest.tsx` | Replace `testDisconnect`/`testReconnect` with `connect`/`disconnect` |

---

## Task 1: Update `SocketContext` interface

**Files:**
- Modify: `src/client/providers/socket/SocketContext.ts`

- [ ] **Step 1: Replace the interface and stubs**

Replace the entire file with:

```ts
import { createContext } from 'react';
import type { Socket } from 'socket.io-client';

function missingSocketProvider(usage: string) {
  return (): never => {
    throw new Error(`SocketProvider is required for ${usage}.`);
  };
}

function missingSocketProviderWithArgs(usage: string) {
  return (..._args: unknown[]): never => {
    throw new Error(`SocketProvider is required for ${usage}.`);
  };
}

export interface SocketContextProps {
  name: string;
  getSocket(): Socket | undefined;
  /** Returns socketRef.current regardless of connected state — for diagnostics only. */
  getRawSocket(): Socket | undefined;
  onConnectionStateChanged(callback: (isConnected: boolean, socket: Socket | undefined) => void, debugId?: string): void;
  reconnect(): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on<DataType = unknown, ReturnType = unknown>(hookId: string, event: string, callback: (data: DataType) => ReturnType): void;
  /** At most one handler per event; ack is the handler return value (not an array). For server-initiated actions only. */
  onExclusive<DataType = unknown, ReturnType = unknown>(hookId: string, event: string, callback: (data: DataType) => ReturnType): void;
  off(hookId: string, event: string): void;
}

export const SocketContext = createContext<SocketContextProps>({
  name: '',
  getSocket: missingSocketProvider('socket access — wrap the app with Nexus or SocketProvider'),
  getRawSocket: missingSocketProvider('raw socket access'),
  onConnectionStateChanged: missingSocketProviderWithArgs('connection state listeners'),
  reconnect: missingSocketProvider('reconnect'),
  connect: missingSocketProvider('connect'),
  disconnect: missingSocketProvider('disconnect'),
  on: missingSocketProviderWithArgs('event listeners (e.g. useEvent)'),
  onExclusive: missingSocketProviderWithArgs('useServerActionHandler'),
  off: missingSocketProviderWithArgs('removing event listeners'),
});
```

- [ ] **Step 2: Run tests — expect TypeScript errors in consuming files**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: failures referencing `testDisconnect` / `testReconnect` in `SocketProvider.tsx`, `useSocket.ts`, `useAuthentication.tests.ts`. That's expected — we'll fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/socket/SocketContext.ts
git -C C:/code/personal/socket-api commit -m "feat(socket): add connect/disconnect to SocketContext interface, remove testDisconnect/testReconnect"
```

---

## Task 2: Update `SocketProvider` — implement `connect` / `disconnect`

**Files:**
- Modify: `src/client/providers/socket/SocketProvider.tsx`

- [ ] **Step 1: Add `autoConnect` to the Props interface and destructure it**

Find the `Props` interface (currently lines 23–29) and replace it:

```ts
interface Props {
  host?: string;
  name: string;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  /** When false, the socket is not created until connect() is called. Default: true. */
  autoConnect?: boolean;
  children?: ReactNode;
}
```

Then find the component signature:

```ts
export const SocketProvider = createComponent('SocketProvider', ({
  host,
  name,
  auth,
  children,
}: Props) => {
```

Replace with:

```ts
export const SocketProvider = createComponent('SocketProvider', ({
  host,
  name,
  auth,
  autoConnect,
  children,
}: Props) => {
```

- [ ] **Step 2: Add `connectRef` and `connectPromiseRef` inside the component**

Directly after the existing `const reconnectRef = useRef(false);` line, add:

```ts
/** True once connect() has been called (or autoConnect is true). Gates socket creation in useMemo. */
const connectRef = useRef(autoConnect !== false);
/** Pending promise callbacks from an in-flight connect() call. */
const connectPromiseRef = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);
```

- [ ] **Step 3: Gate socket creation at the top of `useMemo`**

At the very top of the `useMemo` callback (before `const prevSocket = socketRef.current`), add:

```ts
if (!connectRef.current && !reconnectRef.current) return;
```

- [ ] **Step 4: Resolve/reject the connect promise inside the socket event handlers**

Inside the `sck.on('connect', () => { ... })` handler, immediately after the `isConnected = true;` line add:

```ts
connectPromiseRef.current?.resolve();
connectPromiseRef.current = null;
```

Inside the `sck.on('connect_error', error => { ... })` handler, after the existing logging, add:

```ts
connectPromiseRef.current?.reject(error);
connectPromiseRef.current = null;
```

- [ ] **Step 5: Simplify the connect call — always connect when the useMemo body runs**

Replace the current block:

```ts
// Connect if this is the initial mount OR an explicit reconnect request.
const shouldConnect = uniqueConnectionId === '' || reconnectRef.current;
reconnectRef.current = false;
if (shouldConnect) {
  diagLog('socket.connect() called', { uniqueConnectionId, shouldConnect });
  sck.connect();
}
```

With:

```ts
reconnectRef.current = false;
diagLog('socket.connect() called', { uniqueConnectionId });
sck.connect();
```

(The guard added in Step 3 means we only reach here when a connection is desired.)

- [ ] **Step 6: Replace `testDisconnect`/`testReconnect` with `connect`/`disconnect` in the context value**

Inside the `useMemo<SocketContextProps>` context value (currently lines 138–255), find and remove the `testDisconnect` and `testReconnect` entries, then add `connect` and `disconnect` in their place:

```ts
connect() {
  const socket = socketRef.current;
  if (socket?.connected) {
    logger.warn('connect() called but socket is already connected');
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    connectPromiseRef.current = { resolve, reject };
    connectRef.current = true;
    setUniqueConnectionId(Math.uniqueId());
  });
},
disconnect() {
  const socket = socketRef.current;
  if (socket == null || !socket.connected) {
    logger.warn('disconnect() called but socket is not connected');
    return Promise.resolve();
  }
  disconnectSocket();
  return Promise.resolve();
},
```

- [ ] **Step 7: Run tests**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: still failures in `useSocket.ts` and `useAuthentication.tests.ts` (next tasks). `SocketProvider` itself should now compile cleanly.

- [ ] **Step 8: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/socket/SocketProvider.tsx
git -C C:/code/personal/socket-api commit -m "feat(socket): implement connect/disconnect in SocketProvider with autoConnect prop"
```

---

## Task 3: Thread `autoConnect` through `Nexus`

**Files:**
- Modify: `src/client/Nexus.tsx`

- [ ] **Step 1: Add `autoConnect` to Props and thread to SocketProvider**

Replace the entire file with:

```tsx
import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketProvider, SubscriptionProvider } from './providers';
import { AuthenticationProvider } from './providers/user/AuthenticationProvider';
import type { Logger } from '@anupheaus/common';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  /** When false, the socket is not created until connect() is called. Default: true. */
  autoConnect?: boolean;
  children?: ReactNode;
}

export const Nexus = createComponent('Nexus', ({
  host,
  name,
  logger,
  auth,
  autoConnect,
  children,
}: Props) => {
  return (
    <LoggerProvider logger={logger} loggerName={'socket-api'}>
      <SocketProvider host={host} name={name} auth={auth} autoConnect={autoConnect}>
        <SubscriptionProvider>
          <AuthenticationProvider>
            {children}
          </AuthenticationProvider>
        </SubscriptionProvider>
      </SocketProvider>
    </LoggerProvider>
  );
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: same failures as before (only `useSocket.ts` and the test mock remain). `Nexus.tsx` should compile cleanly.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/Nexus.tsx
git -C C:/code/personal/socket-api commit -m "feat(socket): thread autoConnect prop through Nexus to SocketProvider"
```

---

## Task 4: Update `useSocket` — expose `connect`/`disconnect`

**Files:**
- Modify: `src/client/providers/socket/useSocket.ts`

- [ ] **Step 1: Replace the file**

```ts
import { useContext, useRef, useState } from 'react';
import { SocketContext } from './SocketContext';
import { useBound, useId, useLogger } from '@anupheaus/react-ui';
import { InternalError } from '@anupheaus/common';
import type { Socket } from 'socket.io-client';

export function useSocket() {
  const logger = useLogger();
  const { getSocket, getRawSocket, onConnectionStateChanged, connect: contextConnect, disconnect: contextDisconnect, on: contextOn, onExclusive: contextOnExclusive, off: contextOff } = useContext(SocketContext);
  const hookId = useId();
  const connectedCallback = useRef<(socket: Socket) => void>();
  const disconnectedCallback = useRef<() => void>();

  const getIsConnected = useBound(() => {
    const sck = getSocket();
    return sck != null && sck.connected === true;
  });

  const [isConnected, setIsConnected] = useState(() => getIsConnected());
  const updateWhenChangedRef = useRef(false);
  const [clientId, setClientId] = useState(() => getIsConnected() ? getSocket()?.id : undefined);

  onConnectionStateChanged((newIsConnected, socket) => {
    if (connectedCallback.current != null && socket != null && socket.connected === true) connectedCallback.current(socket);
    if (disconnectedCallback.current != null && socket != null && socket.connected === false) disconnectedCallback.current();
    if (!updateWhenChangedRef.current) return;
    setClientId(socket?.id);
    setIsConnected(newIsConnected);
  });

  const emit = useBound(async <ReturnType = void, DataType = unknown>(event: string, data: DataType): Promise<ReturnType> => {
    const socket = getSocket();
    if (socket == null) throw new InternalError('Socket is not connected');
    try {
      return socket.emitWithAck(event, data);
    } catch (error) {
      logger.error('Failed to emit an event using socket.io', { error });
      throw error;
    }
  });

  const on = useBound(<DataType = unknown, ReturnType = unknown>(event: string, callback: (data: DataType) => ReturnType) => contextOn(hookId, event, callback));

  const onExclusive = useBound(<DataType = unknown, ReturnType = unknown>(event: string, callback: (data: DataType) => ReturnType) => contextOnExclusive(hookId, event, callback));

  const off = useBound((event: string) => contextOff(hookId, event));

  const onConnected = (callback: (socket: Socket) => void) => {
    const shouldCall = connectedCallback.current == null;
    connectedCallback.current = callback;
    if (!shouldCall) return;
    const socket = getSocket();
    if (socket == null || socket.connected === false) return;
    callback(socket);
  };

  const onDisconnected = (callback: () => void) => {
    const shouldCall = disconnectedCallback.current == null;
    disconnectedCallback.current = callback;
    if (!shouldCall) return;
    const socket = getSocket();
    if (socket != null && socket.connected === true) return;
    callback();
  };

  return {
    get isConnected() { updateWhenChangedRef.current = true; return isConnected; },
    get clientId() { updateWhenChangedRef.current = true; return clientId; },
    getIsConnected,
    onConnected,
    onDisconnected,
    onConnectionStateChanged,
    getSocket,
    getRawSocket,
    emit,
    on,
    onExclusive,
    off,
    connect: contextConnect,
    disconnect: contextDisconnect,
  };
}
```

- [ ] **Step 2: Run tests**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: only `useAuthentication.tests.ts` still fails (mock still references removed methods). All other files should compile and pass.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/socket/useSocket.ts
git -C C:/code/personal/socket-api commit -m "feat(socket): expose connect/disconnect from useSocket, remove testDisconnect/testReconnect"
```

---

## Task 5: Fix `useAuthentication` test mock

**Files:**
- Modify: `src/client/hooks/useAuthentication.tests.ts`

- [ ] **Step 1: Update the hoisted mocks and context mock**

Replace the `vi.hoisted` block and the `vi.mock` block with:

```ts
const { mockOn, mockOff, mockReconnect, mockConnect, mockDisconnect } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
  mockConnect: vi.fn(() => Promise.resolve()),
  mockDisconnect: vi.fn(() => Promise.resolve()),
}));

vi.mock('../providers/socket/SocketContext', () => ({
  SocketContext: {
    _currentValue: {
      name: 'test',
      reconnect: mockReconnect,
      connect: mockConnect,
      disconnect: mockDisconnect,
      on: mockOn,
      off: mockOff,
      getSocket: vi.fn(),
      getRawSocket: vi.fn(),
      onConnectionStateChanged: vi.fn(),
      onExclusive: vi.fn(),
    },
  },
}));
```

- [ ] **Step 2: Run tests — expect all pass**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: all tests pass, zero failures.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/hooks/useAuthentication.tests.ts
git -C C:/code/personal/socket-api commit -m "test(socket): update useAuthentication mock to use connect/disconnect"
```

---

## Task 6: Update harness `ConnectionTest` component

**Files:**
- Modify: `tests/harness/client/ConnectionTest.tsx`

- [ ] **Step 1: Replace `testDisconnect`/`testReconnect` with `connect`/`disconnect`**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { Button, createComponent, createStyles, Flex } from '@anupheaus/react-ui';
import { useNexus } from '../../../src/client';

const useStyles = createStyles({
  connectionStatus: {
    borderRadius: 8,
    '&.socket-connected': {
      backgroundColor: 'green',
    },
    '&.socket-disconnected': {
      backgroundColor: 'red',
    },
  },
});

export const ConnectionTest = createComponent('ConnectionTest', () => {
  const { css, join } = useStyles();
  const { onConnectionStateChanged, connect, disconnect } = useNexus();
  const [isConnected, setIsConnected] = useState(false);
  onConnectionStateChanged((newIsConnected: boolean) => setIsConnected(newIsConnected));

  return (
    <Flex gap={'fields'} disableGrow>
      <Flex className={join(css.connectionStatus, isConnected ? 'socket-connected' : 'socket-disconnected')} />
      <Button onClick={disconnect}>Disconnect</Button>
      <Button onClick={connect}>Reconnect</Button>
    </Flex>
  );
});
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm -C C:/code/personal/socket-api test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add tests/harness/client/ConnectionTest.tsx
git -C C:/code/personal/socket-api commit -m "feat(harness): update ConnectionTest to use connect/disconnect"
```

---

## Done

All six tasks produce a working feature. Verify the final state with `pnpm -C C:/code/personal/socket-api test` — all tests should pass. The public API is now:

```tsx
// Defer initial connection
<Nexus name="api" autoConnect={false}>...</Nexus>

// Connect/disconnect at will
const { connect, disconnect } = useSocket(); // or useNexus()
await connect();    // resolves when connected, rejects on error
await disconnect(); // always resolves
```
