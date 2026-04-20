# Unauthenticated WebSocket Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow WebSocket connections without a session cookie; defer auth enforcement to per-handler level so `isPublic` actions work for unauthenticated sockets.

**Architecture:** Remove the connection-blocking middleware in `startServer.ts` — instead, attempt cookie validation optimistically (set user if valid, allow connection either way) unless the device is explicitly disabled. Per-handler auth check in `createServerHandler.ts` already enforces auth for non-public handlers; no change needed there.

**Tech Stack:** TypeScript, Socket.IO, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/server/auth/validateSessionCookie.ts` | Remove `socket.disconnect()` for missing/invalid token; keep disconnect only for device-disabled |
| `src/server/startServer.ts` | Always call `next()` after attempting cookie validation; never reject the connection |
| `src/server/auth/validateSessionCookie.tests.ts` | Update tests to match new no-disconnect behaviour for missing/invalid tokens |
| `tests/e2e/auth.tests.ts` | Add WebSocket e2e tests: connect without cookie, call public action, call private action → Unauthorized |

---

### Task 1: Update `validateSessionCookie` — no disconnect for missing/invalid token

**Files:**
- Modify: `src/server/auth/validateSessionCookie.ts`

The only cases that still disconnect are: **device disabled** (an explicit administrative action).  
Missing token, unknown token, and unknown user all return `false` silently — the connection remains open but unauthenticated.

- [ ] **Step 1: Write the failing tests**

Replace the three "disconnects" tests for non-device-disabled cases in `src/server/auth/validateSessionCookie.tests.ts`:

```ts
it('does NOT disconnect and returns false when no cookie header is present', async () => {
  const socket = makeSocket(undefined);
  const result = await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
  expect(result).toBe(false);
  expect(socket.disconnect).not.toHaveBeenCalled();
  expect(socket.emit).not.toHaveBeenCalled();
});

it('does NOT disconnect and returns false when sessionToken not found in store', async () => {
  const socket = makeSocket('socketapi_session=abc123');
  const result = await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
  expect(result).toBe(false);
  expect(socket.disconnect).not.toHaveBeenCalled();
  expect(socket.emit).not.toHaveBeenCalled();
});

it('does NOT disconnect and returns false when onGetUser returns undefined', async () => {
  const record: SocketAPIAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
  const socket = makeSocket('socketapi_session=abc123');
  const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => undefined), vi.fn(async () => {}));
  expect(result).toBe(false);
  expect(socket.disconnect).not.toHaveBeenCalled();
});
```

These replace (by name) the existing tests:
- `'disconnects socket when no cookie header is present'`
- `'disconnects socket when sessionToken not found in store'`
- `'disconnects when onGetUser returns undefined'`

Also update the `'does NOT emit socketAPIDeviceDisabled for missing-token disconnects'` and `'does NOT emit socketAPIDeviceDisabled for missing-record disconnects'` tests to drop the disconnect assertion (they're about `emit`, not `disconnect`):

```ts
it('does NOT emit socketAPIDeviceDisabled for missing-token case', async () => {
  const socket = makeSocket(undefined);
  await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
  expect(socket.emit).not.toHaveBeenCalled();
});

it('does NOT emit socketAPIDeviceDisabled for missing-record case', async () => {
  const socket = makeSocket('socketapi_session=abc123');
  await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
  expect(socket.emit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
npx vitest run src/server/auth/validateSessionCookie.tests.ts
```

Expected: 3 failures (the three updated tests), others pass.

- [ ] **Step 3: Update `validateSessionCookie.ts` — remove non-device-disabled disconnects**

Change `src/server/auth/validateSessionCookie.ts` so that missing token, unknown record, and unknown user return `false` without calling `socket.disconnect()`. Device-disabled still disconnects.

```ts
import type { Socket } from 'socket.io';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';
import { socketAPIDeviceDisabled } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';

const COOKIE_NAME = 'socketapi_session';

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

export async function validateSessionCookie(
  socket: Socket,
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
  onGetUser: (userId: string) => Promise<SocketAPIUser | undefined>,
  setUser: (user: SocketAPIUser) => Promise<void>,
): Promise<boolean> {
  const cookieHeader = socket.handshake.headers.cookie as string | undefined;
  const sessionToken = parseCookie(cookieHeader) ?? ((socket.handshake.auth as Record<string, unknown>)?.sessionToken as string | undefined);
  if (!sessionToken) return false;

  const record = await store.findBySessionToken(sessionToken);
  if (!record) return false;

  if (!record.isEnabled) {
    socket.emit(`${eventPrefix}.${socketAPIDeviceDisabled.name}`, undefined);
    socket.disconnect();
    return false;
  }

  const user = await onGetUser(record.userId);
  if (!user) return false;

  await setUser(user);
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  return true;
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```
npx vitest run src/server/auth/validateSessionCookie.tests.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```
git add src/server/auth/validateSessionCookie.ts src/server/auth/validateSessionCookie.tests.ts
git commit -m "feat(auth): allow unauthenticated connections — only disconnect on device-disabled"
```

---

### Task 2: Update `startServer.ts` — never reject socket connection

**Files:**
- Modify: `src/server/startServer.ts:85-97`

Remove the `if (!isValid)` guard so connections always proceed to `next()` regardless of auth result.

- [ ] **Step 1: Write the failing test**

Add to `tests/e2e/auth.tests.ts` inside the existing `describe('JWT auth integration', ...)` block, before `afterAll`:

```ts
it('connects via WebSocket without a session cookie', async () => {
  const { io: socketIo } = await import('socket.io-client');
  const { Logger } = await import('@anupheaus/common');
  const { SocketIOParser } = await import('../../src/common');
  const logger = new Logger('e2e-ws-noauth');
  const socket = socketIo(`http://localhost:${port}`, {
    path: '/e2e-auth',
    transports: ['websocket'],
    autoConnect: false,
    parser: new SocketIOParser({ logger }),
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  expect(socket.connected).toBe(true);
  socket.disconnect();
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npx vitest run tests/e2e/auth.tests.ts
```

Expected: the new test fails with a connect_error (connection rejected).

- [ ] **Step 3: Update `startServer.ts` middleware — always call `next()`**

Replace the middleware block at lines 85–97 of `src/server/startServer.ts`:

```ts
io.use(wrap((socket: Socket) => registry.fromSocket(socket), async (socket: Socket, next: (err?: Error) => void) => {
  setClient(socket);
  try {
    const { setUser } = useAuthentication();
    await validateSessionCookie(socket, auth.store, auth.onGetUser, async user => {
      await setUser(user);
    });
    next();
  } catch (err) {
    next(err as Error);
  }
}));
```

The only difference from the original: `validateSessionCookie` return value is not checked; `next()` is always called (the `if (!isValid)` block is gone).

- [ ] **Step 4: Run the test to confirm it passes**

```
npx vitest run tests/e2e/auth.tests.ts
```

Expected: all tests pass including the new WebSocket no-cookie connection test.

- [ ] **Step 5: Run the full unit + integration suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add src/server/startServer.ts tests/e2e/auth.tests.ts
git commit -m "feat(auth): never reject WebSocket connection — auth enforced per-handler"
```

---

### Task 3: E2E — public and private action behaviour over unauthenticated socket

**Files:**
- Modify: `tests/e2e/auth.tests.ts`

Verify that a connected-but-unauthenticated socket can call `isPublic` actions and is rejected for private ones.

- [ ] **Step 1: Write the failing tests**

Add a `describe` block to `tests/e2e/auth.tests.ts`. This requires a dedicated server with at least one public and one private action. Add inside `describe('JWT auth integration', ...)` after the existing tests:

```ts
describe('unauthenticated WebSocket action enforcement', () => {
  let wsPort: number;
  let wsServer: http.Server;

  const publicPingAction = defineAction<{ msg: string }, { pong: string }>()('publicPing', { isPublic: true });
  const privateAction = defineAction<void, string>()('privateData');

  beforeAll(async () => {
    const { startServer: startSrv } = await import('../../src/server/startServer');
    const { createServerActionHandler: mkHandler } = await import('../../src/server/actions');
    const { clearRestActionRegistry } = await import('../../src/server/actions/restActionRegistry');
    clearRestActionRegistry();

    wsServer = http.createServer();
    await startSrv({
      name: 'e2e-ws-auth',
      logger: new Logger('e2e-ws-auth'),
      server: wsServer,
      auth: configureAuthentication({
        mode: 'jwt',
        store,
        onAuthenticate: async ({ email, password }) => password === 'correct' ? users[email] : undefined,
        onGetUser: async (userId) => Object.values<TestUser>(users).find(u => u.id === userId),
      }),
      actions: [
        mkHandler(publicPingAction, async ({ msg }) => ({ pong: msg })),
        mkHandler(privateAction, async () => 'secret'),
      ],
    });
    await new Promise<void>(resolve => wsServer.listen(0, resolve));
    wsPort = (wsServer.address() as any).port;
  }, 15_000);

  afterAll(() => { wsServer?.close(); });

  it('unauthenticated socket can call a public action', async () => {
    const { TestClient } = await import('./TestClient');
    const c = new TestClient(wsPort, 'e2e-ws-auth');
    await c.connect();
    const result = await c.call(publicPingAction, { msg: 'hello' });
    expect(result).toEqual({ pong: 'hello' });
    c.disconnect();
  });

  it('unauthenticated socket is rejected when calling a private action', async () => {
    const { TestClient } = await import('./TestClient');
    const c = new TestClient(wsPort, 'e2e-ws-auth');
    await c.connect();
    await expect(c.call(privateAction)).rejects.toThrow('Unauthorized');
    c.disconnect();
  });
});
```

Also add the missing imports to the top of `tests/e2e/auth.tests.ts` (they are already imported or available):
- `defineAction` — from `../../src/common/defineAction`
- `Logger` — already imported via `@anupheaus/common`

- [ ] **Step 2: Run the tests to confirm they fail**

```
npx vitest run tests/e2e/auth.tests.ts
```

Expected: two new tests fail (connection rejected or actions error for wrong reason).

- [ ] **Step 3: Run the tests again after Task 2 changes — they should now pass**

```
npx vitest run tests/e2e/auth.tests.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run the full suite one final time**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add tests/e2e/auth.tests.ts
git commit -m "test(e2e): verify public/private action enforcement over unauthenticated WebSocket"
```

---

## Self-Review

**Spec coverage:**
- ✅ Connect without session cookie → allowed
- ✅ Auth check deferred to handler level (already in `createServerHandler.ts:44`)
- ✅ `isPublic` actions callable without auth
- ✅ Private actions rejected with `Unauthorized` for unauthenticated sockets
- ✅ Device-disabled still disconnects immediately with event

**No placeholders:** all steps have complete code.

**Type consistency:** `validateSessionCookie` signature unchanged; `startServer.ts` middleware shape unchanged.
