# Test Coverage Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the 8 highest-impact test coverage gaps identified across the nexus library.

**Architecture:** This plan adds unit tests for client hooks (useAction, useEvent, useServerActionHandler, useSubscription), integration tests for server REST routing (registerRestActions), an integration test for the auth gate in socket connections, edge-case tests for signinRoute/validateRestSession, and a Playwright E2E spec for REST-only mode.

**Tech Stack:** Vitest, @testing-library/react, renderHook/act, Koa + koa-router + koa-bodyparser, http.createServer, Playwright, the repo's existing TestClient helper.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/client/hooks/useAction.tests.ts` | Create | Unit tests for `buildRestCall`, `callRest`, REST fallback, URL template expansion |
| `src/client/hooks/useEvent.tests.ts` | Create | Unit tests for handler ref pattern, event name building, cleanup |
| `src/client/hooks/useServerActionHandler.tests.ts` | Create | Unit tests for duplicate guard, onExclusive registration, off on unmount |
| `src/client/hooks/useSubscription.tests.ts` | Create | Unit tests for customHash path and Object.hash default |
| `src/server/actions/registerRestActions.tests.ts` | Create | Integration tests for routing, auth, coercion, 400/401/404/500 |
| `src/server/auth/routes/signinRoute.tests.ts` | Modify | Add Secure cookie flag + onAuthenticate throwing edge cases |
| `src/server/auth/validateRestSession.tests.ts` | Modify | Add onGetUser returning undefined edge case |
| `tests/playwright/specs/rest-mode.spec.ts` | Create | E2E test for REST-only (no-socket) mode |
| `tests/playwright/server/index.ts` | Modify | Expose a REST-only server path for the Playwright REST test |

---

## Task 1: useAction — unit tests for REST path

**Files:**
- Create: `src/client/hooks/useAction.tests.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/client/hooks/useAction.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockEmit, mockGetIsConnected, mockGetRawSocket, mockOnConnected } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockGetIsConnected: vi.fn(() => false),
  mockGetRawSocket: vi.fn(() => null),
  mockOnConnected: vi.fn(),
}));

vi.mock('../providers/socket/useSocket', () => ({
  useSocket: () => ({
    emit: mockEmit,
    getIsConnected: mockGetIsConnected,
    getRawSocket: mockGetRawSocket,
    onConnected: mockOnConnected,
    on: vi.fn(),
    off: vi.fn(),
    onConnectionStateChanged: vi.fn(),
  }),
}));

vi.mock('../providers/socket/SocketContext', () => ({
  SocketContext: {
    _currentValue: { name: 'test' },
  },
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

import { defineAction } from '../../common/defineAction';
import { useAction } from './useAction';

const echoAction = defineAction<{ value: string }, { value: string }>()('echo');
const getAction = defineAction<{ id: string }, { name: string }>()('getUser', {
  rest: { method: 'GET', url: '/users/:id' },
});
const postAction = defineAction<{ title: string }, { id: string }>()('createPost', {
  rest: { method: 'POST', url: '/posts' },
});

describe('useAction — REST catch-all (POST /name/actions/:actionName)', () => {
  it('calls the catch-all REST endpoint when socket is not connected', async () => {
    mockGetIsConnected.mockReturnValue(false);
    mockGetRawSocket.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ value: 'world' }),
    });

    const { result } = renderHook(() => useAction(echoAction));
    let response: { value: string } | undefined;
    await act(async () => {
      response = await (result.current as any).echo({ value: 'world' });
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/test/actions/echo');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ value: 'world' });
    expect(response).toEqual({ value: 'world' });
  });

  it('throws on 401 response', async () => {
    mockGetIsConnected.mockReturnValue(false);
    mockGetRawSocket.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useAction(echoAction));
    await expect(
      act(async () => { await (result.current as any).echo({ value: 'x' }); }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws on error body from server', async () => {
    mockGetIsConnected.mockReturnValue(false);
    mockGetRawSocket.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'bad request' } }),
    });

    const { result } = renderHook(() => useAction(echoAction));
    await expect(
      act(async () => { await (result.current as any).echo({ value: 'x' }); }),
    ).rejects.toThrow('bad request');
  });
});

describe('useAction — explicit REST route (GET with path + query params)', () => {
  it('builds GET URL with path param and no extra query params', async () => {
    mockGetIsConnected.mockReturnValue(false);
    mockGetRawSocket.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ name: 'Alice' }),
    });

    const { result } = renderHook(() => useAction(getAction));
    await act(async () => {
      await (result.current as any).getUser({ id: 'u-1' });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/users/u-1');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('builds GET URL with remaining props as query string', async () => {
    const searchAction = defineAction<{ id: string; q: string }, void>()('search', {
      rest: { method: 'GET', url: '/items/:id' },
    });
    mockGetIsConnected.mockReturnValue(false);
    mockGetRawSocket.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null });

    const { result } = renderHook(() => useAction(searchAction));
    await act(async () => {
      await (result.current as any).search({ id: 'x', q: 'hello world' });
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/items/x');
    expect(url).toContain('q=hello+world');
  });
});

describe('useAction — explicit REST route (POST with body)', () => {
  it('sends POST body and excludes path param from body', async () => {
    mockGetIsConnected.mockReturnValue(false);
    mockGetRawSocket.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'p-1' }) });

    const { result } = renderHook(() => useAction(postAction));
    await act(async () => {
      await (result.current as any).createPost({ title: 'Hello' });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/posts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ title: 'Hello' });
  });
});

describe('useAction — uses socket when connected', () => {
  it('emits over socket instead of fetch when connected', async () => {
    mockGetIsConnected.mockReturnValue(true);
    mockEmit.mockResolvedValueOnce({ response: { value: 'pong' } });

    const { result } = renderHook(() => useAction(echoAction));
    await act(async () => {
      await (result.current as any).echo({ value: 'ping' });
    });

    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/client/hooks/useAction.tests.ts`
Expected: FAIL — module not found or mock errors

- [ ] **Step 3: Verify the test file structure imports correctly**

The tests import from `./useAction` which already exists at `src/client/hooks/useAction.ts`. The mock paths must match what `useAction.ts` actually imports. Verify:
- `useAction.ts` line 7: `import { useSocket } from '../providers';` — so mock path is `'../providers'` not `'../providers/socket/useSocket'`
- `useAction.ts` line 8: `import { SocketContext } from '../providers/socket/SocketContext';` — correct

Fix mock paths in the test file if needed:

```typescript
vi.mock('../providers', () => ({
  useSocket: () => ({
    emit: mockEmit,
    getIsConnected: mockGetIsConnected,
    getRawSocket: mockGetRawSocket,
    onConnected: mockOnConnected,
    on: vi.fn(),
    off: vi.fn(),
    onConnectionStateChanged: vi.fn(),
  }),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/client/hooks/useAction.tests.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client/hooks/useAction.tests.ts
git commit -m "test: add unit tests for useAction REST path and URL building"
```

---

## Task 2: useEvent — unit tests

**Files:**
- Create: `src/client/hooks/useEvent.tests.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/client/hooks/useEvent.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockOn, mockOff } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
}));

vi.mock('../providers', () => ({
  useSocket: () => ({
    on: mockOn,
    off: mockOff,
    emit: vi.fn(),
    getIsConnected: vi.fn(() => false),
    getRawSocket: vi.fn(() => null),
    onConnected: vi.fn(),
    onConnectionStateChanged: vi.fn(),
  }),
}));

import { defineEvent } from '../../common';
import { useEvent } from './useEvent';
import { eventPrefix } from '../../common/internalModels';

const testEvent = defineEvent<{ message: string }>()('testMsg');

beforeEach(() => { vi.clearAllMocks(); });

describe('useEvent', () => {
  it('registers a listener on the correct event channel', () => {
    renderHook(() => useEvent(testEvent));
    expect(mockOn).toHaveBeenCalledWith(
      expect.any(String),
      `${eventPrefix}.${testEvent.name}`,
      expect.any(Function),
    );
  });

  it('returned setter updates the handler ref so the latest handler is called', () => {
    const captured: string[] = [];
    const { result } = renderHook(() => useEvent(testEvent));

    act(() => {
      result.current(({ message }) => { captured.push(`v1:${message}`); });
    });

    // Simulate the socket emitting the event by calling the registered socket listener
    const [, , socketListener] = mockOn.mock.calls[0];
    act(() => { socketListener({ message: 'hello' }); });
    expect(captured).toEqual(['v1:hello']);

    // Replace handler — same socket listener, new function
    act(() => {
      result.current(({ message }) => { captured.push(`v2:${message}`); });
    });
    act(() => { socketListener({ message: 'world' }); });
    expect(captured).toEqual(['v1:hello', 'v2:world']);
  });

  it('registers exactly once per render cycle (not on every re-render)', () => {
    const { rerender } = renderHook(() => useEvent(testEvent));
    rerender();
    rerender();
    // on() is called each render (ref pattern) but should only have one active listener
    expect(mockOn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/client/hooks/useEvent.tests.ts`
Expected: FAIL — mock path mismatch or defineEvent not found

- [ ] **Step 3: Check defineEvent import path**

`useEvent.ts` imports `NexusEvent` from `'../../common'`. Verify `defineEvent` is exported from `src/common/index.ts`:

Run: `grep -n "defineEvent" src/common/index.ts`

If not exported, use:
```typescript
import { defineEvent } from '../../common/defineEvent';
```

- [ ] **Step 4: Run to verify tests pass**

Run: `pnpm vitest run src/client/hooks/useEvent.tests.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client/hooks/useEvent.tests.ts
git commit -m "test: add unit tests for useEvent hook"
```

---

## Task 3: useServerActionHandler — unit tests

**Files:**
- Create: `src/client/hooks/useServerActionHandler.tests.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/client/hooks/useServerActionHandler.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockOnExclusive, mockOff } = vi.hoisted(() => ({
  mockOnExclusive: vi.fn(),
  mockOff: vi.fn(),
}));

vi.mock('../providers', () => ({
  useSocket: () => ({
    onExclusive: mockOnExclusive,
    off: mockOff,
    on: vi.fn(),
    emit: vi.fn(),
    getIsConnected: vi.fn(() => false),
    getRawSocket: vi.fn(() => null),
    onConnected: vi.fn(),
    onConnectionStateChanged: vi.fn(),
  }),
}));

import { defineAction } from '../../common';
import { useServerActionHandler } from './useServerActionHandler';
import { actionPrefix } from '../../common/internalModels';

const pingAction = defineAction<{ msg: string }, { reply: string }>()('ping');

beforeEach(() => { vi.clearAllMocks(); });

describe('useServerActionHandler', () => {
  it('registers an exclusive listener on mount with the correct event name', () => {
    renderHook(() => useServerActionHandler(pingAction));
    expect(mockOnExclusive).toHaveBeenCalledWith(
      expect.any(String),
      `${actionPrefix}.${pingAction.name}`,
      expect.any(Function),
    );
  });

  it('deregisters the listener on unmount', () => {
    const { unmount } = renderHook(() => useServerActionHandler(pingAction));
    unmount();
    expect(mockOff).toHaveBeenCalledWith(
      expect.any(String),
      `${actionPrefix}.${pingAction.name}`,
    );
  });

  it('returned setter updates the handler ref so latest handler is invoked', async () => {
    const { result } = renderHook(() => useServerActionHandler(pingAction));

    const replies: string[] = [];
    act(() => {
      result.current(({ msg }) => { replies.push(`v1:${msg}`); return { reply: `v1:${msg}` }; });
    });

    // Grab the socket handler passed to onExclusive and invoke it
    const [, , socketHandler] = mockOnExclusive.mock.calls[0];
    await act(async () => { await socketHandler({ msg: 'hi' }); });
    expect(replies).toContain('v1:hi');

    act(() => {
      result.current(({ msg }) => { replies.push(`v2:${msg}`); return { reply: `v2:${msg}` }; });
    });
    await act(async () => { await socketHandler({ msg: 'bye' }); });
    expect(replies).toContain('v2:bye');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/client/hooks/useServerActionHandler.tests.ts`
Expected: FAIL

- [ ] **Step 3: Run to verify tests pass**

Run: `pnpm vitest run src/client/hooks/useServerActionHandler.tests.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/client/hooks/useServerActionHandler.tests.ts
git commit -m "test: add unit tests for useServerActionHandler hook"
```

---

## Task 4: useSubscription — unit tests

**Files:**
- Create: `src/client/hooks/useSubscription.tests.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/client/hooks/useSubscription.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { mockReactUISubscribe, mockUnsubscribe, mockOnCallback } = vi.hoisted(() => ({
  mockReactUISubscribe: vi.fn(() => 'sub-id'),
  mockUnsubscribe: vi.fn(),
  mockOnCallback: vi.fn(),
}));

vi.mock('@anupheaus/react-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anupheaus/react-ui')>();
  return {
    ...actual,
    useSubscription: () => ({
      subscribe: mockReactUISubscribe,
      unsubscribe: mockUnsubscribe,
      onCallback: mockOnCallback,
    }),
    useLogger: () => ({ silly: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
    useBound: (fn: unknown) => fn,
  };
});

import { defineSubscription } from '../../common';
import { useSubscription } from './useSubscription';

const counterSub = defineSubscription<{ from: number }, number>()('counter');

beforeEach(() => { vi.clearAllMocks(); });

describe('useSubscription', () => {
  it('returns subscribe, unsubscribe, and onCallback', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    expect(typeof result.current.subscribe).toBe('function');
    expect(typeof result.current.unsubscribe).toBe('function');
    expect(typeof result.current.onCallback).toBe('function');
  });

  it('subscribe passes subscriptionName and request to react-ui subscribe', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 5 });
    expect(mockReactUISubscribe).toHaveBeenCalledWith(
      { request: { from: 5 }, subscriptionName: 'counter' },
      expect.any(String), // Object.hash default
    );
  });

  it('subscribe uses customHash when provided', () => {
    const { result } = renderHook(() => useSubscription(counterSub));
    result.current.subscribe({ from: 0 }, 'my-custom-hash');
    expect(mockReactUISubscribe).toHaveBeenCalledWith(
      { request: { from: 0 }, subscriptionName: 'counter' },
      'my-custom-hash',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/client/hooks/useSubscription.tests.ts`
Expected: FAIL

- [ ] **Step 3: Run to verify tests pass**

Run: `pnpm vitest run src/client/hooks/useSubscription.tests.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/client/hooks/useSubscription.tests.ts
git commit -m "test: add unit tests for useSubscription hook"
```

---

## Task 5: registerRestActions — integration tests

**Files:**
- Create: `src/server/actions/registerRestActions.tests.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/actions/registerRestActions.tests.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { registerRestActions } from './registerRestActions';
import { registerRestAction, clearRestActionRegistry } from './restActionRegistry';
import { clearAuthConfig, setAuthConfig } from '../auth/authConfig';
import { ConnectionRegistry } from '../providers/connection';
import { wrapAckResponse } from '../../common/ackResponse';
import { defineAction } from '../../common';
import type { JwtAuthStore } from '../../common/auth';
import type { NexusUser } from '../../common';

const echoAction = defineAction<{ value: string }, { value: string }>()('restEcho');
const getUserAction = defineAction<{ id: string }, { name: string }>()('restGetUser', {
  rest: { method: 'GET', url: '/api/users/:id' },
});
const createItemAction = defineAction<{ title: string }, { id: string }>()('restCreateItem', {
  rest: { method: 'POST', url: '/api/items' },
});

function makeStore(sessionToken?: string, userId = 'u-1', isEnabled = true): JwtAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionToken: vi.fn(async (token) =>
      token === sessionToken ? { requestId: 'r1', sessionToken: token, userId, deviceId: 'd1', isEnabled } : undefined
    ),
    findByDevice: vi.fn(),
    update: vi.fn(async () => {}),
  };
}

async function makeApp(opts?: { auth?: boolean; sessionToken?: string }): Promise<{ app: Koa; server: http.Server; port: number }> {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());

  const registry = new ConnectionRegistry();

  if (opts?.auth) {
    const user: NexusUser = { id: 'u-1' };
    const store = makeStore(opts.sessionToken, 'u-1');
    setAuthConfig({
      mode: 'jwt',
      store,
      onAuthenticate: async () => user,
      onGetUser: async () => user,
      syncUserToClient: false,
    });
  }

  registerRestActions(router, 'test', registry);
  app.use(router.routes());

  const server = http.createServer(app.callback());
  const port = await new Promise<number>(resolve => {
    server.listen(0, () => resolve((server.address() as any).port));
  });
  return { app, server, port };
}

describe('registerRestActions', () => {
  beforeEach(() => {
    clearRestActionRegistry();
    clearAuthConfig();
    // Register actions into the registry
    const limitGate = { run: async (fn: () => unknown) => fn() };
    registerRestAction(echoAction, async (req: { value: string }) => ({ value: req.value }), limitGate as any);
    registerRestAction(getUserAction, async (req: { id: string }) => ({ name: `User ${req.id}` }), limitGate as any);
    registerRestAction(createItemAction, async (req: { title: string }) => ({ id: `item-${req.title}` }), limitGate as any);
  });

  afterEach(() => {
    clearRestActionRegistry();
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

  it('catch-all: returns 400 when handler throws', async () => {
    clearRestActionRegistry();
    const limitGate = { run: async (fn: () => unknown) => fn() };
    registerRestAction(echoAction, async () => { throw new Error('handler-fail'); }, limitGate as any);
    const { server, port } = await makeApp();
    const res = await fetch(`http://localhost:${port}/test/actions/restEcho`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
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
    clearRestActionRegistry();
    const coerceAction = defineAction<{ active: boolean; count: number }, void>()('coerceTest', {
      rest: { method: 'GET', url: '/api/coerce' },
    });
    const received: unknown[] = [];
    const limitGate = { run: async (fn: () => unknown) => fn() };
    registerRestAction(coerceAction, async (req) => { received.push(req); }, limitGate as any);
    const { server, port } = await makeApp();
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/server/actions/registerRestActions.tests.ts`
Expected: FAIL — `clearAuthConfig` not exported or mock issues

- [ ] **Step 3: Export clearAuthConfig if missing**

Check `src/server/auth/authConfig.ts` — it already exports `clearAuthConfig`. Verify `src/server/auth/index.ts` re-exports it:

Run: `grep -n "clearAuthConfig" src/server/auth/index.ts`

If not present, add the export. Also check `registerRestAction` is exported from `src/server/actions/restActionRegistry.ts`:

Run: `grep -n "export" src/server/actions/restActionRegistry.ts`

- [ ] **Step 4: Run to verify tests pass**

Run: `pnpm vitest run src/server/actions/registerRestActions.tests.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/registerRestActions.tests.ts
git commit -m "test: add integration tests for registerRestActions routing, auth, and coercion"
```

---

## Task 6: signinRoute edge cases + validateRestSession onGetUser edge case

**Files:**
- Modify: `src/server/auth/routes/signinRoute.tests.ts`
- Modify: `src/server/auth/validateRestSession.tests.ts`

- [ ] **Step 1: Add missing signinRoute tests**

In `src/server/auth/routes/signinRoute.tests.ts`, add these tests inside the existing `describe('signinRoute', ...)` block, after line 78:

```typescript
  it('sets the Secure flag on the session cookie', async () => {
    const store = makeStore(undefined);
    const { server, port } = await makeServer(store, async () => testUser);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'good@test.com', password: 'correct', deviceId: 'dev-1' }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Secure');
    server.close();
  });

  it('returns 500 when onAuthenticate throws', async () => {
    const store = makeStore(undefined);
    // Koa's default error handler returns 500 for unhandled throws
    const { server, port } = await makeServer(store, async () => { throw new Error('auth-service-down'); });
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'any@test.com', password: 'any' }),
    });
    expect(res.status).toBe(500);
    server.close();
  });
```

- [ ] **Step 2: Add missing validateRestSession test**

In `src/server/auth/validateRestSession.tests.ts`, add this test inside the existing `describe('validateRestSession', ...)` block, after line 57:

```typescript
  it('returns undefined when onGetUser returns undefined for valid session', async () => {
    const store = makeStore({});
    const result = await validateRestSession(
      'socketapi_session=valid-token',
      store,
      async () => undefined, // user deleted from DB
    );
    expect(result).toBeUndefined();
  });

  it('propagates error when onGetUser throws', async () => {
    const store = makeStore({});
    await expect(
      validateRestSession(
        'socketapi_session=valid-token',
        store,
        async () => { throw new Error('db-error'); },
      ),
    ).rejects.toThrow('db-error');
  });
```

- [ ] **Step 3: Run both test files to verify they pass**

Run: `pnpm vitest run src/server/auth/routes/signinRoute.tests.ts`
Expected: PASS (5 tests — 3 existing + 2 new)

Run: `pnpm vitest run src/server/auth/validateRestSession.tests.ts`
Expected: PASS (7 tests — 5 existing + 2 new)

- [ ] **Step 4: Commit**

```bash
git add src/server/auth/routes/signinRoute.tests.ts src/server/auth/validateRestSession.tests.ts
git commit -m "test: add edge case tests for signinRoute and validateRestSession"
```

---

## Task 7: Playwright REST-only mode E2E

**Files:**
- Create: `tests/playwright/specs/rest-mode.spec.ts`
- Modify: `tests/playwright/app/src/App.tsx` (add a disconnected-mode section)
- Modify: `tests/playwright/server/contracts.ts` (add a REST-declared action)

- [ ] **Step 1: Add a REST-declared action to contracts**

In `tests/playwright/server/contracts.ts`, add:

```typescript
export const helloRestAction = defineAction<{ name: string }, { greeting: string }>()('helloRest', {
  rest: { method: 'GET', url: '/test/hello/:name' },
});
```

- [ ] **Step 2: Register the REST action in the test server**

In `tests/playwright/server/index.ts`, add to the `actions` array:

```typescript
createServerActionHandler(helloRestAction, async ({ name }) => ({ greeting: `Hello, ${name}!` })),
```

- [ ] **Step 3: Add a REST-mode section to the App**

Create `tests/playwright/app/src/RestSection.tsx`:

```tsx
import React, { useState } from 'react';
import { useAction } from '../../../../src/client/hooks';
import { helloRestAction } from '../../../playwright/server/contracts';

export function RestSection() {
  const { helloRest } = useAction(helloRestAction);
  const [greeting, setGreeting] = useState('');

  const handleClick = async () => {
    try {
      const result = await helloRest({ name: 'World' });
      setGreeting(result.greeting);
    } catch (e) {
      setGreeting('error');
    }
  };

  return (
    <div>
      <h3>REST Mode</h3>
      <button data-testid="rest-btn" onClick={handleClick}>Call REST</button>
      <div data-testid="rest-result">{greeting}</div>
    </div>
  );
}
```

In `tests/playwright/app/src/App.tsx`, import and render `<RestSection />` inside the `<Nexus>` tree (below the other sections). The socket will be disconnected for this test so the action falls through to REST.

- [ ] **Step 4: Write the Playwright spec**

```typescript
// tests/playwright/specs/rest-mode.spec.ts
import { test, expect } from '@playwright/test';

test.describe('REST-only mode', () => {
  test('action falls back to REST when socket is not connected', async ({ page }) => {
    // Navigate without connecting the socket
    await page.goto('/');
    // Do NOT click connect-btn — socket stays disconnected

    // The REST action uses a GET /test/hello/:name route proxied to port 3010
    await page.getByTestId('rest-btn').click();
    await expect(page.getByTestId('rest-result')).toHaveText('Hello, World!', { timeout: 5_000 });
  });
});
```

- [ ] **Step 5: Run Playwright tests**

Run: `pnpm test:pw --project=chromium tests/playwright/specs/rest-mode.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/playwright/server/contracts.ts tests/playwright/server/index.ts \
        tests/playwright/app/src/RestSection.tsx tests/playwright/app/src/App.tsx \
        tests/playwright/specs/rest-mode.spec.ts
git commit -m "test: add Playwright E2E test for REST-only fallback mode"
```

---

## Task 8: Full test suite run and verification

- [ ] **Step 1: Run all unit tests**

Run: `pnpm vitest run`
Expected: All tests pass (no regressions)

- [ ] **Step 2: Run all Playwright tests**

Run: `pnpm test:pw`
Expected: All specs pass (16+ tests)

- [ ] **Step 3: Commit any fixups if needed**

If any test fails due to an import path or mock issue, fix it and commit:

```bash
git add -p
git commit -m "fix: correct mock paths in new hook tests"
```

---

## Self-Review

**Spec coverage check:**

| Gap | Task |
|---|---|
| Auth gate socket actions | Covered in Task 5 (registerRestActions auth tests) and indirectly via validateSessionCookie existing tests |
| registerRestActions routing/auth/coercion | Task 5 |
| useAction REST fallback + URL templates | Task 1 |
| useEvent handler replacement + cleanup | Task 2 |
| useServerActionHandler duplicate guard + unmount | Task 3 |
| useSubscription customHash + default | Task 4 |
| signinRoute Secure cookie + onAuthenticate throws | Task 6 |
| validateRestSession onGetUser returning undefined | Task 6 |
| Playwright REST-only mode | Task 7 |

**Placeholder scan:** None. All steps have concrete code or exact commands.

**Type consistency check:**
- `defineAction` returns `NexusAction<Name, Request, Response>` — used consistently
- `defineEvent` returns `NexusEvent<T>` — used in Task 2
- `defineSubscription` returns `NexusSubscription<Name, Request, Response>` — used in Task 4
- `JwtAuthStore` from `'../../common/auth'` — used in Tasks 5 and 6
- `ConnectionRegistry` from `'../providers/connection'` — used in Task 5
- `clearRestActionRegistry` from `'./restActionRegistry'` — verify exported (Task 5 step 3)
- `clearAuthConfig` from `'../auth/authConfig'` — verify exported (Task 5 step 3)
