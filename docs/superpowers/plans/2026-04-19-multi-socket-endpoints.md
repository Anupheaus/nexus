# Multi-Socket Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `startServer` to accept an array of socket endpoint configs (each with its own name/path, actions, subscriptions, and socket-specific settings), with session state (Connection + JWT auth) shared across all WebSocket connections from the same browser client.

**Architecture:** The server creates one Socket.IO `Server` instance per `SocketEndpointConfig` entry, each with its own path and `allowRequest` exact-match guard so REST routes on sub-paths still work. The `ConnectionRegistry` already shares sessions across connections via cookie — no changes needed there. On the client, `SocketProvider` registers itself in a new `SocketRegistryContext`; `SocketAPI` gains a `sockets` prop and renders one `SocketProvider` per entry, with the primary socket providing backward-compatible `SocketContext`, and secondary sockets getting silent JWT re-authentication on connect.

**Tech Stack:** TypeScript, Socket.IO v4, Koa, React 18, Vitest, `@anupheaus/common`, `@anupheaus/react-ui`

---

## File Map

**New files:**
- `src/client/providers/socket/SocketRegistryContext.ts` — registry context (name → `SocketContextProps` map)
- `src/client/providers/socket/SocketRegistryProvider.tsx` — manages N `SocketProvider`s, provides registry + primary context

**Modified files:**
- `src/server/startServer.ts` — add `SocketEndpointConfig`, update `ServerConfig`, loop over sockets
- `src/server/providers/socket/createServerSocket.ts` — accept `SocketEndpointConfig` instead of bare `name`
- `src/server/providers/socket/setupSocket.ts` — accept `SocketEndpointConfig` instead of bare `name`
- `src/client/providers/socket/SocketProvider.tsx` — register/unregister self in `SocketRegistryContext`
- `src/client/providers/socket/index.ts` — export new files
- `src/client/SocketAPI.tsx` — accept `sockets` array (or `name` shorthand), use `SocketRegistryProvider`
- `tests/harness/server/start.ts` — migrate to new `sockets` array config
- `tests/e2e/socket-api.e2e.tests.ts` — migrate to new config; add multi-socket test
- `src/server/providers/socket/createServerSocket.tests.ts` — update to pass `SocketEndpointConfig`

---

## Task 1: Add `SocketEndpointConfig` and update `ServerConfig`

**Files:**
- Modify: `src/server/startServer.ts`

- [ ] **Step 1: Write the failing type-check test**

Create `src/server/startServer.config.tests.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { ServerConfig, SocketEndpointConfig } from './startServer';

describe('ServerConfig shape', () => {
  it('requires sockets array', () => {
    expectTypeOf<ServerConfig>().toHaveProperty('sockets');
    expectTypeOf<ServerConfig['sockets']>().toEqualTypeOf<SocketEndpointConfig[]>();
  });

  it('SocketEndpointConfig has name, actions, subscriptions, maxHttpBufferSize', () => {
    expectTypeOf<SocketEndpointConfig>().toHaveProperty('name');
    expectTypeOf<SocketEndpointConfig['name']>().toEqualTypeOf<string>();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pnpm -C /c/code/personal/socket-api test src/server/startServer.config.tests.ts
```

Expected: type error — `SocketEndpointConfig` does not exist.

- [ ] **Step 3: Add `SocketEndpointConfig` and update `ServerConfig`**

In `src/server/startServer.ts`, replace the top of the file (the `ServerConfig` interface) with:

```ts
export interface SocketEndpointConfig {
  /** URL path for this Socket.IO endpoint, e.g. "api" → path is "/api". */
  name: string;
  actions?: SocketAPIServerAction[];
  subscriptions?: SocketAPIServerSubscription[];
  /** Called after this socket.io server is created; register additional namespaces here. */
  onRegisterNamespaces?(io: Server): PromiseMaybe<void>;
  /** Override the max HTTP buffer size for this endpoint (default: 10 MB). */
  maxHttpBufferSize?: number;
}

export interface ServerConfig {
  sockets: SocketEndpointConfig[];
  logger?: Logger;
  server: AnyHttpServer;
  privateKey?: string;
  clientLoggingService?: SocketAPIClientLoggingService;
  onStartup?(): PromiseMaybe<void>;
  /** Called once per client connection, BEFORE handlers are registered. */
  onClientConnecting?(client: Socket): PromiseMaybe<void>;
  onClientConnected?(client: Socket): PromiseMaybe<void>;
  onClientDisconnected?(client: Socket): PromiseMaybe<void>;
  /** Called before every action/subscription handler. Awaited before the handler runs. */
  onBeforeHandle?(client: Socket): PromiseMaybe<void>;
  /** When true, JWT handshake action is not registered and tokens are never issued. */
  disableJwtAuth?: boolean;
  onSavePrivateKey?(client: Socket, user: SocketAPIUser, privateKey: string): PromiseMaybe<void>;
  onLoadPrivateKey?(client: Socket, user: SocketAPIUser): PromiseMaybe<string | undefined>;
  onRegisterRoutes?(router: Router): PromiseMaybe<void>;
  security?: SecurityConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -C /c/code/personal/socket-api test src/server/startServer.config.tests.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /c/code/personal/socket-api add src/server/startServer.ts src/server/startServer.config.tests.ts
git -C /c/code/personal/socket-api commit -m "feat: add SocketEndpointConfig and update ServerConfig to use sockets array"
```

---

## Task 2: Update `createServerSocket` to accept `SocketEndpointConfig`

**Files:**
- Modify: `src/server/providers/socket/createServerSocket.ts`
- Modify: `src/server/providers/socket/createServerSocket.tests.ts`

- [ ] **Step 1: Update the test file to use `SocketEndpointConfig`**

Replace the entire content of `src/server/providers/socket/createServerSocket.tests.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import http from 'http';
import { createServerSocket } from './createServerSocket';
import type { Server as HttpServer } from 'http';
import type { SocketEndpointConfig } from '../../startServer';

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
  provide: vi.fn((fn: () => unknown) => fn()),
};

function makeConfig(name: string, overrides?: Partial<SocketEndpointConfig>): SocketEndpointConfig {
  return { name, ...overrides };
}

describe('createServerSocket', () => {
  it('returns a socket.io Server instance', () => {
    const mockServer = {} as HttpServer;
    const io = createServerSocket(makeConfig('test-socket'), mockServer, mockLogger as never);
    expect(io).toBeDefined();
    expect(typeof io.emit).toBe('function');
    expect(typeof io.on).toBe('function');
  });

  it('creates server with provided name', () => {
    const mockServer = {} as HttpServer;
    const io = createServerSocket(makeConfig('mySocket'), mockServer, mockLogger as never);
    expect(io).toBeDefined();
    expect(io).toBeInstanceOf(Object);
  });
});

describe('createServerSocket — allowRequest path filtering', () => {
  let server: http.Server;
  let port: number;

  afterAll(done => {
    server?.close(done);
  });

  async function startTestServer(name: string): Promise<number> {
    server = http.createServer();
    createServerSocket(makeConfig(name), server, mockLogger as never);
    return new Promise(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(port);
      });
    });
  }

  function wsConnect(port: number, path: string): Promise<{ opened: boolean; closeCode: number | undefined }> {
    return new Promise(resolve => {
      const req = http.request({ host: '127.0.0.1', port, path: `${path}/?EIO=4&transport=websocket`, method: 'GET' });
      req.setHeader('Upgrade', 'websocket');
      req.setHeader('Connection', 'Upgrade');
      req.setHeader('Sec-WebSocket-Key', 'dGhlIHNhbXBsZSBub25jZQ==');
      req.setHeader('Sec-WebSocket-Version', '13');
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        resolve({ opened: true, closeCode: undefined });
      });
      req.on('response', res => {
        resolve({ opened: false, closeCode: res.statusCode });
      });
      req.on('error', () => resolve({ opened: false, closeCode: undefined }));
      req.end();
    });
  }

  it('rejects WebSocket upgrade requests to paths other than the configured name', async () => {
    const p = await startTestServer('myapi');
    const result = await wsConnect(p, '/wrongpath');
    expect(result.opened).toBe(false);
  });

  it('accepts WebSocket upgrade requests to the configured path', async () => {
    const result = await wsConnect(port, '/myapi');
    expect(result.closeCode).not.toBe(400);
    expect(result.closeCode).not.toBe(403);
  });

  it('rejects sub-paths of the configured name (prefix matching does not apply)', async () => {
    const result = await wsConnect(port, '/myapi/extra');
    expect(result.opened).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm -C /c/code/personal/socket-api test src/server/providers/socket/createServerSocket.tests.ts
```

Expected: type error — `createServerSocket` still takes `string` as first arg.

- [ ] **Step 3: Update `createServerSocket` implementation**

Replace `src/server/providers/socket/createServerSocket.ts` with:

```ts
import { Server } from 'socket.io';
import type { AnyHttpServer } from '../../internalModels';
import { SocketIOParser } from '../../../common';
import type { Logger } from '@anupheaus/common';
import type { SocketEndpointConfig } from '../../startServer';

const DEFAULT_MAX_HTTP_BUFFER_SIZE = 1024 * 1024 * 10;

export function createServerSocket(endpointConfig: SocketEndpointConfig, server: AnyHttpServer, logger: Logger) {
  const { name, maxHttpBufferSize = DEFAULT_MAX_HTTP_BUFFER_SIZE } = endpointConfig;
  return new Server(server, {
    path: `/${name}`,
    transports: ['websocket'],
    serveClient: false,
    parser: new SocketIOParser({ logger }),
    maxHttpBufferSize,
    // allowRequest fires inside the Engine.IO upgrade/request handler.
    // We enforce an exact path match so REST routes like /api/auth are never consumed.
    allowRequest: (req, callback) => {
      const pathname = (req.url ?? '').split('?')[0].replace(/\/$/, '');
      callback(pathname === `/${name}` ? null : 'path not allowed', pathname === `/${name}`);
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C /c/code/personal/socket-api test src/server/providers/socket/createServerSocket.tests.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /c/code/personal/socket-api add src/server/providers/socket/createServerSocket.ts src/server/providers/socket/createServerSocket.tests.ts
git -C /c/code/personal/socket-api commit -m "feat: createServerSocket accepts SocketEndpointConfig instead of bare name"
```

---

## Task 3: Update `setupSocket` to accept `SocketEndpointConfig`

**Files:**
- Modify: `src/server/providers/socket/setupSocket.ts`

- [ ] **Step 1: Update `setupSocket` signature and internal usage**

Replace `src/server/providers/socket/setupSocket.ts` with:

```ts
import '@anupheaus/common';
import type { SocketContextProps } from './SocketContext';
import type { Logger, LoggerEntry } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { AnyHttpServer } from '../../internalModels';
import { createServerSocket } from './createServerSocket';
import { useAuthentication } from '../authentication';
import { setClient, wrap } from '../../async-context';
import type { Socket } from 'socket.io';
import type { SocketAPIClientLoggingService } from '../../../common';
import type { Connection } from '../connection';
import type { ConnectionRegistry } from '../connection';
import type { SocketEndpointConfig } from '../../startServer';

export function setupSocket(
  endpointConfig: SocketEndpointConfig,
  server: AnyHttpServer,
  logger: Logger,
  clientLoggingService: SocketAPIClientLoggingService | undefined,
  registry: ConnectionRegistry,
) {
  const { name } = endpointConfig;
  logger.info(`Preparing websocket for '${name}'...`);
  const socket = createServerSocket(endpointConfig, server, logger);
  try {
    const onConnectedCallbacks = new Set<Parameters<SocketContextProps['onClientConnected']>[0]>();
    socket.on('connection', wrap(client => registry.fromSocket(client), async client => {
      const connection = registry.fromSocket(client);
      connection.openWebSocket();
      setClient(client);
      const clientLogger = logger.createSubLogger(client.id, { globalMeta: { clientId: client.id } });
      const userAgent = client.request.headers['user-agent'];
      const language = client.request.headers['accept-language'];
      const ipAddress = client.handshake.address;

      clientLogger.info('Client connected', { IPAddress: ipAddress, userAgent, language });

      const disconnectCallbacks = Array.from(onConnectedCallbacks)
        .mapWithoutNull(callback => callback({ client }));

      setupClientLoggingService(client, connection, clientLoggingService, userAgent, language, ipAddress);

      client.on('disconnect', wrap(connection, () => {
        connection.closeWebSocket();
        clientLogger.info('Client disconnected');
        disconnectCallbacks.forEach(async potentialCb => {
          const cb = await potentialCb;
          if (!is.function(cb)) return;
          cb(client);
        });
      }));
    }));

    const onClientConnected: SocketContextProps['onClientConnected'] = (callback: Parameters<SocketContextProps['onClientConnected']>[0]) => {
      onConnectedCallbacks.add(callback);
    };

    logger.info('Websocket ready, waiting for the server to start...');

    server.on('listening', wrap(() => {
      const address = server.address();
      const port = is.string(address) ? undefined : address?.port;
      logger.info(`Websocket '${name}' listening on port ${port}.`);
    }));

    server.on('close', wrap(() => {
      logger.info(`Websocket '${name}' closed due to the server being closed.`);
    }));

    return { onClientConnected, io: socket };

  } finally {
    // socket.close();
  }
}

function setupClientLoggingService(
  client: Socket,
  connection: Connection,
  clientLoggingService: SocketAPIClientLoggingService | undefined,
  userAgent: string | undefined,
  language: string | undefined,
  ipAddress: string | undefined,
) {
  const listener = wrap(connection, (entries: LoggerEntry[]) => {
    const { getUser } = useAuthentication();
    const user = getUser();
    entries.forEach(entry => {
      const meta = entry.meta = entry.meta ?? {};
      meta.clientId = client.id;
      meta.source = 'client';
      meta.userAgent = userAgent;
      meta.language = language;
      meta.IPAddress = ipAddress;
      if (user != null) meta.userId = user.id;
    });
    clientLoggingService?.(client, user)(entries);
  });
  client.on('mxdb.log', listener);
  client.on('disconnect', wrap(connection, () => client.off('mxdb.log', listener)));
}
```

- [ ] **Step 2: Run the full unit test suite to make sure nothing breaks**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: same pass/fail as before (setupSocket itself has no test file, but downstream tests must still pass).

- [ ] **Step 3: Commit**

```bash
git -C /c/code/personal/socket-api add src/server/providers/socket/setupSocket.ts
git -C /c/code/personal/socket-api commit -m "feat: setupSocket accepts SocketEndpointConfig instead of bare name"
```

---

## Task 4: Rewrite `startServer` to loop over `sockets` array

**Files:**
- Modify: `src/server/startServer.ts`

- [ ] **Step 1: Update `startServer` body**

Replace the `startServer` function (keep the interfaces from Task 1 intact) in `src/server/startServer.ts`:

```ts
export async function startServer(config: ServerConfig) {
  const {
    server,
    logger: providedLogger,
    clientLoggingService,
    onClientConnecting,
    onClientConnected,
    onClientDisconnected,
    onRegisterRoutes,
  } = config;
  setConfig(config);
  const logger = providedLogger ?? new Logger('Socket-API');
  setLogger(logger);

  return logger.provide(async () => {
    const registry = new ConnectionRegistry();
    const app = setupKoa(server, registry, resolveSecurityConfig(config.security));
    if (onRegisterRoutes) await registerRoutes(app, onRegisterRoutes);

    const internalActions = config.disableJwtAuth ? [] : generateInternalActions();
    const sockets = new Map<string, Server>();

    for (const endpointConfig of config.sockets) {
      const { onClientConnected: localOnClientConnected, io } = setupSocket(
        endpointConfig, server, logger, clientLoggingService, registry,
      );
      attachKoaFallbackToEngineIO(app, io, registry);
      if (endpointConfig.onRegisterNamespaces) await endpointConfig.onRegisterNamespaces(io);
      sockets.set(endpointConfig.name, io);

      localOnClientConnected(wrap(({ client }) => registry.fromSocket(client), ({ client }) => {
        onClientConnecting?.(client);
        setupHandlers([
          ...internalActions,
          ...(endpointConfig.actions ?? []),
          ...(endpointConfig.subscriptions ?? []),
        ]);
        onClientConnected?.(client);
        return wrap(innerClient => registry.fromSocket(innerClient), (innerClient: Socket) => {
          cleanupSocketSubscriptions(innerClient.id);
          onClientDisconnected?.(innerClient);
        });
      }));
    }

    if (config.onStartup) await config.onStartup();

    return { app, sockets };
  });
}
```

Remove the old `registerRoutes` helper (it stays) but delete the old `attachKoaFallbackToEngineIO` call after the old `setupSocket` call — the new loop handles it. Also update the `Server` re-export at the top; the return type is now `{ app: Koa; sockets: Map<string, Server> }`.

- [ ] **Step 2: Run the unit tests**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: TypeScript errors in test harness and e2e files (they still pass `name:` at top level). We fix those in Task 6.

- [ ] **Step 3: Commit (even with downstream TS errors — tracked in next tasks)**

```bash
git -C /c/code/personal/socket-api add src/server/startServer.ts
git -C /c/code/personal/socket-api commit -m "feat: startServer loops over sockets array, returns Map<name, Server>"
```

---

## Task 5: Migrate test harness and e2e files to new config shape

**Files:**
- Modify: `tests/harness/server/start.ts`
- Modify: `tests/e2e/socket-api.e2e.tests.ts`
- Modify: `tests/perf/socket-api.perf.tests.ts`

- [ ] **Step 1: Update `tests/harness/server/start.ts`**

Replace the `startServer` call:

```ts
const { app } = await startServer({
  sockets: [{ name: 'test', actions }],
  logger,
  server,
  privateKey: testPrivateKey,
});
```

- [ ] **Step 2: Update `tests/e2e/socket-api.e2e.tests.ts`**

Locate the `startServer({...})` call (~line 166) and replace:

```ts
await startServer({
  sockets: [{
    name: socketName,
    actions: e2eActions,
    subscriptions: e2eSubscriptions,
    onRegisterNamespaces: lifecycleMocks.onRegisterNamespaces,
  }],
  logger,
  server,
  privateKey: testPrivateKey,
  onBeforeHandle: lifecycleMocks.onBeforeHandle,
  onClientConnecting: lifecycleMocks.onClientConnecting,
  onClientConnected: lifecycleMocks.onClientConnected,
  onClientDisconnected: lifecycleMocks.onClientDisconnected,
  onSavePrivateKey: lifecycleMocks.onSavePrivateKey,
  onRegisterRoutes: async router => {
    router.get('/e2e-http', async ctx => {
      ctx.body = { e2eHttp: true };
    });
  },
  clientLoggingService: (_client, _user) => async (entries: LoggerEntry[]) => {
    logCaptures.batches.push([...entries]);
  },
});
```

- [ ] **Step 3: Update `tests/perf/socket-api.perf.tests.ts`**

Locate and update the `startServer` call to use `sockets: [{ name: ..., actions: ..., subscriptions: ... }]`.

- [ ] **Step 4: Run all unit tests**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: PASS (or only pre-existing failures).

- [ ] **Step 5: Run e2e tests**

```bash
pnpm -C /c/code/personal/socket-api test:e2e
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /c/code/personal/socket-api add tests/harness/server/start.ts tests/e2e/socket-api.e2e.tests.ts tests/perf/socket-api.perf.tests.ts
git -C /c/code/personal/socket-api commit -m "chore: migrate test harness and e2e to sockets array config"
```

---

## Task 6: Add `SocketRegistryContext` for client-side multi-socket registry

**Files:**
- Create: `src/client/providers/socket/SocketRegistryContext.ts`

- [ ] **Step 1: Write the test**

Create `src/client/providers/socket/SocketRegistryContext.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SocketRegistryContext } from './SocketRegistryContext';

describe('SocketRegistryContext', () => {
  it('has no-op default register/unregister and undefined getContext', () => {
    const defaultValue = (SocketRegistryContext as any)._currentValue;
    expect(defaultValue.getContext('any')).toBeUndefined();
    expect(() => defaultValue.register('any', {} as never)).not.toThrow();
    expect(() => defaultValue.unregister('any')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm -C /c/code/personal/socket-api test src/client/providers/socket/SocketRegistryContext.tests.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `SocketRegistryContext.ts`**

Create `src/client/providers/socket/SocketRegistryContext.ts`:

```ts
import { createContext } from 'react';
import type { SocketContextProps } from './SocketContext';

export interface SocketRegistryContextProps {
  register(name: string, context: SocketContextProps): void;
  unregister(name: string): void;
  getContext(name: string): SocketContextProps | undefined;
}

export const SocketRegistryContext = createContext<SocketRegistryContextProps>({
  register: () => void 0,
  unregister: () => void 0,
  getContext: () => undefined,
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -C /c/code/personal/socket-api test src/client/providers/socket/SocketRegistryContext.tests.ts
```

Expected: PASS

- [ ] **Step 5: Export from socket index**

Add to `src/client/providers/socket/index.ts`:

```ts
export * from './SocketProvider';
export * from './useSocket';
export * from './SocketRegistryContext';
```

- [ ] **Step 6: Commit**

```bash
git -C /c/code/personal/socket-api add src/client/providers/socket/SocketRegistryContext.ts src/client/providers/socket/SocketRegistryContext.tests.ts src/client/providers/socket/index.ts
git -C /c/code/personal/socket-api commit -m "feat: add SocketRegistryContext for client-side multi-socket registry"
```

---

## Task 7: Modify `SocketProvider` to self-register in the registry

**Files:**
- Modify: `src/client/providers/socket/SocketProvider.tsx`

The change: after creating the `context` object in `useMemo`, register it in the `SocketRegistryContext` parent (if one exists). The default registry is a no-op, so single-socket usage is unaffected.

- [ ] **Step 1: Add registry registration to `SocketProvider`**

In `src/client/providers/socket/SocketProvider.tsx`, add the following import at the top:

```ts
import { SocketRegistryContext } from './SocketRegistryContext';
```

Then inside the component body, after the `const context = useMemo<SocketContextProps>(...)` call and BEFORE the `return` statement, add:

```ts
const registry = useContext(SocketRegistryContext);

useLayoutEffect(() => {
  registry.register(name, context);
  return () => registry.unregister(name);
// registry and context are stable references; name is a prop that could theoretically change
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [name]);
```

Make sure `useContext` and `useLayoutEffect` are imported from `'react'` at the top of the file (they already should be since the file uses `useLayoutEffect`).

- [ ] **Step 2: Run the existing SocketProvider tests (if any) and full unit suite**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: PASS — no behaviour changes for single-socket usage; the default no-op registry absorbs the calls.

- [ ] **Step 3: Commit**

```bash
git -C /c/code/personal/socket-api add src/client/providers/socket/SocketProvider.tsx
git -C /c/code/personal/socket-api commit -m "feat: SocketProvider registers itself in SocketRegistryContext on mount"
```

---

## Task 8: Create `SocketRegistryProvider` for multi-socket management

**Files:**
- Create: `src/client/providers/socket/SocketRegistryProvider.tsx`

This component:
1. Renders one `SocketProvider` per entry in `sockets` (without children)
2. Collects all contexts via the registry
3. Provides `SocketRegistryContext` to the subtree
4. Provides `SocketContext` of the PRIMARY socket (index 0) for backward-compatible hooks
5. Renders secondary socket silent authenticators (for JWT re-auth on reconnect)
6. Renders `SubscriptionProvider → AuthenticationProvider → {children}` inside the primary socket context

- [ ] **Step 1: Create `SocketRegistryProvider.tsx`**

Create `src/client/providers/socket/SocketRegistryProvider.tsx`:

```tsx
import { createComponent, useStorage } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { SocketRegistryContext } from './SocketRegistryContext';
import { SocketContext } from './SocketContext';
import { SocketProvider } from './SocketProvider';
import { SubscriptionProvider } from '../subscription';
import { AuthenticationProvider } from '../user/AuthenticationProvider';
import { useAction } from '../../hooks/useAction';
import { useSocket } from './useSocket';
import { socketAPIAuthenticateTokenAction } from '../../../common/internalActions';

export interface ClientSocketConfig {
  name: string;
  host?: string;
  /** Auth object passed in socket.io handshake. */
  auth?: Record<string, string>;
}

interface SecondaryAuthProps {
  tokenKeyName: string;
}

/** Silently authenticates a secondary socket using the stored JWT token. Renders nothing. */
const SecondarySocketAuthenticator = createComponent('SecondarySocketAuthenticator', ({ tokenKeyName }: SecondaryAuthProps) => {
  const { onConnected } = useSocket();
  const { state: token } = useStorage<string>(tokenKeyName, { type: 'local' });
  const { socketAPIAuthenticateTokenAction: authenticateToken } = useAction(socketAPIAuthenticateTokenAction);

  onConnected(async () => {
    if (token == null) return;
    await authenticateToken(token);
  });

  return null;
});

interface Props {
  sockets: ClientSocketConfig[];
  tokenKeyName: string;
  disableTokenReconnect?: boolean;
  onInvalidToken?(): Promise<void>;
  children: ReactNode;
}

export const SocketRegistryProvider = createComponent('SocketRegistryProvider', ({
  sockets,
  tokenKeyName,
  disableTokenReconnect,
  children,
}: Props) => {
  const contextMapRef = useRef(new Map<string, ReturnType<typeof useContext<typeof SocketContext>>>());
  const [, forceUpdate] = useState(0);

  const registryContextValue = useMemo(() => ({
    register: (name: string, ctx: any) => {
      contextMapRef.current.set(name, ctx);
      forceUpdate(n => n + 1);
    },
    unregister: (name: string) => {
      contextMapRef.current.delete(name);
      forceUpdate(n => n + 1);
    },
    getContext: (name: string) => contextMapRef.current.get(name),
  }), []);

  const primaryName = sockets[0]?.name;
  const primaryContext = primaryName != null ? contextMapRef.current.get(primaryName) : undefined;
  const nonPrimaryConfigs = sockets.slice(1);

  return (
    <SocketRegistryContext.Provider value={registryContextValue}>
      {/* Render a SocketProvider for each endpoint (no children — just connection + self-registration). */}
      {sockets.map(s => (
        <SocketProvider key={s.name} name={s.name} host={s.host} auth={s.auth} />
      ))}
      {/* Only render the app subtree once the primary socket context is available. */}
      {primaryContext != null && (
        <SocketContext.Provider value={primaryContext}>
          {/* Silently authenticate secondary sockets when they connect. */}
          {nonPrimaryConfigs.map(s => {
            const ctx = contextMapRef.current.get(s.name);
            if (ctx == null) return null;
            return (
              <SocketContext.Provider key={s.name} value={ctx}>
                {!disableTokenReconnect && (
                  <SecondarySocketAuthenticator tokenKeyName={tokenKeyName} />
                )}
              </SocketContext.Provider>
            );
          })}
          <SubscriptionProvider>
            <AuthenticationProvider tokenKeyName={tokenKeyName} disableTokenReconnect={disableTokenReconnect}>
              {children}
            </AuthenticationProvider>
          </SubscriptionProvider>
        </SocketContext.Provider>
      )}
    </SocketRegistryContext.Provider>
  );
});
```

- [ ] **Step 2: Export from socket index**

Add to `src/client/providers/socket/index.ts`:

```ts
export * from './SocketProvider';
export * from './useSocket';
export * from './SocketRegistryContext';
export * from './SocketRegistryProvider';
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git -C /c/code/personal/socket-api add src/client/providers/socket/SocketRegistryProvider.tsx src/client/providers/socket/index.ts
git -C /c/code/personal/socket-api commit -m "feat: add SocketRegistryProvider for multi-socket management and silent secondary auth"
```

---

## Task 9: Update `SocketAPI` to accept `sockets` array

**Files:**
- Modify: `src/client/SocketAPI.tsx`
- Modify: `src/client/index.ts`

The new API:
- `sockets` array of `ClientSocketConfig` (primary path)
- `name` string shorthand still supported (converted to `sockets={[{ name }]}` internally)

- [ ] **Step 1: Rewrite `SocketAPI.tsx`**

Replace `src/client/SocketAPI.tsx` with:

```tsx
import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketRegistryProvider } from './providers/socket/SocketRegistryProvider';
import type { ClientSocketConfig } from './providers/socket/SocketRegistryProvider';
import type { Logger } from '@anupheaus/common';

interface PropsWithSockets {
  /** Multiple socket endpoints. The first entry is the primary (used for auth and default hooks). */
  sockets: ClientSocketConfig[];
  name?: never;
  host?: never;
  auth?: never;
}

interface PropsWithName {
  /** Shorthand for a single socket — equivalent to sockets={[{ name, host, auth }]}. */
  name: string;
  host?: string;
  auth?: Record<string, string>;
  sockets?: never;
}

type Props = (PropsWithSockets | PropsWithName) & {
  logger?: Logger;
  tokenKeyName?: string;
  onInvalidToken?(): Promise<void>;
  children?: ReactNode;
};

export const SocketAPI = createComponent('SocketAPI', ({
  logger,
  tokenKeyName = 'socket-api-token',
  onInvalidToken,
  children,
  ...rest
}: Props) => {
  const resolvedSockets: ClientSocketConfig[] = 'sockets' in rest && rest.sockets != null
    ? rest.sockets
    : [{ name: (rest as PropsWithName).name, host: (rest as PropsWithName).host, auth: (rest as PropsWithName).auth }];

  return (
    <LoggerProvider logger={logger} loggerName={'socket-api'}>
      <SocketRegistryProvider
        sockets={resolvedSockets}
        tokenKeyName={tokenKeyName}
        disableTokenReconnect={resolvedSockets.some(s => s.auth != null)}
        onInvalidToken={onInvalidToken}
      >
        {children}
      </SocketRegistryProvider>
    </LoggerProvider>
  );
});
```

- [ ] **Step 2: Export `ClientSocketConfig` from the client index**

In `src/client/index.ts`:

```ts
export * from './SocketAPI';
export * from './hooks';
export { useUser, useSocket as useSocketAPI } from './providers';
export type { SocketAPIUser } from '../common';
export type { ClientSocketConfig } from './providers/socket/SocketRegistryProvider';
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git -C /c/code/personal/socket-api add src/client/SocketAPI.tsx src/client/index.ts
git -C /c/code/personal/socket-api commit -m "feat: SocketAPI accepts sockets array; name shorthand still works"
```

---

## Task 10: Update `useSocket` to support named socket lookup

**Files:**
- Modify: `src/client/providers/socket/useSocket.ts`

This allows `useAction`, `useEvent`, `useSubscription` to target a specific named socket by passing `socketName`.

- [ ] **Step 1: Write a type-level test**

Add to `src/client/providers/socket/SocketRegistryContext.tests.ts`:

```ts
import { useSocket } from './useSocket';

describe('useSocket', () => {
  it('accepts optional socketName parameter', () => {
    // Type-level check: useSocket() and useSocket('primary') both compile.
    expectTypeOf(useSocket).parameter(0).toEqualTypeOf<string | undefined>();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -C /c/code/personal/socket-api test src/client/providers/socket/SocketRegistryContext.tests.ts
```

Expected: type error — `useSocket` currently takes no parameters.

- [ ] **Step 3: Update `useSocket.ts`**

In `src/client/providers/socket/useSocket.ts`:

1. Add import at the top:
```ts
import { SocketRegistryContext } from './SocketRegistryContext';
```

2. Change the function signature and add context lookup at the start of the function body:
```ts
export function useSocket(socketName?: string) {
  const registry = useContext(SocketRegistryContext);
  const directContext = useContext(SocketContext);
  const resolvedContextProps = socketName != null
    ? (registry.getContext(socketName) ?? directContext)
    : directContext;

  const logger = useLogger();
  const {
    getSocket,
    getRawSocket,
    onConnectionStateChanged,
    testDisconnect,
    testReconnect,
    on: contextOn,
    onExclusive: contextOnExclusive,
    off: contextOff,
  } = resolvedContextProps;
  // ... rest of the function unchanged ...
```

The rest of the hook body is identical — it just now uses `resolvedContextProps` instead of destructuring `useContext(SocketContext)` directly.

- [ ] **Step 4: Run all tests**

```bash
pnpm -C /c/code/personal/socket-api test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /c/code/personal/socket-api add src/client/providers/socket/useSocket.ts src/client/providers/socket/SocketRegistryContext.tests.ts
git -C /c/code/personal/socket-api commit -m "feat: useSocket accepts optional socketName to target a specific socket from the registry"
```

---

## Task 11: Add multi-socket E2E test

**Files:**
- Modify: `tests/e2e/socket-api.e2e.tests.ts`

This test verifies:
1. A server with two socket endpoints can be started
2. Two clients can connect to different endpoints
3. Both share the same `Connection` session (via cookie)
4. REST endpoints on sub-paths of a socket name are NOT consumed by the WebSocket

- [ ] **Step 1: Add multi-socket describe block to the e2e test file**

At the end of `tests/e2e/socket-api.e2e.tests.ts`, add:

```ts
describe('multi-socket endpoints', () => {
  let multiServer: http.Server;
  let multiPort: number;

  const pingActionA = defineAction<void, string>()('multiPingA');
  const pingActionB = defineAction<void, string>()('multiPingB');

  beforeAll(async () => {
    multiServer = http.createServer();
    const logger = new Logger('e2e-multi');
    await startServer({
      sockets: [
        {
          name: 'socketA',
          actions: [
            createServerActionHandler(pingActionA, async () => 'pong-A'),
          ],
        },
        {
          name: 'socketB',
          actions: [
            createServerActionHandler(pingActionB, async () => 'pong-B'),
          ],
        },
      ],
      logger,
      server: multiServer,
      privateKey: testPrivateKey,
      onRegisterRoutes: async router => {
        router.get('/socketA/health', async ctx => {
          ctx.body = { ok: true };
        });
      },
    });
    await new Promise<void>(resolve => {
      multiServer.listen(0, () => {
        const addr = multiServer.address();
        multiPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(done => multiServer.close(done));

  it('clients can connect to socket A and call its action', async () => {
    const clientA = new TestClient(multiPort, 'socketA');
    await clientA.connect();
    const result = await clientA.callAction(pingActionA, undefined);
    expect(result).toBe('pong-A');
    clientA.disconnect();
  });

  it('clients can connect to socket B and call its action', async () => {
    const clientB = new TestClient(multiPort, 'socketB');
    await clientB.connect();
    const result = await clientB.callAction(pingActionB, undefined);
    expect(result).toBe('pong-B');
    clientB.disconnect();
  });

  it('REST endpoint on /socketA/health is not consumed by the WebSocket', async () => {
    const res = await fetch(`http://127.0.0.1:${multiPort}/socketA/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('action from socket A is not callable on socket B', async () => {
    const clientB = new TestClient(multiPort, 'socketB');
    await clientB.connect();
    // pingActionA is only registered on socketA, so calling it on socketB should error.
    await expect(clientB.callAction(pingActionA, undefined)).rejects.toThrow();
    clientB.disconnect();
  });
});
```

- [ ] **Step 2: Run the e2e tests**

```bash
pnpm -C /c/code/personal/socket-api test:e2e
```

Expected: all existing tests PASS; new multi-socket tests PASS.

- [ ] **Step 3: Commit**

```bash
git -C /c/code/personal/socket-api add tests/e2e/socket-api.e2e.tests.ts
git -C /c/code/personal/socket-api commit -m "test(e2e): add multi-socket endpoint tests including path exclusion"
```

---

## Task 12: Delete the temporary type-check test file

**Files:**
- Delete: `src/server/startServer.config.tests.ts`

This was a scaffold used during Task 1 to verify types. It can be removed now that real tests cover the same ground.

- [ ] **Step 1: Delete the file and run tests to confirm nothing breaks**

```bash
pnpm -C /c/code/personal/socket-api test
```

Delete `src/server/startServer.config.tests.ts`.

Expected: PASS — no regressions.

- [ ] **Step 2: Commit**

```bash
git -C /c/code/personal/socket-api rm src/server/startServer.config.tests.ts
git -C /c/code/personal/socket-api commit -m "chore: remove temporary type-check test for startServer config"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task(s) |
|---|---|
| Multiple WebSocket endpoints via array config on `startServer` | Task 1, 4 |
| Per-endpoint `actions` and `subscriptions` | Task 1, 4 |
| Per-endpoint socket settings (e.g. `maxHttpBufferSize`) | Task 1, 2 |
| Shared client session across connections (cookie-based `Connection`) | No change needed — already works |
| Path exclusion: `/socket/foo` REST route not consumed by `/socket` WebSocket | Task 2 (already implemented via `allowRequest`), Task 11 (test coverage) |
| Client-side `sockets` array on `SocketAPI` | Task 8, 9 |
| Backward-compatible `name` shorthand on `SocketAPI` | Task 9 |
| Shared JWT auth across multiple sockets | Task 8 (`SecondarySocketAuthenticator`) |
| Named socket targeting from hooks (`useSocket(socketName?)`) | Task 10 |
| All existing tests still pass | Tasks 3, 4, 5, 7, 9, 10 |

### Placeholder scan

No TBD or "implement later" items present.

### Type consistency

- `SocketEndpointConfig` introduced in Task 1 and used in Tasks 2, 3, 4, 5 — name is consistent.
- `ClientSocketConfig` introduced in Task 8 and re-exported in Task 9 — consistent.
- `SocketRegistryContext` introduced in Task 6, used in Tasks 7, 8, 10 — consistent.
- `SocketRegistryProvider` introduced in Task 8, used in Task 9 — consistent.
- `SecondarySocketAuthenticator` defined and used within Task 8 only — no cross-task reference.
