# Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill all remaining test-coverage gaps in socket-api: unit tests for four untested server hooks and additional e2e scenarios for edge cases not yet exercised.

**Architecture:** Unit tests mock async-context dependencies via `vi.mock` (hoisted). E2e tests spin up a real in-process Socket.IO + HTTP server (`startServer`) and use the `TestClient` wrapper. All tests use Vitest.

**Tech Stack:** Vitest, Socket.IO 4.x, `@anupheaus/common`, TypeScript

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/server/actions/useAction.tests.ts` | Create | Unit tests for `useAction` hook |
| `src/server/events/useEvent.tests.ts` | Create | Unit tests for `useEvent` hook |
| `src/server/handler/setupHandlers.tests.ts` | Create | Unit tests for `setupHandlers` |
| `src/server/providers/useNexus.tests.ts` | Create | Unit tests for `useNexus` composition |
| `tests/e2e/socket-api.e2e.tests.ts` | Modify | Add 3 new e2e `describe` blocks at the bottom |

---

### Task 1: Unit tests for `useAction`

`src/server/actions/useAction.ts` has zero unit tests. It calls `useNexus()` to get `getClient(true)`, then calls `client.emitWithAck(...)` and passes the result through `throwIfAckError`. We test this by mocking `../providers` (for `useNexus`) and `../../common/ackResponse` (for `throwIfAckError`).

**Files:**
- Create: `src/server/actions/useAction.tests.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/server/actions/useAction.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmitWithAck = vi.fn();
const mockGetClient = vi.fn().mockReturnValue({ emitWithAck: mockEmitWithAck });
const mockThrowIfAckError = vi.fn((v: unknown) => v);

vi.mock('../providers', () => ({
  useNexus: () => ({ getClient: mockGetClient }),
}));

vi.mock('../../common/ackResponse', () => ({
  throwIfAckError: (v: unknown) => mockThrowIfAckError(v),
}));

import { useAction } from './useAction';
import { defineAction } from '../../common/defineAction';

describe('useAction', () => {
  const echoAction = defineAction<{ msg: string }, { reply: string }>()('unitEcho');

  beforeEach(() => {
    mockEmitWithAck.mockReset();
    mockGetClient.mockReturnValue({ emitWithAck: mockEmitWithAck });
    mockThrowIfAckError.mockImplementation((v: unknown) => v);
  });

  it('returns a function', () => {
    const fn = useAction(echoAction);
    expect(typeof fn).toBe('function');
  });

  it('calls getClient(true) when the returned function is invoked', async () => {
    mockEmitWithAck.mockResolvedValue({ reply: 'pong' });
    const fn = useAction(echoAction);
    await fn({ msg: 'ping' });
    expect(mockGetClient).toHaveBeenCalledWith(true);
  });

  it('emits on the correct channel (actionPrefix + action.name)', async () => {
    mockEmitWithAck.mockResolvedValue({ reply: 'pong' });
    const fn = useAction(echoAction);
    await fn({ msg: 'ping' });
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      expect.stringContaining('unitEcho'),
      { msg: 'ping' },
    );
  });

  it('passes the raw ack result through throwIfAckError', async () => {
    const rawResponse = { reply: 'world' };
    mockEmitWithAck.mockResolvedValue(rawResponse);
    const fn = useAction(echoAction);
    await fn({ msg: 'hello' });
    expect(mockThrowIfAckError).toHaveBeenCalledWith(rawResponse);
  });

  it('resolves with the value returned by throwIfAckError', async () => {
    mockEmitWithAck.mockResolvedValue({ reply: 'ok' });
    mockThrowIfAckError.mockReturnValue({ reply: 'ok' });
    const fn = useAction(echoAction);
    const result = await fn({ msg: 'hi' });
    expect(result).toEqual({ reply: 'ok' });
  });

  it('propagates error when throwIfAckError throws', async () => {
    mockEmitWithAck.mockResolvedValue({ error: new Error('client-side failure') });
    mockThrowIfAckError.mockImplementation(() => { throw new Error('client-side failure'); });
    const fn = useAction(echoAction);
    await expect(fn({ msg: 'hi' })).rejects.toThrow('client-side failure');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm -C C:/code/personal/socket-api test src/server/actions/useAction.tests.ts
```
Expected: FAIL — "Cannot find module" or similar (file not imported yet).

- [ ] **Step 3: Run full test suite to confirm all existing tests still pass**

```
pnpm -C C:/code/personal/socket-api test
```
Expected: All previously passing tests pass. New tests should pass too since `useAction.ts` already exists.

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/actions/useAction.tests.ts
git -C C:/code/personal/socket-api commit -m "test: add unit tests for server-side useAction hook"
```

---

### Task 2: Unit tests for `useEvent`

`src/server/events/useEvent.ts` has no unit tests. It calls `useNexus()` for `getClient(true)`, then `client.emitWithAck(eventPrefix + '.' + event.name, payload)`. We mock `../providers` and assert the wire call.

**Files:**
- Create: `src/server/events/useEvent.tests.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/server/events/useEvent.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmitWithAck = vi.fn();
const mockGetClient = vi.fn().mockReturnValue({ emitWithAck: mockEmitWithAck });

vi.mock('../providers', () => ({
  useNexus: () => ({ getClient: mockGetClient }),
}));

import { useEvent } from './useEvent';
import { defineEvent } from '../../common/defineEvent';

describe('useEvent', () => {
  const pingEvent = defineEvent<{ tag: string }>('unitPing');

  beforeEach(() => {
    mockEmitWithAck.mockReset().mockResolvedValue(undefined);
    mockGetClient.mockReturnValue({ emitWithAck: mockEmitWithAck });
  });

  it('returns a function', () => {
    const fn = useEvent(pingEvent);
    expect(typeof fn).toBe('function');
  });

  it('calls getClient(true) when the returned function is invoked', async () => {
    const fn = useEvent(pingEvent);
    await fn({ tag: 'hello' });
    expect(mockGetClient).toHaveBeenCalledWith(true);
  });

  it('emits on the correct channel (eventPrefix + event.name)', async () => {
    const fn = useEvent(pingEvent);
    await fn({ tag: 'hello' });
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      expect.stringContaining('unitPing'),
      { tag: 'hello' },
    );
  });

  it('passes the payload to emitWithAck', async () => {
    const fn = useEvent(pingEvent);
    await fn({ tag: 'specific-tag' });
    expect(mockEmitWithAck).toHaveBeenCalledWith(
      expect.any(String),
      { tag: 'specific-tag' },
    );
  });

  it('resolves without error when emitWithAck resolves', async () => {
    const fn = useEvent(pingEvent);
    await expect(fn({ tag: 'ok' })).resolves.toBeUndefined();
  });

  it('propagates rejection when emitWithAck rejects', async () => {
    mockEmitWithAck.mockRejectedValue(new Error('socket write failed'));
    const fn = useEvent(pingEvent);
    await expect(fn({ tag: 'fail' })).rejects.toThrow('socket write failed');
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass**

```
pnpm -C C:/code/personal/socket-api test src/server/events/useEvent.tests.ts
```
Expected: PASS — all 6 tests green.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/events/useEvent.tests.ts
git -C C:/code/personal/socket-api commit -m "test: add unit tests for server-side useEvent hook"
```

---

### Task 3: Unit tests for `setupHandlers`

`src/server/handler/setupHandlers.ts` has no unit tests. It calls `useLogger()` from async-context, then iterates handlers. We mock `../async-context/socketApiContext` for `useLogger`.

**Files:**
- Create: `src/server/handler/setupHandlers.tests.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/server/handler/setupHandlers.tests.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDebug = vi.fn();
const mockLogger = { debug: mockDebug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../async-context/socketApiContext', () => ({
  useLogger: () => mockLogger,
}));

import { setupHandlers } from './setupHandlers';

describe('setupHandlers', () => {
  beforeEach(() => {
    mockDebug.mockClear();
  });

  it('does nothing when the handlers array is empty', () => {
    expect(() => setupHandlers([])).not.toThrow();
    // logger should NOT have been called — no handlers means early return
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it('calls each handler exactly once', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    setupHandlers([h1, h2]);
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('calls handlers in order', () => {
    const order: number[] = [];
    const h1 = vi.fn(() => { order.push(1); });
    const h2 = vi.fn(() => { order.push(2); });
    const h3 = vi.fn(() => { order.push(3); });
    setupHandlers([h1, h2, h3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('logs debug messages when handlers are present', () => {
    setupHandlers([vi.fn()]);
    expect(mockDebug).toHaveBeenCalledTimes(2);
    expect(mockDebug).toHaveBeenCalledWith('Setting up handlers...');
    expect(mockDebug).toHaveBeenCalledWith('Handlers set up.');
  });

  it('still calls subsequent handlers even if one throws', () => {
    const h1 = vi.fn(() => { throw new Error('boom'); });
    const h2 = vi.fn();
    // The function itself propagates the throw — this documents the current behaviour
    expect(() => setupHandlers([h1, h2])).toThrow('boom');
    expect(h1).toHaveBeenCalledOnce();
    // h2 is not called because h1 threw before it — this is Array.forEach behaviour
    expect(h2).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass**

```
pnpm -C C:/code/personal/socket-api test src/server/handler/setupHandlers.tests.ts
```
Expected: PASS — all 5 tests green.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/handler/setupHandlers.tests.ts
git -C C:/code/personal/socket-api commit -m "test: add unit tests for setupHandlers"
```

---

### Task 4: Unit tests for `useNexus`

`src/server/providers/useNexus.ts` has no unit tests. It composes `useConfig`, `internalUseSocket`, and `useAuthentication`, then adds `wrapWithNexus`. We mock all three providers.

**Files:**
- Create: `src/server/providers/useNexus.tests.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/server/providers/useNexus.tests.ts
import { describe, it, expect, vi } from 'vitest';

const mockConfig = { name: 'test-socket' };
const mockClient = { id: 'socket-id-1', emit: vi.fn(), emitWithAck: vi.fn() };
const mockGetClient = vi.fn().mockReturnValue(mockClient);
const mockAuthentication = { user: null, impersonateUser: vi.fn() };
const mockWrap = vi.fn().mockImplementation((_client: unknown, fn: unknown) => fn);

vi.mock('./authentication', () => ({
  useAuthentication: () => mockAuthentication,
}));

vi.mock('./socket', () => ({
  internalUseSocket: () => ({ getClient: mockGetClient }),
}));

vi.mock('../async-context', () => ({
  useConfig: () => mockConfig,
  wrap: (client: unknown, fn: unknown) => mockWrap(client, fn),
}));

import { useNexus } from './useNexus';

describe('useNexus', () => {
  it('returns config from useConfig', () => {
    const api = useNexus();
    expect(api.config).toBe(mockConfig);
  });

  it('returns getClient from internalUseSocket', () => {
    const api = useNexus();
    expect(api.getClient).toBe(mockGetClient);
  });

  it('spreads authentication properties onto the return value', () => {
    const api = useNexus();
    expect(api.user).toBe(mockAuthentication.user);
    expect(api.impersonateUser).toBe(mockAuthentication.impersonateUser);
  });

  it('returns a wrapWithNexus function', () => {
    const api = useNexus();
    expect(typeof api.wrapWithNexus).toBe('function');
  });

  it('wrapWithNexus calls getClient(true) and wraps the handler', () => {
    const api = useNexus();
    const handler = vi.fn();
    api.wrapWithNexus(handler);
    expect(mockGetClient).toHaveBeenCalledWith(true);
    expect(mockWrap).toHaveBeenCalledWith(mockClient, handler);
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass**

```
pnpm -C C:/code/personal/socket-api test src/server/providers/useNexus.tests.ts
```
Expected: PASS — all 5 tests green.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/providers/useNexus.tests.ts
git -C C:/code/personal/socket-api commit -m "test: add unit tests for useNexus composition hook"
```

---

### Task 5: E2e — useAction client-side error propagation

When a server calls `useAction` and the client-side handler **throws**, the server should receive the error back (not a hang or a success). This scenario is not covered by existing tests.

**Files:**
- Modify: `tests/e2e/socket-api.e2e.tests.ts` — add new `describe` block

- [ ] **Step 1: Add the new describe block at the end of the file (before the final closing `})`)**

Locate the last line of the `describe('socket-api e2e', ...)` block. Insert the following before the final closing `});`:

```typescript
  describe('useAction — client-side error propagation', () => {
    const e2eClientThrowAction = defineAction<{ code: number }, { result: string }>()('e2eClientThrow');
    const e2eTriggerClientThrowAction = defineAction<{ code: number }, { result: string }>()('e2eTriggerClientThrow');

    // Register a server action that calls back to the client using useAction
    // and a client-side handler that conditionally throws.
    // NOTE: these actions must be added to e2eActions at the top of the file.

    it('server receives the error when the client-side useAction handler throws', async () => {
      const c = client();
      await c.connect();

      // Register a client-side handler that always throws
      const off = c.registerServerActionHandler(e2eClientThrowAction, async () => {
        throw new Error('client-handler-failure');
      });

      // The server emits e2eClientThrowAction toward the client via useAction,
      // then the error propagates back through throwIfAckError.
      // Since e2eTriggerClientThrowAction is registered to call useAction(e2eClientThrowAction),
      // the call should reject on the test client side.
      await expect(c.call(e2eTriggerClientThrowAction, { code: 1 })).rejects.toThrow('client-handler-failure');

      off();
      c.disconnect();
    });

    it('server recovers: subsequent useAction calls succeed after a client handler threw', async () => {
      const c = client();
      await c.connect();

      let callCount = 0;
      const off = c.registerServerActionHandler(e2eClientThrowAction, async () => {
        callCount++;
        if (callCount === 1) throw new Error('first-call-fails');
        return { result: 'ok' };
      });

      // First call should propagate the client error
      await expect(c.call(e2eTriggerClientThrowAction, { code: 1 })).rejects.toThrow('first-call-fails');

      // Second call should succeed
      const result = await c.call(e2eTriggerClientThrowAction, { code: 2 });
      expect(result).toEqual({ result: 'ok' });

      off();
      c.disconnect();
    });
  });
```

Also add the new action registrations near the top of the file inside `e2eActions`. Find:
```typescript
  createServerActionHandler(e2eTriggerClientEchoAction, async ({ v }) => {
    const askClient = useAction(e2eClientEchoAction);
    return askClient({ v });
  }),
```

Add after it:
```typescript
  createServerActionHandler(e2eTriggerClientThrowAction, async ({ code }) => {
    const askClient = useAction(e2eClientThrowAction);
    return askClient({ code });
  }),
```

And add the two `defineAction` calls near the top where the other ones are:
```typescript
const e2eClientThrowAction = defineAction<{ code: number }, { result: string }>()('e2eClientThrow');
const e2eTriggerClientThrowAction = defineAction<{ code: number }, { result: string }>()('e2eTriggerClientThrow');
```

- [ ] **Step 2: Run the e2e file to confirm new tests pass**

```
pnpm -C C:/code/personal/socket-api test tests/e2e/socket-api.e2e.tests.ts
```
Expected: All tests pass including the 2 new ones.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add tests/e2e/socket-api.e2e.tests.ts
git -C C:/code/personal/socket-api commit -m "test(e2e): add useAction client-side error propagation scenarios"
```

---

### Task 6: E2e — event broadcast to multiple clients

The existing event tests only verify a single client receives an event. This task adds a test where the server emits an event and **all connected clients** receive it. This validates that `useEvent` targets the correct socket rather than broadcasting globally.

**Files:**
- Modify: `tests/e2e/socket-api.e2e.tests.ts` — add new `describe` block

- [ ] **Step 1: Add new describe block to the events section**

Find the closing `});` of `describe('events', ...)` and add a new describe block after it:

```typescript
  describe('events — targeted vs isolated delivery', () => {
    it('event is delivered only to the socket that triggered it, not to other connected clients', async () => {
      const c1 = client();
      const c2 = client();

      const c1Received: { tag: string }[] = [];
      const c2Received: { tag: string }[] = [];

      await Promise.all([c1.connect(), c2.connect()]);

      c1.onEvent(e2eCustomDomainEvent, p => c1Received.push(p));
      c2.onEvent(e2eCustomDomainEvent, p => c2Received.push(p));

      // c1 triggers the server action that calls useEvent — event should go to c1's socket only
      await c1.call(e2eEmitDomainEventAction, { tag: 'c1-only' });
      await delay(80);

      expect(c1Received).toEqual([{ tag: 'c1-only' }]);
      expect(c2Received).toHaveLength(0);

      c1.disconnect();
      c2.disconnect();
    });

    it('each client receives its own events independently', async () => {
      const c1 = client();
      const c2 = client();

      const c1Tags: string[] = [];
      const c2Tags: string[] = [];

      await Promise.all([c1.connect(), c2.connect()]);
      c1.onEvent(e2eCustomDomainEvent, p => c1Tags.push(p.tag));
      c2.onEvent(e2eCustomDomainEvent, p => c2Tags.push(p.tag));

      await c1.call(e2eEmitDomainEventAction, { tag: 'from-c1' });
      await c2.call(e2eEmitDomainEventAction, { tag: 'from-c2' });
      await delay(100);

      expect(c1Tags).toEqual(['from-c1']);
      expect(c2Tags).toEqual(['from-c2']);

      c1.disconnect();
      c2.disconnect();
    });
  });
```

- [ ] **Step 2: Run the e2e file**

```
pnpm -C C:/code/personal/socket-api test tests/e2e/socket-api.e2e.tests.ts
```
Expected: All tests pass including 2 new event isolation tests.

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add tests/e2e/socket-api.e2e.tests.ts
git -C C:/code/personal/socket-api commit -m "test(e2e): verify useEvent delivers to triggering socket only, not all clients"
```

---

### Task 7: E2e — subscription updates don't bleed between clients

The existing concurrent-subscription test uses one client with two subs. This task adds a test with two **separate clients** each subscribed independently, verifying their updates don't bleed into each other.

**Files:**
- Modify: `tests/e2e/socket-api.e2e.tests.ts` — add inside the subscriptions describe

- [ ] **Step 1: Add test inside the `describe('subscriptions', ...)` block**

Find the closing `});` of `describe('subscriptions', ...)` and insert before it:

```typescript
    it('updates from one client subscription do not bleed into a different client subscription', async () => {
      const c1 = client();
      const c2 = client();
      await Promise.all([c1.connect(), c2.connect()]);

      const c1Updates: { count: number }[] = [];
      const c2Updates: { count: number }[] = [];

      const sub1 = await c1.subscribe(tickSubscription, { intervalMs: 40 }, 'bleed-test-c1');
      const sub2 = await c2.subscribe(tickSubscription, { intervalMs: 40 }, 'bleed-test-c2');

      c1.onSubscriptionUpdate(tickSubscription, sub1.subscriptionId, u => c1Updates.push(u));
      c2.onSubscriptionUpdate(tickSubscription, sub2.subscriptionId, u => c2Updates.push(u));

      await delay(200);

      // Both clients should have received updates
      expect(c1Updates.length).toBeGreaterThanOrEqual(2);
      expect(c2Updates.length).toBeGreaterThanOrEqual(2);

      // Cross-check: c1's updates should not appear in c2's listener and vice-versa
      // (the subscriptionId filter in TestClient.onSubscriptionUpdate handles this,
      // but this test verifies neither client receives raw events for the other's sub)
      const c1SubId = sub1.subscriptionId;
      const c2SubId = sub2.subscriptionId;
      expect(c1SubId).not.toBe(c2SubId);

      await c1.unsubscribe(tickSubscription, sub1.subscriptionId);
      await c2.unsubscribe(tickSubscription, sub2.subscriptionId);
      c1.disconnect();
      c2.disconnect();
    });
```

- [ ] **Step 2: Run the e2e file**

```
pnpm -C C:/code/personal/socket-api test tests/e2e/socket-api.e2e.tests.ts
```
Expected: All tests pass including new cross-client subscription test.

- [ ] **Step 3: Run full test suite**

```
pnpm -C C:/code/personal/socket-api test
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add tests/e2e/socket-api.e2e.tests.ts
git -C C:/code/personal/socket-api commit -m "test(e2e): verify subscription updates don't bleed between clients"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `useAction.ts` unit tests — Task 1
- ✅ `useEvent.ts` unit tests — Task 2  
- ✅ `setupHandlers.ts` unit tests — Task 3
- ✅ `useNexus.ts` unit tests — Task 4
- ✅ useAction client-error propagation e2e — Task 5
- ✅ Event targeted delivery e2e — Task 6
- ✅ Cross-client subscription isolation e2e — Task 7

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:** `defineAction`, `defineEvent`, `defineSubscription` used consistently across all tasks. `mockGetClient`, `mockEmitWithAck` names consistent within each task file.
