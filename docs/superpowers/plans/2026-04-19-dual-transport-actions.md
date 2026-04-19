# Dual-Transport Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every action available over REST automatically (socket preferred, REST fallback when not connected), with transport selected transparently at call time.

**Architecture:** `defineAction` gains an optional `rest?: { method, url }` field. On the server, `createServerActionHandler` eagerly registers each action in a module-level REST registry alongside the socket handler. `startServer` registers a `POST /{name}/actions/:actionName` catch-all plus any explicit routes before user routes. On the client, `useAction` checks `getIsConnected()` per-call and falls back to `fetch` when the socket is down, constructing the URL from the action's `rest` field or the catch-all.

**Tech Stack:** TypeScript, Koa + koa-router (server REST), Socket.IO (socket transport), Vitest, React (client hook).

**Spec:** `docs/superpowers/specs/2026-04-19-dual-transport-actions-design.md`

---

## File Map

### New files
| Path | Responsibility |
|------|----------------|
| `src/server/actions/restActionRegistry.ts` | Module-level map: action name → handler + limit gate + action metadata |
| `src/server/actions/registerRestActions.ts` | Registers catch-all and explicit Koa routes; handles auth, async context, error serialisation |
| `src/server/auth/validateRestSession.ts` | Parses `socketapi_session` cookie from a header string, validates against store, returns user |

### Modified files
| Path | Change |
|------|--------|
| `src/common/defineAction.ts` | Add `RestActionOptions`, `rest?` to `DefineActionOptions` + `SocketAPIAction`, slash validation |
| `src/server/handler/createServerHandler.ts` | Accept optional pre-created `ActionLimitGate` instead of always creating lazily |
| `src/server/actions/createServerActionHandler.ts` | Create gate eagerly; register in REST registry |
| `src/server/actions/index.ts` | Export `registerRestActions` |
| `src/server/startServer.ts` | Call `registerRestActions` after auth routes |
| `src/client/hooks/useAction.ts` | REST fallback via `fetch` when socket not connected |

---

## Task 1: Add `rest` field and slash validation to `defineAction`

**Files:**
- Modify: `src/common/defineAction.ts`
- Create: `src/common/defineAction.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/common/defineAction.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAction } from './defineAction';

describe('defineAction', () => {
  it('returns action with name and no rest field when not specified', () => {
    const action = defineAction<{ id: string }, { name: string }>()('getUser');
    expect(action.name).toBe('getUser');
    expect(action.rest).toBeUndefined();
  });

  it('returns action with rest field when specified', () => {
    const action = defineAction<{ id: string }, { name: string }>()('getUser', {
      rest: { method: 'GET', url: '/users/:id' },
    });
    expect(action.rest).toEqual({ method: 'GET', url: '/users/:id' });
  });

  it('throws when action name contains a slash', () => {
    expect(() => defineAction<void, void>()('my/action')).toThrow(
      'Action name "my/action" must not contain a slash',
    );
  });

  it('does not throw for action name with dots or hyphens', () => {
    expect(() => defineAction<void, void>()('user.create')).not.toThrow();
    expect(() => defineAction<void, void>()('user-create')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --dir C:/code/personal/socket-api test src/common/defineAction.tests.ts`
Expected: FAIL — `rest` field missing, no validation error thrown

- [ ] **Step 3: Update `src/common/defineAction.ts`**

```ts
/** Server-side limits for an action (enforced in `createServerActionHandler`). */
export interface SocketAPIActionServerOptions {
  queue?: {
    max: number;
    timeout?: number;
  };
  concurrent?: {
    max: number;
  };
}

export interface RestActionOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL template with named path params matching request property names, e.g. `/users/:id` */
  url: string;
}

export interface SocketAPIAction<Name extends string, Request, Response> {
  name: Name;
  requestType?: Request;
  responseType?: Response;
  server?: SocketAPIActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions;
}

export interface DefineActionOptions {
  server?: SocketAPIActionServerOptions;
  /** When true, unauthenticated clients may call this action. Defaults to false (auth required). */
  isPublic?: boolean;
  /** REST endpoint config. If omitted, the action is reachable via the auto catch-all POST /{name}/actions/:actionName. */
  rest?: RestActionOptions;
}

export function defineAction<Request, Response>() {
  return <Name extends string>(
    name: Name,
    options?: DefineActionOptions,
  ): SocketAPIAction<Name, Request, Response> => {
    if (name.includes('/')) throw new Error(`Action name "${name}" must not contain a slash — it is used as a URL path segment.`);
    return {
      name,
      ...(options?.server != null ? { server: options.server } : {}),
      ...(options?.isPublic === true ? { isPublic: true } : {}),
      ...(options?.rest != null ? { rest: options.rest } : {}),
    };
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --dir C:/code/personal/socket-api test src/common/defineAction.tests.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `pnpm --dir C:/code/personal/socket-api test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git -C C:/code/personal/socket-api add src/common/defineAction.ts src/common/defineAction.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(actions): add RestActionOptions and rest field to defineAction; validate no slash in name"
```

---

## Task 2: REST action registry

**Files:**
- Create: `src/server/actions/restActionRegistry.ts`
- Create: `src/server/actions/restActionRegistry.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/actions/restActionRegistry.tests.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerRestAction, getRestAction, getAllRestActions, clearRestActionRegistry } from './restActionRegistry';
import type { SocketAPIAction } from '../../common';
import type { ActionLimitGate } from '../handler/actionLimitGate';

const makeLimitGate = (): ActionLimitGate => ({ run: async (fn) => fn() });

describe('restActionRegistry', () => {
  beforeEach(() => clearRestActionRegistry());

  it('returns undefined for unknown action', () => {
    expect(getRestAction('unknown')).toBeUndefined();
  });

  it('returns entry after registration', () => {
    const action: SocketAPIAction<'getUser', { id: string }, { name: string }> = { name: 'getUser' };
    const handler = async () => ({ name: 'Alice' });
    const limitGate = makeLimitGate();
    registerRestAction(action, handler, limitGate);
    const entry = getRestAction('getUser');
    expect(entry).toBeDefined();
    expect(entry!.action.name).toBe('getUser');
    expect(entry!.handler).toBe(handler);
    expect(entry!.limitGate).toBe(limitGate);
  });

  it('getAllRestActions returns all registered entries', () => {
    const a1: SocketAPIAction<'a1', void, void> = { name: 'a1' };
    const a2: SocketAPIAction<'a2', void, void> = { name: 'a2' };
    registerRestAction(a1, async () => {}, makeLimitGate());
    registerRestAction(a2, async () => {}, makeLimitGate());
    expect(getAllRestActions()).toHaveLength(2);
  });

  it('clearRestActionRegistry empties the registry', () => {
    const action: SocketAPIAction<'x', void, void> = { name: 'x' };
    registerRestAction(action, async () => {}, makeLimitGate());
    clearRestActionRegistry();
    expect(getRestAction('x')).toBeUndefined();
    expect(getAllRestActions()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --dir C:/code/personal/socket-api test src/server/actions/restActionRegistry.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/actions/restActionRegistry.ts`**

```ts
import type { SocketAPIAction } from '../../common';
import type { SocketAPIServerHandlerFunction } from '../handler';
import type { ActionLimitGate } from '../handler/actionLimitGate';

export interface RestActionRegistryEntry {
  handler: SocketAPIServerHandlerFunction<unknown, unknown>;
  action: SocketAPIAction<string, unknown, unknown>;
  limitGate: ActionLimitGate;
}

const registry = new Map<string, RestActionRegistryEntry>();

export function registerRestAction<Request, Response>(
  action: SocketAPIAction<string, Request, Response>,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  limitGate: ActionLimitGate,
): void {
  registry.set(action.name, { handler, action, limitGate } as RestActionRegistryEntry);
}

export function getRestAction(name: string): RestActionRegistryEntry | undefined {
  return registry.get(name);
}

export function getAllRestActions(): RestActionRegistryEntry[] {
  return [...registry.values()];
}

export function clearRestActionRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --dir C:/code/personal/socket-api test src/server/actions/restActionRegistry.tests.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/actions/restActionRegistry.ts src/server/actions/restActionRegistry.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(actions): add REST action registry"
```

---

## Task 3: Session validation helper for REST

**Files:**
- Create: `src/server/auth/validateRestSession.ts`
- Create: `src/server/auth/validateRestSession.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/validateRestSession.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { validateRestSession } from './validateRestSession';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

const user: SocketAPIUser = { id: 'user-1' };
const record: SocketAPIAuthRecord = {
  requestId: 'req-1', sessionToken: 'valid-token', userId: 'user-1',
  deviceId: 'dev-1', isEnabled: true,
};

function makeStore(overrides?: Partial<SocketAPIAuthRecord | undefined>): SocketAPIAuthStore {
  const r = overrides === undefined ? undefined : { ...record, ...overrides };
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionToken: vi.fn(async () => r),
    findByDevice: vi.fn(),
    update: vi.fn(async () => {}),
  };
}

const onGetUser = vi.fn(async () => user);

describe('validateRestSession', () => {
  it('returns undefined when no session cookie present', async () => {
    const store = makeStore(undefined);
    const result = await validateRestSession('other=foo', store, onGetUser);
    expect(result).toBeUndefined();
    expect(store.findBySessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined when session token not found in store', async () => {
    const store = makeStore(undefined);
    const result = await validateRestSession('socketapi_session=bad-token', store, onGetUser);
    expect(result).toBeUndefined();
  });

  it('returns undefined when record is disabled', async () => {
    const store = makeStore({ isEnabled: false });
    const result = await validateRestSession('socketapi_session=valid-token', store, onGetUser);
    expect(result).toBeUndefined();
  });

  it('returns user and updates lastConnectedAt for valid session', async () => {
    const store = makeStore({});
    const result = await validateRestSession('socketapi_session=valid-token', store, onGetUser);
    expect(result).toBe(user);
    expect(store.update).toHaveBeenCalledWith('req-1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('parses cookie correctly when multiple cookies are present', async () => {
    const store = makeStore({});
    await validateRestSession('other=val; socketapi_session=valid-token; another=x', store, onGetUser);
    expect(store.findBySessionToken).toHaveBeenCalledWith('valid-token');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --dir C:/code/personal/socket-api test src/server/auth/validateRestSession.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/auth/validateRestSession.ts`**

```ts
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

function parseSessionToken(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('socketapi_session=')) return trimmed.slice('socketapi_session='.length);
  }
  return undefined;
}

export async function validateRestSession(
  cookieHeader: string,
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
  onGetUser: (userId: string) => Promise<SocketAPIUser | undefined>,
): Promise<SocketAPIUser | undefined> {
  const token = parseSessionToken(cookieHeader);
  if (!token) return undefined;
  const record = await store.findBySessionToken(token);
  if (!record?.isEnabled) return undefined;
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  return onGetUser(record.userId);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --dir C:/code/personal/socket-api test src/server/auth/validateRestSession.tests.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Export from `src/server/auth/index.ts`**

Open `src/server/auth/index.ts` and add:

```ts
export { validateRestSession } from './validateRestSession';
```

- [ ] **Step 6: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/validateRestSession.ts src/server/auth/validateRestSession.tests.ts src/server/auth/index.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add validateRestSession helper for REST route auth"
```

---

## Task 4: Wire REST registry into `createServerActionHandler`

**Files:**
- Modify: `src/server/handler/createServerHandler.ts`
- Modify: `src/server/actions/createServerActionHandler.ts`

The `ActionLimitGate` is currently created lazily inside `createServerHandler`. We need to create it eagerly in `createServerActionHandler` so the same gate instance can be stored in the REST registry and shared between both transports.

- [ ] **Step 1: Modify `src/server/handler/createServerHandler.ts`** to accept an optional pre-created gate

Replace the existing `createServerHandler` signature and lazy-gate logic:

```ts
import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { SocketAPIActionServerOptions } from '../../common/defineAction';
import { InternalError, is, type PromiseMaybe } from '@anupheaus/common';
import { useSocketAPI } from '../providers';
import { useConfig, wrap, useLogger, useAuthData } from '../async-context/socketApiContext';
import { createActionLimitGate, type ActionLimitGate } from './actionLimitGate';

export type SocketAPIServerHandler = () => void;

export type SocketAPIServerHandlerFunction<Request, Response> = (request: Request) => PromiseMaybe<Response>;

const registeredHandlers = new Set<string>();

export function createServerHandler<Request, Response>(
  type: string,
  prefix: string,
  name: string,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  serverLimits?: SocketAPIActionServerOptions,
  isPublic = false,
  existingLimitGate?: ActionLimitGate,
): SocketAPIServerHandler {
  const fullName = `${prefix}.${name}`;
  const pascalType = type.toPascalCase();
  if (registeredHandlers.has(fullName)) throw new InternalError(`Handler for ${type} '${fullName}' already registered.`);
  registeredHandlers.add(fullName);
  const sharedLimitGate: ActionLimitGate = existingLimitGate ?? createActionLimitGate(serverLimits);
  return () => {
    const logger = useLogger();
    const { getClient } = useSocketAPI();
    const client = getClient(true);
    const limitGate = sharedLimitGate;
    logger.silly(`Registering ${type} '${fullName}'...`);
    client.on(
      fullName,
      wrap(client, async (...args: unknown[]) => {
        const requestId = Math.uniqueId();
        const response = args.pop();
        const startTime = performance.now();
        const result = await wrapAckHandler(() => limitGate.run(async () => {
          const { onBeforeHandle } = useConfig();
          await onBeforeHandle?.(client);
          const { auth } = useConfig();
          if (auth != null && !isPublic && useAuthData()?.user == null) throw new Error('Unauthorized');
          return (handler as Function)(...args);
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
  };
}
```

Note: the only change is replacing `let sharedLimitGate: ActionLimitGate | undefined; ... sharedLimitGate ??= createActionLimitGate(serverLimits);` with `const sharedLimitGate: ActionLimitGate = existingLimitGate ?? createActionLimitGate(serverLimits);` and adding the `existingLimitGate?` parameter.

- [ ] **Step 2: Modify `src/server/actions/createServerActionHandler.ts`** to create gate eagerly and register in REST registry

```ts
import type { SocketAPIAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { SocketAPIServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';
import { createActionLimitGate } from '../handler/actionLimitGate';
import { registerRestAction } from './restActionRegistry';

export type SocketAPIServerAction = () => void;

export function createServerActionHandler<Name extends string, Request, Response>(
  action: SocketAPIAction<Name, Request, Response>,
  handler: SocketAPIServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): SocketAPIServerAction {
  const isPublic = options?.isPublic ?? action.isPublic ?? false;
  const limitGate = createActionLimitGate(action.server);
  registerRestAction(action, handler, limitGate);
  return createServerHandler('action', actionPrefix, action.name, handler, action.server, isPublic, limitGate);
}
```

- [ ] **Step 3: Run the full test suite**

Run: `pnpm --dir C:/code/personal/socket-api test`
Expected: all tests pass (no behavioural change — just eager gate creation and REST registry population)

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/handler/createServerHandler.ts src/server/actions/createServerActionHandler.ts
git -C C:/code/personal/socket-api commit -m "feat(actions): eagerly create limit gate and register in REST registry"
```

---

## Task 5: REST route registration (`registerRestActions`)

**Files:**
- Create: `src/server/actions/registerRestActions.ts`

This file registers two kinds of routes on the Koa router:

1. **Catch-all**: `POST /{name}/actions/:actionName` — dispatches to any registered action via the REST registry.
2. **Explicit routes**: For each action in the registry that has `action.rest` set, registers `{method} {url}` on the router. Path params are extracted from the URL template (`:id` → `request.id`); remaining fields come from query string (GET/DELETE) or body (POST/PUT/PATCH).

Both kinds: set up async context via `ConnectionRegistry`, validate session cookie for non-public actions, run through the limit gate, serialise errors.

- [ ] **Step 1: Create `src/server/actions/registerRestActions.ts`**

```ts
import type Router from 'koa-router';
import type { IncomingMessage, ServerResponse } from 'http';
import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import { wrap, useConfig, setAuthData } from '../async-context/socketApiContext';
import type { ConnectionRegistry } from '../providers/connection';
import { validateRestSession } from '../auth/validateRestSession';
import type { SocketAPIAuthConfig } from '../auth/authConfig';
import { getRestAction, getAllRestActions, type RestActionRegistryEntry } from './restActionRegistry';

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
    const coerced = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, coerceQueryValue(v)]));
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
  const run = wrap(
    (req: IncomingMessage, res: ServerResponse) => connectionRegistry.fromRequest(req, res),
    async (req: IncomingMessage): Promise<{ status: 401 } | { status: 200; result: unknown }> => {
      const { auth } = useConfig();
      if (auth != null && !entry.action.isPublic) {
        const user = await validateRestSession(req.headers.cookie ?? '', (auth as SocketAPIAuthConfig).store as any, (auth as SocketAPIAuthConfig).onGetUser);
        if (!user) return { status: 401 };
        setAuthData({ user });
      }
      const result = await wrapAckHandler(() => entry.limitGate.run(() => (entry.handler as Function)(request)));
      return { status: 200, result };
    },
  );

  const outcome = await run(ctx.req, ctx.res);

  if (outcome.status === 401) {
    ctx.status = 401;
    return;
  }

  const { error, response } = getErrorFromAckResponse(outcome.result);
  if (error) {
    ctx.status = 400;
    ctx.body = { error: { message: error.message } };
  } else {
    ctx.status = 200;
    ctx.body = response;
  }
}

export function registerRestActions(
  router: Router,
  name: string,
  connectionRegistry: ConnectionRegistry,
): void {
  // Catch-all for actions without an explicit rest config
  router.post(`/${name}/actions/:actionName`, async ctx => {
    const actionName = ctx.params.actionName;
    const entry = getRestAction(actionName);
    if (!entry) {
      ctx.status = 404;
      ctx.body = { error: { message: `Unknown action: ${actionName}` } };
      return;
    }
    await executeRestEntry(ctx, entry, ctx.request.body, connectionRegistry);
  });

  // Explicit routes — registered at startup from whatever is in the registry at that point.
  // Actions are registered synchronously via createServerActionHandler before startServer
  // calls registerRestActions, so the registry is fully populated here.
  for (const entry of getAllRestActions()) {
    if (!entry.action.rest) continue;
    const { method, url } = entry.action.rest;
    const routerMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    router[routerMethod](url, async ctx => {
      const request = buildExplicitRequest(ctx, method);
      await executeRestEntry(ctx, entry, request, connectionRegistry);
    });
  }
}
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm --dir C:/code/personal/socket-api test`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/actions/registerRestActions.ts
git -C C:/code/personal/socket-api commit -m "feat(actions): add registerRestActions — catch-all and explicit Koa routes"
```

---

## Task 6: Wire REST routes into `startServer`

**Files:**
- Modify: `src/server/actions/index.ts`
- Modify: `src/server/startServer.ts`

- [ ] **Step 1: Export `registerRestActions` from `src/server/actions/index.ts`**

```ts
export * from './createServerActionHandler';
export * from './useAction';
export { registerRestActions } from './registerRestActions';
```

- [ ] **Step 2: Modify `src/server/startServer.ts`** to call `registerRestActions`

Add the import at the top:

```ts
import { registerRestActions } from './actions';
```

In the `startServer` function body, add the call after `registerAuthRoutes` and before `onRegisterRoutes`:

```ts
const router = new Router();
if (auth) registerAuthRoutes(router, name, auth);
registerRestActions(router, name, registry);           // ← add this line
if (onRegisterRoutes) await onRegisterRoutes(router);
app.use(router.routes());
```

- [ ] **Step 3: Run the full test suite**

Run: `pnpm --dir C:/code/personal/socket-api test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/actions/index.ts src/server/startServer.ts
git -C C:/code/personal/socket-api commit -m "feat(actions): wire registerRestActions into startServer"
```

---

## Task 7: Client REST fallback in `useAction`

**Files:**
- Modify: `src/client/hooks/useAction.ts`

When the socket is not connected, `useAction` falls back to `fetch`. The URL is built from `action.rest` (explicit) or the auto catch-all. For the server `name`, read from `SocketContext`.

- [ ] **Step 1: Read `src/client/hooks/useAction.ts`** — already provided above, no new read needed.

- [ ] **Step 2: Write the updated `src/client/hooks/useAction.ts`**

```ts
import { useContext, useLayoutEffect, useRef, useState } from 'react';
import type { SocketAPIAction } from '../../common';
import { getErrorFromAckResponse, throwIfAckError } from '../../common/ackResponse';
import { useSocket } from '../providers';
import { Error } from '@anupheaus/common';
import { actionPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';

function a<Request, Response>(request: Request, response: (response: Response) => void): void;
function a<Request, Response>(request: Request): Promise<Response>;
function a<Request, Response>(_request: Request, _response?: (response: Response) => void): void | Promise<Response> {
  return;
}

export type UseAction<Name extends string, Request, Response> =
  { isConnected(): boolean; }
  & { [P in Name]: typeof a<Request, Response>; }
  & { [P in `use${Capitalize<Name>}`]: (request: Request) => { response: Response | undefined; error: Error | undefined; isLoading: boolean; }; };

export type GetUseActionType<ActionType extends SocketAPIAction<any, any, any>> = ActionType extends SocketAPIAction<infer Name, infer Request, infer Response> ? UseAction<Name, Request, Response>[Name] : never;

function buildRestCall(
  name: string,
  action: SocketAPIAction<string, unknown, unknown>,
  request: unknown,
): { url: string; method: string; body?: string; headers: Record<string, string> } {
  const req = (request ?? {}) as Record<string, unknown>;

  if (!action.rest) {
    return {
      url: `/${name}/actions/${action.name}`,
      method: 'POST',
      body: JSON.stringify(req),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const { method, url: urlTemplate } = action.rest;
  const paramNames = [...urlTemplate.matchAll(/:(\w+)/g)].map(m => m[1]);
  let url = urlTemplate;
  const remaining: Record<string, unknown> = { ...req };
  for (const paramName of paramNames) {
    url = url.replace(`:${paramName}`, encodeURIComponent(String(remaining[paramName] ?? '')));
    delete remaining[paramName];
  }

  if (method === 'GET' || method === 'DELETE') {
    const qs = new URLSearchParams(
      Object.entries(remaining)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return { url: qs ? `${url}?${qs}` : url, method, headers: {} };
  }

  return {
    url,
    method,
    body: JSON.stringify(remaining),
    headers: { 'Content-Type': 'application/json' },
  };
}

async function callRest<Response>(
  name: string,
  action: SocketAPIAction<string, unknown, Response>,
  request: unknown,
): Promise<Response> {
  const { url, method, body, headers } = buildRestCall(name, action, request);
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    ...(body != null ? { body } : {}),
  });
  const data = await res.json() as unknown;
  if (res.status === 401) throw new Error('Unauthorized');
  if (!res.ok || (data != null && typeof data === 'object' && 'error' in data)) {
    const msg = (data as any)?.error?.message ?? `REST action failed: ${res.status}`;
    throw new globalThis.Error(msg);
  }
  return data as Response;
}

export function useAction<Name extends string, Request, Response>(action: SocketAPIAction<Name, Request, Response>): UseAction<Name, Request, Response> {
  const { getIsConnected, emit, onConnected } = useSocket();
  const { name } = useContext(SocketContext);

  return {
    [action.name]: async (request: Request, response?: (response: Response) => void) => {
      if (typeof response === 'function') {
        if (getIsConnected()) {
          emit<Response, Request>(`${actionPrefix}.${action.name}`, request).then(res => response(throwIfAckError(res)));
        } else {
          callRest<Response>(name, action, request).then(response);
        }
      } else {
        if (getIsConnected()) {
          return emit<Response, Request>(`${actionPrefix}.${action.name}`, request).then(throwIfAckError);
        } else {
          return callRest<Response>(name, action, request);
        }
      }
    },
    [`use${action.name.toPascalCase()}`]: (request: Request) => {
      const [state, setState] = useState<{ response: Response | undefined; error: Error | undefined; isLoading: boolean; }>({ response: undefined, error: undefined, isLoading: true });
      const isMonitoringErrorRef = useRef(false);
      const requestKey = JSON.stringify(request);

      useLayoutEffect(() => {
        setState({ response: undefined, error: undefined, isLoading: true });
        const doEmit = async () => {
          try {
            let response: Response | undefined;
            let error: Error | undefined;
            if (getIsConnected()) {
              const result = getErrorFromAckResponse(await emit<Response, Request>(`${actionPrefix}.${action.name}`, request));
              response = result.response;
              error = result.error;
            } else {
              response = await callRest<Response>(name, action, request);
            }
            setState({ response, error, isLoading: false });
          } catch (err) {
            if (isMonitoringErrorRef.current) {
              setState({ response: undefined, error: new Error({ error: err }), isLoading: false });
            } else {
              throw err;
            }
          }
        };
        doEmit();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [requestKey]);

      return {
        ...state,
        get error() {
          isMonitoringErrorRef.current = true;
          return state.error;
        },
      };
    },
    isConnected: getIsConnected,
  } as UseAction<Name, Request, Response>;
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm --dir C:/code/personal/socket-api tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Run the full test suite**

Run: `pnpm --dir C:/code/personal/socket-api test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/hooks/useAction.ts
git -C C:/code/personal/socket-api commit -m "feat(actions): add REST fallback to client useAction when socket not connected"
```

---

## Task 8: E2E integration tests

**Files:**
- Create: `tests/e2e/rest-actions.tests.ts`

Tests spin up a real `startServer`, make HTTP requests directly (no socket), and verify correct responses, auth enforcement, error handling, and explicit route behaviour.

- [ ] **Step 1: Create `tests/e2e/rest-actions.tests.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { createServerActionHandler } from '../../src/server/actions';
import { defineAction } from '../../src/common/defineAction';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord } from '../../src/common/auth';
import { clearRestActionRegistry } from '../../src/server/actions/restActionRegistry';

interface TestUser { id: string; email: string; }
interface TestCreds { email: string; password: string; }

// Auth store
const records: Map<string, JwtAuthRecord> = new Map();
const store: JwtAuthStore = {
  async create(r) { records.set(r.requestId, { ...r }); },
  async findById(id) { return records.get(id); },
  async findBySessionToken(t) { return [...records.values()].find(r => r.sessionToken === t); },
  async findByDevice(userId, deviceId) { return [...records.values()].find(r => r.userId === userId && r.deviceId === deviceId); },
  async update(id, patch) { const r = records.get(id); if (r) records.set(id, { ...r, ...patch }); },
};
const users: Record<string, TestUser> = { 'test@test.com': { id: 'user-1', email: 'test@test.com' } };
const { configureAuthentication } = defineAuthentication<TestUser, TestCreds>();

// Actions
const echoAction = defineAction<{ message: string }, { echo: string }>()('echo', { isPublic: true });
const secretAction = defineAction<{ value: number }, { doubled: number }>()('secret');
const getUserAction = defineAction<{ id: string }, TestUser>()('getUser', {
  isPublic: true,
  rest: { method: 'GET', url: '/users/:id' },
});
const createItemAction = defineAction<{ name: string; count: number }, { created: boolean }>()('createItem', {
  isPublic: true,
  rest: { method: 'POST', url: '/items' },
});

describe('REST actions integration', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => records.clear());

  beforeAll(async () => {
    clearRestActionRegistry();
    const actions = [
      createServerActionHandler(echoAction, async ({ message }) => ({ echo: message })),
      createServerActionHandler(secretAction, async ({ value }) => ({ doubled: value * 2 })),
      createServerActionHandler(getUserAction, async ({ id }) => ({ id, email: `${id}@test.com` })),
      createServerActionHandler(createItemAction, async ({ name, count }) => ({ created: true })),
    ];

    server = http.createServer();
    await startServer({
      name: 'rest-test',
      logger: new Logger('rest-test'),
      server,
      auth: configureAuthentication({
        mode: 'jwt',
        store,
        onAuthenticate: async ({ email, password }) => password === 'correct' ? users[email] : undefined,
        onGetUser: async (userId) => Object.values(users).find(u => u.id === userId),
      }),
      actions,
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  }, 15_000);

  afterAll(() => server?.close());

  // --- Catch-all ---

  it('catch-all: returns 200 and response for public action', async () => {
    const res = await fetch(`http://localhost:${port}/rest-test/actions/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ echo: 'hello' });
  });

  it('catch-all: returns 401 for non-public action without session', async () => {
    const res = await fetch(`http://localhost:${port}/rest-test/actions/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it('catch-all: returns 200 for non-public action with valid session', async () => {
    // Sign in first
    const signinRes = await fetch(`http://localhost:${port}/rest-test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'correct', deviceId: 'dev-rest', deviceDetails: {} }),
    });
    expect(signinRes.status).toBe(200);
    const rawCookie = signinRes.headers.get('set-cookie') ?? '';
    const token = rawCookie.match(/socketapi_session=([^;]+)/)?.[1] ?? '';
    expect(token).toBeTruthy();

    const res = await fetch(`http://localhost:${port}/rest-test/actions/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `socketapi_session=${token}` },
      body: JSON.stringify({ value: 7 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ doubled: 14 });
  });

  it('catch-all: returns 404 for unknown action', async () => {
    const res = await fetch(`http://localhost:${port}/rest-test/actions/noSuchAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('catch-all: returns 400 when handler throws', async () => {
    clearRestActionRegistry();
    const failAction = defineAction<void, void>()('failAction', { isPublic: true });
    createServerActionHandler(failAction, async () => { throw new globalThis.Error('boom'); });

    const res = await fetch(`http://localhost:${port}/rest-test/actions/failAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toBe('boom');
  });

  // --- Explicit routes ---

  it('explicit GET route: extracts path param and query params into request', async () => {
    const res = await fetch(`http://localhost:${port}/users/user-42`, { method: 'GET' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ id: 'user-42', email: 'user-42@test.com' });
  });

  it('explicit POST route: merges body and path params into request', async () => {
    const res = await fetch(`http://localhost:${port}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'widget', count: 3 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ created: true });
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm --dir C:/code/personal/socket-api test:e2e tests/e2e/rest-actions.tests.ts`
Expected: all tests pass. If any fail, diagnose:
- 404 on catch-all: check `registerRestActions` is called in `startServer`; check registry is populated before the route is hit
- 401 unexpectedly: check `validateRestSession` parses the cookie header correctly
- Explicit route 404: check the route URL matches exactly (no `/{name}` prefix for explicit routes — they use the raw `url` from `rest` config)

- [ ] **Step 3: Run full test suite**

Run: `pnpm --dir C:/code/personal/socket-api test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add tests/e2e/rest-actions.tests.ts
git -C C:/code/personal/socket-api commit -m "test(actions): add e2e tests for REST action catch-all and explicit routes"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ `RestActionOptions` with `method` + `url` on `defineAction`
- ✅ Slash validation
- ✅ Auto catch-all `POST /{name}/actions/:actionName`
- ✅ Explicit route registration
- ✅ Path params merged with query (GET) / body (POST/PUT/PATCH/DELETE)
- ✅ Auth check (session cookie, `isPublic` respected)
- ✅ Async context via `ConnectionRegistry`
- ✅ Concurrency/queue limit gate shared across transports
- ✅ Error envelope: 400 + `{ error: { message } }` for handler errors, 401 for auth, 404 for unknown
- ✅ Client fallback: socket preferred, REST when `!getIsConnected()`
- ✅ Reactive hook also falls back immediately rather than waiting for socket

**Known limitation documented in spec:** Handlers that call `useSocketAPI().getClient()` or `useEvent()` inside a REST call will get `undefined` / throw — those operations require an active socket connection.
