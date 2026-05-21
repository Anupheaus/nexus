# REST Action Registration Aligned With Socket Actions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** REST routes are registered only for `NexusServerAction` objects explicitly passed to `startServer`, mirroring how socket handlers work.

**Architecture:** Change all server handler types from bare `() => void` functions to objects with a `registerSocket()` method. Actions additionally carry a `restEntry` property with the data needed to build REST routes. The global `restActionRegistry` module is eliminated; `registerRestActions` receives the actions array directly from `startServer`. `registerAuthRoutes` returns its created actions instead of discarding them.

**Tech Stack:** TypeScript, Vitest, Koa Router 12 (path-to-regexp v8), Socket.IO

---

## File Map

| File | Change |
|------|--------|
| `src/server/handler/createServerHandler.ts` | `NexusServerHandler` becomes `{ registerSocket(): void }`; implementation wraps socket registration in that method |
| `src/server/handler/setupHandlers.ts` | Calls `handler.registerSocket()` instead of `handler()` |
| `src/server/subscriptions/createServerSubscription.ts` | `NexusServerSubscription` becomes `{ registerSocket(): void }` |
| `src/server/actions/createServerActionHandler.ts` | `NexusServerAction` becomes `{ registerSocket(): void; restEntry: RestActionRegistryEntry }`; `RestActionRegistryEntry` defined here; no more global registry call |
| `src/server/actions/registerRestActions.ts` | Accepts `NexusServerAction[]` parameter; builds local map; fixes `{name}` URL substitution |
| `src/server/auth/registerAuthRoutes.ts` | Returns `NexusServerAction[]` |
| `src/server/startServer.ts` | Collects auth actions from `registerAuthRoutes`; passes combined list to `registerRestActions` |
| `src/server/actions/restActionRegistry.ts` | **Deleted** |
| `src/server/handler/createServerHandler.tests.ts` | Updated: checks object shape instead of `instanceof Function` |
| `src/server/handler/setupHandlers.tests.ts` | Updated: handlers are `{ registerSocket: vi.fn() }` objects |
| `src/server/actions/createServerActionHandler.tests.ts` | Updated: factory test checks `restEntry` and `registerSocket` |
| `src/server/actions/registerRestActions.tests.ts` | Updated: builds `NexusServerAction` objects directly; no global registry |
| `src/server/auth/registerAuthRoutes.tests.ts` | Updated: asserts returned array |
| `src/server/actions/restActionRegistry.tests.ts` | **Deleted** |
| `src/server/actions/AGENTS.md` | Updated: removes `restActionRegistry.ts` row |

---

## Task 1: Update handler shapes across all four core files

**Files:**
- Modify: `src/server/handler/createServerHandler.ts`
- Modify: `src/server/handler/setupHandlers.ts`
- Modify: `src/server/subscriptions/createServerSubscription.ts`
- Modify: `src/server/actions/createServerActionHandler.ts`
- Modify: `src/server/handler/createServerHandler.tests.ts`
- Modify: `src/server/handler/setupHandlers.tests.ts`
- Modify: `src/server/actions/createServerActionHandler.tests.ts`

> These four source files are changed together because their types are mutually dependent — TypeScript will not compile an intermediate state where only some of them are updated.

- [ ] **Step 1: Update `setupHandlers.tests.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDebug = vi.fn();
const mockLogger = { debug: mockDebug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../async-context/socketApiContext', () => ({
  useLogger: () => mockLogger,
}));

import { setupHandlers } from './setupHandlers';

describe('setupHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the handlers array is empty', () => {
    expect(() => setupHandlers([])).not.toThrow();
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it('calls registerSocket on each handler exactly once', () => {
    const h1 = { registerSocket: vi.fn() };
    const h2 = { registerSocket: vi.fn() };
    setupHandlers([h1, h2]);
    expect(h1.registerSocket).toHaveBeenCalledOnce();
    expect(h2.registerSocket).toHaveBeenCalledOnce();
  });

  it('calls handlers in order', () => {
    const order: number[] = [];
    const h1 = { registerSocket: vi.fn(() => { order.push(1); }) };
    const h2 = { registerSocket: vi.fn(() => { order.push(2); }) };
    const h3 = { registerSocket: vi.fn(() => { order.push(3); }) };
    setupHandlers([h1, h2, h3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('logs debug messages when handlers are present', () => {
    setupHandlers([{ registerSocket: vi.fn() }]);
    expect(mockDebug).toHaveBeenNthCalledWith(1, 'Setting up handlers...');
    expect(mockDebug).toHaveBeenNthCalledWith(2, 'Handlers set up.');
  });

  it('propagates a throw from a handler and stops executing subsequent handlers', () => {
    const h1 = { registerSocket: vi.fn(() => { throw new Error('boom'); }) };
    const h2 = { registerSocket: vi.fn() };
    expect(() => setupHandlers([h1, h2])).toThrow('boom');
    expect(h1.registerSocket).toHaveBeenCalledOnce();
    expect(h2.registerSocket).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Update `createServerHandler.tests.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('createServerHandler', () => {
  const mockHandler = vi.fn(async (req: { id: string }) => ({ result: req.id }));

  beforeEach(() => {
    vi.resetModules();
  });

  it('returns an object with a registerSocket method', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const handler = createServerHandler('action', 'test.prefix', 'uniqueAction1', mockHandler);
    expect(typeof handler.registerSocket).toBe('function');
  });

  it('throws when same handler is registered twice', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    createServerHandler('action', 'test.prefix', 'duplicateAction', mockHandler);
    expect(() =>
      createServerHandler('action', 'test.prefix', 'duplicateAction', mockHandler)
    ).toThrow("Handler for action 'test.prefix.duplicateAction' already registered");
  });

  it('allows different handler names with same prefix', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const reg1 = createServerHandler('action', 'test.prefix', 'actionOne', mockHandler);
    const reg2 = createServerHandler('action', 'test.prefix', 'actionTwo', mockHandler);
    expect(typeof reg1.registerSocket).toBe('function');
    expect(typeof reg2.registerSocket).toBe('function');
  });

  it('accepts an optional transport parameter without errors', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const handler = createServerHandler('action', 'test.prefix', 'restOnlyAction1', mockHandler, undefined, false, undefined, ['rest']);
    expect(typeof handler.registerSocket).toBe('function');
  });
});
```

- [ ] **Step 3: Update the factory test in `createServerActionHandler.tests.ts`**

Find and replace the `createServerActionHandler — factory` describe block at the bottom of the file:

```ts
// ─── Factory unit tests ───────────────────────────────────────────────────────

describe('createServerActionHandler — factory', () => {
  it('returns an object with registerSocket and restEntry', () => {
    const action = defineAction<{ id: string }, { success: boolean }>()('factoryTestAction');
    const handler = vi.fn(async () => ({ success: true }));
    const result = createServerActionHandler(action, handler);
    expect(typeof result.registerSocket).toBe('function');
    expect(result.restEntry).toBeDefined();
    expect(result.restEntry.action).toBe(action);
    expect(typeof result.restEntry.handler).toBe('function');
    expect(result.restEntry.limitGate).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the three test files to confirm they fail**

```bash
cd c:/code/personal/nexus && pnpm test -- --reporter=verbose createServerHandler.tests setupHandlers.tests createServerActionHandler.tests
```

Expected: failures about `handler.registerSocket is not a function` and `result.restEntry is undefined`.

- [ ] **Step 5: Update `createServerHandler.ts`**

Replace the entire file with:

```ts
import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { NexusActionServerOptions } from '../../common/defineAction';
import { InternalError, is, type PromiseMaybe } from '@anupheaus/common';
import { useNexus } from '../providers';
import { useConfig, wrap, useLogger } from '../async-context/socketApiContext';
import { createActionLimitGate, type ActionLimitGate } from './actionLimitGate';
import { useAuthentication } from '../providers/authentication';
import { createSocketHandlerUtils } from './handlerUtils';
import type { NexusServerHandlerActionUtils } from './handlerUtils';

export interface NexusServerHandler {
  registerSocket(): void;
}

export type NexusServerHandlerFunction<Request, Response> = (
  request: Request,
  utils: NexusServerHandlerActionUtils,
) => PromiseMaybe<Response>;

const registeredHandlers = new Set<string>();

export function createServerHandler<Request, Response>(
  type: string,
  prefix: string,
  name: string,
  handler: NexusServerHandlerFunction<Request, Response>,
  serverLimits?: NexusActionServerOptions,
  isPublic = false,
  existingLimitGate?: ActionLimitGate,
  transport?: Array<'socket' | 'rest'>,
): NexusServerHandler {
  const fullName = `${prefix}.${name}`;
  const pascalType = type.toPascalCase();
  if (registeredHandlers.has(fullName)) throw new InternalError(`Handler for ${type} '${fullName}' already registered.`);
  registeredHandlers.add(fullName);
  const sharedLimitGate: ActionLimitGate = existingLimitGate ?? createActionLimitGate(serverLimits);
  return {
    registerSocket: () => {
      const logger = useLogger();
      const { getClient } = useNexus();
      const client = getClient(true);
      const limitGate = sharedLimitGate;
      logger.silly(`Registering ${type} '${fullName}'...`);
      client.on(
        fullName,
        wrap(client, async (...args: unknown[]) => {
          const requestId = Math.uniqueId();
          const response = args.pop();

          // Transport check — reject socket calls to REST-only actions before any auth or limit gate.
          if (transport != null && !transport.includes('socket')) {
            if (is.function(response)) response({ error: { message: 'This action is only available via REST' } });
            return;
          }

          const startTime = performance.now();
          const result = await wrapAckHandler(() => limitGate.run(async () => {
            const { onBeforeHandle } = useConfig();
            const { user } = useAuthentication();
            await onBeforeHandle?.(client);
            const { auth } = useConfig();
            if (auth != null && !isPublic && user == null) throw new Error('Unauthorized');
            return (handler as Function)(...args, createSocketHandlerUtils(client, requestId));
          }));
          const duration = performance.now() - startTime;
          const { error, response: ok } = getErrorFromAckResponse(result);
          if (error) {
            logger.error(`${name} ${pascalType} Error`, { error, requestId });
          } else {
            logger.debug(`${name} ${pascalType} Invoked`, { args, result: ok, requestId, duration: `${duration.toFixed(0)}ms` });
          }
          if (is.function(response)) response(result);
        }),
      );
    },
  };
}
```

- [ ] **Step 6: Update `setupHandlers.ts`**

Replace the entire file with:

```ts
import { useLogger } from '../async-context/socketApiContext';
import type { NexusServerHandler } from './createServerHandler';

export function setupHandlers(handlers: NexusServerHandler[]) {
  if (handlers.length === 0) return;
  const logger = useLogger();

  logger.debug('Setting up handlers...');
  handlers.forEach(handler => handler.registerSocket());
  logger.debug('Handlers set up.');
}
```

- [ ] **Step 7: Update `createServerSubscription.ts`**

Change only the type alias near the top of the file. Find:

```ts
export type NexusServerSubscription = () => void;
```

Replace with:

```ts
export interface NexusServerSubscription {
  registerSocket(): void;
}
```

No other changes needed — `createServerSubscription` already returns the result of `createServerHandler(...)`, which now satisfies this interface.

- [ ] **Step 8: Update `createServerActionHandler.ts`**

Replace the entire file with:

```ts
import type { NexusAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { NexusServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';
import { createActionLimitGate } from '../handler/actionLimitGate';
import type { ActionLimitGate } from '../handler/actionLimitGate';

export interface RestActionRegistryEntry {
  action: NexusAction<string, unknown, unknown>;
  handler: NexusServerHandlerFunction<unknown, unknown>;
  limitGate: ActionLimitGate;
}

export interface NexusServerAction {
  registerSocket(): void;
  restEntry: RestActionRegistryEntry;
}

export function createServerActionHandler<Name extends string, Request, Response>(
  action: NexusAction<Name, Request, Response>,
  handler: NexusServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): NexusServerAction {
  const isPublic = options?.isPublic ?? action.isPublic ?? false;
  const limitGate = createActionLimitGate(action.server);
  const socketHandler = createServerHandler('action', actionPrefix, action.name, handler, action.server, isPublic, limitGate, action.transport);
  return {
    registerSocket: () => socketHandler.registerSocket(),
    restEntry: { action, handler, limitGate } as RestActionRegistryEntry,
  };
}
```

- [ ] **Step 9: Run the failing tests to confirm they now pass**

```bash
cd c:/code/personal/nexus && pnpm test -- --reporter=verbose createServerHandler.tests setupHandlers.tests createServerActionHandler.tests
```

Expected: all pass.

- [ ] **Step 10: Run the full test suite to check for regressions**

```bash
cd c:/code/personal/nexus && pnpm test
```

Expected: all pass (or only failures in `registerRestActions.tests.ts` and `registerAuthRoutes.tests.ts`, which are addressed in Tasks 2 and 3).

- [ ] **Step 11: Commit**

```bash
cd c:/code/personal/nexus && git add src/server/handler/createServerHandler.ts src/server/handler/setupHandlers.ts src/server/subscriptions/createServerSubscription.ts src/server/actions/createServerActionHandler.ts src/server/handler/createServerHandler.tests.ts src/server/handler/setupHandlers.tests.ts src/server/actions/createServerActionHandler.tests.ts && git commit -m "refactor(handlers): change handler types from functions to objects with registerSocket()"
```

---

## Task 2: Update `registerRestActions` to accept `NexusServerAction[]`

**Files:**
- Modify: `src/server/actions/registerRestActions.ts`
- Modify: `src/server/actions/registerRestActions.tests.ts`

- [ ] **Step 1: Update `registerRestActions.tests.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { registerRestActions } from './registerRestActions';
import type { NexusServerAction } from './createServerActionHandler';
import { setAuthConfig, clearAuthConfig } from '../auth/authConfig';
import { ConnectionRegistry } from '../providers/connection';
import { setConfig } from '../async-context/socketApiContext';
import { defineAction } from '../../common';
import type { JwtAuthStore, JwtAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';
import { AuthenticationError, NotImplementedError } from '@anupheaus/common';

const echoAction = defineAction<{ value: string }, { value: string }>()('restEcho');
const getUserAction = defineAction<{ id: string }, { name: string }>()('restGetUser', {
  rest: { method: 'GET', url: '/api/users/:id' },
});
const createItemAction = defineAction<{ title: string }, { id: string }>()('restCreateItem', {
  rest: { method: 'POST', url: '/api/items' },
});
const socketOnlyAction = defineAction<{ value: string }, { value: string }>()('socketOnlyAction', {
  transport: ['socket'],
});
const redirectAction = defineAction<void, void>()('redirectAction');
const authErrAction = defineAction<void, void>()('authErrAction');
const notFoundAction = defineAction<void, void>()('notFoundAction');

const limitGate = { run: async (fn: () => unknown) => fn() };

function makeServerAction<Req, Res>(
  action: ReturnType<ReturnType<typeof defineAction<Req, Res>>>,
  handler: (req: Req, utils: any) => unknown,
): NexusServerAction {
  return {
    registerSocket: vi.fn(),
    restEntry: { action: action as any, handler: handler as any, limitGate: limitGate as any },
  };
}

const allActions: NexusServerAction[] = [
  makeServerAction(echoAction, async (req: { value: string }) => ({ value: req.value })),
  makeServerAction(getUserAction, async (req: { id: string }) => ({ name: `User ${req.id}` })),
  makeServerAction(createItemAction, async (req: { title: string }) => ({ id: `item-${req.title}` })),
  makeServerAction(socketOnlyAction, async (req: { value: string }) => ({ value: req.value })),
  makeServerAction(redirectAction, (_req: unknown, { redirect }: any) => redirect('/new-location')),
  makeServerAction(authErrAction, async () => { throw new AuthenticationError(); }),
  makeServerAction(notFoundAction, async () => { throw new NotImplementedError('not here'); }),
];

function makeStore(sessionToken?: string, userId = 'u-1', isEnabled = true): JwtAuthStore {
  const record: JwtAuthRecord | undefined = sessionToken
    ? { requestId: 'r1', sessionToken, userId, deviceId: 'd1', isEnabled }
    : undefined;
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionToken: vi.fn(async (token: string) =>
      token === sessionToken ? record : undefined,
    ),
    findByDevice: vi.fn(),
    update: vi.fn(async () => {}),
  };
}

async function makeApp(opts?: {
  auth?: boolean;
  sessionToken?: string;
  actions?: NexusServerAction[];
}): Promise<{ server: http.Server; port: number }> {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());

  const registry = new ConnectionRegistry();

  if (opts?.auth) {
    const user: NexusUser = { id: 'u-1' };
    const store = makeStore(opts.sessionToken);
    const authConfig = {
      mode: 'jwt' as const,
      store,
      onAuthenticate: async () => user,
      onGetUser: async () => user,
      syncUserToClient: false,
    };
    setAuthConfig(authConfig);
    setConfig({ name: 'test', server: {} as any, auth: authConfig });
  }

  registerRestActions(router, 'test', registry, opts?.actions ?? allActions);
  app.use(router.routes());

  const server = http.createServer(app.callback());
  const port = await new Promise<number>(resolve => {
    server.listen(0, () => resolve((server.address() as any).port));
  });
  return { server, port };
}

describe('registerRestActions', () => {
  beforeEach(() => {
    setConfig({ name: 'test', server: {} as any });
    clearAuthConfig();
  });

  afterEach(() => {
    clearAuthConfig();
  });

  // ── catch-all POST route ────────────────────────────────────────────────────

  it('catch-all: returns 404 for unknown action', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/unknown`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
    server.close();
  });

  it('catch-all: invokes handler and returns 200 with result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ping' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: 'ping' });
    server.close();
  });

  it('catch-all: returns 500 when handler throws a plain error', async () => {
    const failingActions = [
      makeServerAction(echoAction, async () => { throw new Error('handler-fail'); }),
    ];
    const { server, port } = await makeApp({ actions: failingActions });
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toBe('handler-fail');
    server.close();
  });

  // ── auth gate ──────────────────────────────────────────────────────────────

  it('returns 401 when auth is configured and no session cookie', async () => {
    const { server, port } = await makeApp({ auth: true });
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 200 when auth is configured and valid session cookie provided', async () => {
    const { server, port } = await makeApp({ auth: true, sessionToken: 'valid-tok' });
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'socketapi_session=valid-tok' },
      body: JSON.stringify({ value: 'hi' }),
    });
    expect(res.status).toBe(200);
    server.close();
  });

  // ── explicit GET route with path params ────────────────────────────────────

  it('explicit GET route: substitutes path param and returns result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/api/users/u-42`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'User u-42' });
    server.close();
  });

  it('explicit GET route: coerces query param types (number, boolean)', async () => {
    const coerceAction = defineAction<{ active: boolean; count: number }, void>()('coerceTest', {
      rest: { method: 'GET', url: '/api/coerce' },
    });
    const received: unknown[] = [];
    const coerceServerAction = makeServerAction(coerceAction, async (req: unknown) => { received.push(req); });
    const { server, port } = await makeApp({ actions: [coerceServerAction] });
    await fetch(`http://localhost:${port}/api/coerce?active=true&count=42`);
    expect(received[0]).toEqual({ active: true, count: 42 });
    server.close();
  });

  // ── explicit POST route ────────────────────────────────────────────────────

  it('explicit POST route: reads body and returns result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'item-Hello' });
    server.close();
  });

  // ── transport enforcement ──────────────────────────────────────────────────

  it('returns 405 when action transport excludes rest', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/socketOnlyAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(405);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain('socket');
    server.close();
  });

  // ── redirect ───────────────────────────────────────────────────────────────

  it('returns 302 with location header when handler returns redirect result', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/redirectAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/new-location');
    server.close();
  });

  // ── error status codes from typed errors ──────────────────────────────────

  it('returns 401 when handler throws AuthenticationError', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/authErrAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 404 when handler throws NotImplementedError', async () => {
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/notFoundAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
    server.close();
  });

  // ── only registered actions are reachable ─────────────────────────────────

  it('action not in the provided array returns 404 even if it exists elsewhere', async () => {
    const otherAction = defineAction<void, void>()('otherAction');
    const { server, port } = await makeApp({ actions: [] });
    const res = await fetch(`http://localhost:${port}/test/actions/otherAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
    server.close();
  });
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

```bash
cd c:/code/personal/nexus && pnpm test -- --reporter=verbose registerRestActions.tests
```

Expected: TypeScript/import errors or runtime failures — `registerRestActions` still has the old signature.

- [ ] **Step 3: Update `registerRestActions.ts`**

Replace the entire file with:

```ts
import type Router from 'koa-router';
import type { IncomingMessage, ServerResponse } from 'http';
import { wrap, useConfig, setAuthData } from '../async-context/socketApiContext';
import type { ConnectionRegistry } from '../providers/connection';
import { validateRestSession } from '../auth/validateRestSession';
import type { NexusServerAction } from './createServerActionHandler';
import type { RestActionRegistryEntry } from './createServerActionHandler';
import { createRestHandlerUtils, isRedirectResult, type NexusServerHandlerActionUtils } from '../handler/handlerUtils';
import { Error as BaseError, ApiError } from '@anupheaus/common';

function coerceQueryValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== '') return n;
  return v;
}

function buildExplicitRequest(ctx: Router.RouterContext, method: string): unknown {
  const pathParams = ctx.params as Record<string, string>;
  if (method === 'GET' || method === 'DELETE') {
    const query = ctx.query as Record<string, string>;
    const coerced = Object.fromEntries(
      Object.entries(query).map(([k, v]) => [k, coerceQueryValue(v)]),
    );
    return { ...coerced, ...pathParams };
  }
  const body = (ctx.request.body as Record<string, unknown>) ?? {};
  return { ...body, ...pathParams };
}

async function executeRestEntry(
  ctx: Router.RouterContext,
  entry: RestActionRegistryEntry,
  request: unknown,
  connectionRegistry: ConnectionRegistry,
): Promise<void> {
  // Transport check — reject REST calls to socket-only actions before any other work.
  if (entry.action.transport != null && !entry.action.transport.includes('rest')) {
    ctx.status = 405;
    ctx.body = { error: { message: 'This action is only available via socket' } };
    return;
  }

  const headerMap = new Map<string, string>();
  const requestId = Math.uniqueId();

  try {
    const run = wrap(
      (req: IncomingMessage, res: ServerResponse) => connectionRegistry.fromRequest(req, res),
      async (req: IncomingMessage, _res: ServerResponse): Promise<
        | { type: 'success'; result: unknown }
        | { type: 'redirect'; url: string }
        | { type: 'error'; status: number; message: string }
        | { type: 'unauthorized' }
      > => {
        const { auth, onBeforeHandle } = useConfig();
        if (auth != null && !entry.action.isPublic) {
          const session = await validateRestSession(
            req.headers.cookie ?? '',
            auth.store,
            auth.onGetUser,
          );
          if (!session) return { type: 'unauthorized' };
          setAuthData({ user: session.user, token: session.token });
        }
        await onBeforeHandle?.(undefined as any);

        const utils: NexusServerHandlerActionUtils = createRestHandlerUtils(req, headerMap, requestId);
        try {
          const result = await entry.limitGate.run(
            () => (entry.handler as (req: unknown, utils: NexusServerHandlerActionUtils) => unknown)(request, utils),
          );
          if (isRedirectResult(result)) return { type: 'redirect', url: result.url };
          return { type: 'success', result };
        } catch (err) {
          const status = err instanceof ApiError ? err.statusCode
            : err instanceof BaseError ? (err.toJSON().statusCode ?? 400)
            : 500;
          const message = err instanceof globalThis.Error ? err.message : String(err);
          return { type: 'error', status, message };
        }
      },
    );

    const outcome = await run(ctx.req, ctx.res);

    for (const [name, value] of headerMap) ctx.set(name, value);

    if (outcome.type === 'unauthorized') { ctx.status = 401; return; }
    if (outcome.type === 'redirect') { ctx.redirect(outcome.url); ctx.status = 302; return; }
    if (outcome.type === 'error') {
      ctx.status = outcome.status;
      ctx.body = { error: { message: outcome.message } };
      return;
    }
    ctx.status = 200;
    ctx.body = outcome.result ?? {};
  } catch {
    ctx.status = 500;
  }
}

export function registerRestActions(
  router: Router,
  name: string,
  connectionRegistry: ConnectionRegistry,
  actions: NexusServerAction[],
): void {
  const restMap = new Map(actions.map(a => [a.restEntry.action.name, a.restEntry]));

  // Catch-all for actions dispatched by name (no explicit rest config required)
  router.post(`/${name}/actions/:actionName`, async ctx => {
    const actionName = ctx.params.actionName ?? '';
    const entry = restMap.get(actionName);
    if (!entry) {
      ctx.status = 404;
      ctx.body = { error: { message: `Unknown action: ${actionName}` } };
      return;
    }
    await executeRestEntry(ctx, entry, ctx.request.body, connectionRegistry);
  });

  // Explicit routes for actions that declare a rest config
  for (const serverAction of actions) {
    const restRoute = serverAction.restEntry.action.rest;
    if (!restRoute) continue;
    const { method } = restRoute;
    // Substitute {name} with the actual server name before registering the route.
    const url = restRoute.url.replace('{name}', name);
    const routerMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    router[routerMethod](url, async ctx => {
      const request = buildExplicitRequest(ctx, method);
      await executeRestEntry(ctx, serverAction.restEntry, request, connectionRegistry);
    });
  }
}
```

- [ ] **Step 4: Run the test file to confirm it passes**

```bash
cd c:/code/personal/nexus && pnpm test -- --reporter=verbose registerRestActions.tests
```

Expected: all pass, including the new `'action not in the provided array returns 404'` test.

- [ ] **Step 5: Commit**

```bash
cd c:/code/personal/nexus && git add src/server/actions/registerRestActions.ts src/server/actions/registerRestActions.tests.ts && git commit -m "refactor(rest): registerRestActions accepts NexusServerAction[] directly; removes global registry dependency"
```

---

## Task 3: Update `registerAuthRoutes` to return `NexusServerAction[]`

**Files:**
- Modify: `src/server/auth/registerAuthRoutes.ts`
- Modify: `src/server/auth/registerAuthRoutes.tests.ts`

- [ ] **Step 1: Update `registerAuthRoutes.tests.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NexusServerAction } from '../actions/createServerActionHandler';

const {
  mockCreateSigninAction,
  mockCreateSignoutAction,
  mockCreateWebauthnInviteAction,
  mockCreateWebauthnRegisterAction,
  mockCreateWebauthnReauthAction,
} = vi.hoisted(() => ({
  mockCreateSigninAction: vi.fn(),
  mockCreateSignoutAction: vi.fn(),
  mockCreateWebauthnInviteAction: vi.fn(),
  mockCreateWebauthnRegisterAction: vi.fn(),
  mockCreateWebauthnReauthAction: vi.fn(),
}));

vi.mock('../actions/signinAction', () => ({ createSigninAction: mockCreateSigninAction }));
vi.mock('../actions/signoutAction', () => ({ createSignoutAction: mockCreateSignoutAction }));
vi.mock('../actions/webauthnInviteAction', () => ({ createWebauthnInviteAction: mockCreateWebauthnInviteAction }));
vi.mock('../actions/webauthnRegisterAction', () => ({ createWebauthnRegisterAction: mockCreateWebauthnRegisterAction }));
vi.mock('../actions/webauthnReauthAction', () => ({ createWebauthnReauthAction: mockCreateWebauthnReauthAction }));

import { registerAuthRoutes } from './registerAuthRoutes';
import type { JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';

function makeMockAction(): NexusServerAction {
  return {
    registerSocket: vi.fn(),
    restEntry: { action: { name: 'mockAction' } as any, handler: vi.fn() as any, limitGate: { run: vi.fn() } as any },
  };
}

describe('registerAuthRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSigninAction.mockReturnValue(makeMockAction());
    mockCreateSignoutAction.mockReturnValue(makeMockAction());
    mockCreateWebauthnInviteAction.mockReturnValue(makeMockAction());
    mockCreateWebauthnRegisterAction.mockReturnValue(makeMockAction());
    mockCreateWebauthnReauthAction.mockReturnValue(makeMockAction());
  });

  describe('jwt mode', () => {
    const jwtStore = {} as any;
    const onAuthenticate = vi.fn();
    const onGetUser = vi.fn();

    const jwtConfig: JwtAuthConfig = {
      mode: 'jwt',
      store: jwtStore,
      onAuthenticate,
      onGetUser,
      syncUserToClient: true,
    };

    it('registers signin and signout actions only, returns both in order', () => {
      const result = registerAuthRoutes(jwtConfig);

      expect(mockCreateSigninAction).toHaveBeenCalledOnce();
      expect(mockCreateSigninAction).toHaveBeenCalledWith(jwtStore, onAuthenticate);
      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(jwtStore);
      expect(mockCreateWebauthnInviteAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnRegisterAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnReauthAction).not.toHaveBeenCalled();

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(mockCreateSigninAction.mock.results[0].value);
      expect(result[1]).toBe(mockCreateSignoutAction.mock.results[0].value);
    });
  });

  describe('webauthn mode', () => {
    const webauthnStore = {} as any;
    const onGetUserDetails = vi.fn();
    const onGetUser = vi.fn();

    const webauthnConfig: WebAuthnAuthConfig = {
      mode: 'webauthn',
      store: webauthnStore,
      onGetUserDetails,
      onGetUser,
      syncUserToClient: true,
    };

    it('registers invite, register, reauth, and signout actions only, returns all four in order', () => {
      const result = registerAuthRoutes(webauthnConfig);

      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledWith(webauthnStore, onGetUserDetails);
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateSigninAction).not.toHaveBeenCalled();

      expect(result).toHaveLength(4);
      expect(result[0]).toBe(mockCreateWebauthnInviteAction.mock.results[0].value);
      expect(result[1]).toBe(mockCreateWebauthnRegisterAction.mock.results[0].value);
      expect(result[2]).toBe(mockCreateWebauthnReauthAction.mock.results[0].value);
      expect(result[3]).toBe(mockCreateSignoutAction.mock.results[0].value);
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd c:/code/personal/nexus && pnpm test -- --reporter=verbose registerAuthRoutes.tests
```

Expected: fails because `registerAuthRoutes` still returns `void`.

- [ ] **Step 3: Update `registerAuthRoutes.ts`**

Replace the entire file with:

```ts
import type { NexusServerAction } from '../actions/createServerActionHandler';
import type { AuthConfig } from './authConfig';
import { createSigninAction } from '../actions/signinAction';
import { createSignoutAction } from '../actions/signoutAction';
import { createWebauthnInviteAction } from '../actions/webauthnInviteAction';
import { createWebauthnRegisterAction } from '../actions/webauthnRegisterAction';
import { createWebauthnReauthAction } from '../actions/webauthnReauthAction';

/** Creates auth action handlers and returns them as `NexusServerAction[]`.
 *  Pass the returned array to `registerRestActions` via `startServer`. */
export function registerAuthRoutes(config: AuthConfig): NexusServerAction[] {
  const actions: NexusServerAction[] = [];
  if (config.mode === 'jwt') {
    actions.push(createSigninAction(config.store, config.onAuthenticate));
  }
  if (config.mode === 'webauthn') {
    actions.push(createWebauthnInviteAction(config.store, config.onGetUserDetails));
    actions.push(createWebauthnRegisterAction(config.store));
    actions.push(createWebauthnReauthAction(config.store));
  }
  actions.push(createSignoutAction(config.store));
  return actions;
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd c:/code/personal/nexus && pnpm test -- --reporter=verbose registerAuthRoutes.tests
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd c:/code/personal/nexus && git add src/server/auth/registerAuthRoutes.ts src/server/auth/registerAuthRoutes.tests.ts && git commit -m "refactor(auth): registerAuthRoutes returns NexusServerAction[] instead of void"
```

---

## Task 4: Wire `startServer` to pass actions to `registerRestActions`

**Files:**
- Modify: `src/server/startServer.ts`

- [ ] **Step 1: Update `startServer.ts`**

Find these two consecutive lines inside the `logger.provide(async () => {` block:

```ts
    if (auth) registerAuthRoutes(auth);
    registerRestActions(router, name, registry);
```

Replace with:

```ts
    const authActions = auth ? registerAuthRoutes(auth) : [];
    registerRestActions(router, name, registry, [...(actions ?? []), ...authActions]);
```

- [ ] **Step 2: Run the full test suite**

```bash
cd c:/code/personal/nexus && pnpm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
cd c:/code/personal/nexus && git add src/server/startServer.ts && git commit -m "fix(server): REST routes registered only for actions passed to startServer"
```

---

## Task 5: Delete `restActionRegistry` and update AGENTS.md

**Files:**
- Delete: `src/server/actions/restActionRegistry.ts`
- Delete: `src/server/actions/restActionRegistry.tests.ts`
- Modify: `src/server/actions/AGENTS.md`

- [ ] **Step 1: Verify `restActionRegistry` has no remaining imports**

```bash
cd c:/code/personal/nexus && grep -r "restActionRegistry" src/
```

Expected: no output (zero matches). If any file still imports from it, fix that file before proceeding.

- [ ] **Step 2: Delete the two files**

```bash
cd c:/code/personal/nexus && git rm src/server/actions/restActionRegistry.ts src/server/actions/restActionRegistry.tests.ts
```

- [ ] **Step 3: Update `src/server/actions/AGENTS.md`**

Find and remove this row from the Files table:

```
| `restActionRegistry.ts` | Internal registry mapping action names to their REST configurations |
```

Also update the `registerRestActions.ts` row description to reflect that it now receives the actions array:

Find:
```
| `registerRestActions.ts` | Registers Koa REST endpoints for all actions that have a `rest` config |
```

Replace with:
```
| `registerRestActions.ts` | Registers Koa REST endpoints for actions passed in from `startServer` — catch-all and explicit routes |
```

- [ ] **Step 4: Run the full test suite one final time**

```bash
cd c:/code/personal/nexus && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd c:/code/personal/nexus && git add src/server/actions/AGENTS.md && git commit -m "chore: delete restActionRegistry — superseded by explicit actions parameter on registerRestActions"
```
