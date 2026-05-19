# Test Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 12 test gaps identified in the audit — 5 missing test files, 5 quality gaps in existing tests, 1 naming inconsistency, and 1 additional quality fix.

**Architecture:** All changes are test-only. Existing source files are not modified. New test files follow the `.tests.ts` / `.tests.tsx` convention and the patterns established in the codebase (Vitest, `vi.hoisted`, `vi.mock`, `renderHook` from `@testing-library/react`).

**Tech Stack:** Vitest, `@testing-library/react`, TypeScript, socket.io-client

---

## File Structure

**Files to rename:**
- `src/server/async-context/createAsyncContext.test.ts` → `createAsyncContext.tests.ts`

**Files to modify (existing tests strengthened):**
- `src/common/socket/deconstruct.tests.ts`
- `src/common/socket/reconstruct.tests.ts`
- `src/common/socket/SocketIOParser.tests.ts`
- `src/server/handler/createServerHandler.tests.ts`
- `src/server/security/createSecurityMiddleware.tests.ts`
- `src/server/actions/signinAction.tests.ts`

**Files to create (new test files):**
- `src/server/actions/googleConfigAction.tests.ts`
- `src/server/providers/koa/setupKoa.tests.ts`
- `src/server/providers/socket/setupSocket.tests.ts`
- `src/client/providers/socket/useSocket.tests.ts`
- `src/client/providers/socket/SocketProvider.tests.tsx`

---

### Task 1: Fix test file naming inconsistency

**Files:**
- Rename: `src/server/async-context/createAsyncContext.test.ts` → `src/server/async-context/createAsyncContext.tests.ts`

- [ ] **Step 1: Rename the file**

```powershell
Rename-Item "src\server\async-context\createAsyncContext.test.ts" "createAsyncContext.tests.ts"
```

- [ ] **Step 2: Verify tests still pass**

```powershell
pnpm test src/server/async-context/createAsyncContext.tests.ts
```

Expected: All tests in the file pass (content is unchanged, only filename differs).

- [ ] **Step 3: Commit**

```powershell
git add src/server/async-context/createAsyncContext.tests.ts
git add src/server/async-context/createAsyncContext.test.ts
git commit -m "test: rename createAsyncContext.test.ts to .tests.ts for naming consistency"
```

---

### Task 2: Strengthen deconstruct and reconstruct tests

**Files:**
- Modify: `src/common/socket/deconstruct.tests.ts`
- Modify: `src/common/socket/reconstruct.tests.ts`

The current issues:
- `deconstruct.tests.ts`: uses `toBeDefined()` before equality checks (assertions survive mutations), no round-trip test
- `reconstruct.tests.ts`: datetime test has an `if/else` fallback that makes the test pass even when DateTime conversion doesn't work; `toBeDefined()` is redundant

- [ ] **Step 1: Rewrite `deconstruct.tests.ts`**

Replace the entire file content:

```typescript
import { describe, it, expect } from 'vitest';
import { deconstruct } from './deconstruct';
import { reconstruct } from './reconstruct';

describe('deconstruct', () => {
  it('serialises plain objects to a string for transport', () => {
    const data = { foo: 'bar', count: 42 };
    const result = deconstruct(data);
    expect(typeof result).toBe('string');
    expect(JSON.parse(result as string)).toEqual(data);
  });

  it('returns strings unchanged', () => {
    expect(deconstruct('hello')).toBe('hello');
  });

  it('returns numbers unchanged', () => {
    expect(deconstruct(123)).toBe(123);
  });

  it('returns null unchanged', () => {
    expect(deconstruct(null)).toBeNull();
  });

  it('returns undefined unchanged', () => {
    expect(deconstruct(undefined)).toBeUndefined();
  });

  it('returns booleans unchanged', () => {
    expect(deconstruct(true)).toBe(true);
    expect(deconstruct(false)).toBe(false);
  });

  it('returns arrays unchanged (arrays are not plain objects)', () => {
    const arr = [1, 2, 3];
    expect(deconstruct(arr)).toBe(arr);
  });

  it('serialises nested plain objects', () => {
    const data = { nested: { value: 1 } };
    const result = deconstruct(data);
    expect(typeof result).toBe('string');
    expect(JSON.parse(result as string)).toEqual(data);
  });

  it('serialises Date objects inside plain objects to ISO strings', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const result = deconstruct({ timestamp: date });
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result as string);
    expect(parsed.timestamp).toBe('2024-01-15T12:00:00.000Z');
  });

  it('round-trips through reconstruct back to the original value', () => {
    const original = { name: 'Alice', count: 7 };
    const serialised = deconstruct(original) as Parameters<typeof reconstruct>[0];
    expect(reconstruct(serialised)).toEqual(original);
  });
});
```

- [ ] **Step 2: Rewrite `reconstruct.tests.ts`**

Replace the entire file content:

```typescript
import { describe, it, expect } from 'vitest';
import { reconstruct } from './reconstruct';
import { deconstruct } from './deconstruct';

describe('reconstruct', () => {
  it('deserialises a plain object unchanged', () => {
    const data = { foo: 'bar', count: 42 };
    expect(reconstruct(data)).toEqual(data);
  });

  it('converts an ISO date string property to a DateTime-like object with toISO()', () => {
    const result = reconstruct({ timestamp: '2024-01-15T12:00:00.000Z' }) as Record<string, unknown>;
    const ts = result.timestamp as { toISO: () => string };
    expect(typeof ts.toISO).toBe('function');
    expect(ts.toISO()).toMatch(/2024-01-15T12:00:00\.000(Z|\+00:00)/);
  });

  it('handles empty object', () => {
    expect(reconstruct({})).toEqual({});
  });

  it('handles nested objects', () => {
    const data = { level1: { level2: { value: 1 } } };
    expect(reconstruct(data)).toEqual(data);
  });

  it('returns data unchanged when deserialise throws', () => {
    // to.deserialise should not throw on well-formed objects, but this validates
    // the try/catch safety net.
    const data = { x: 1 };
    expect(reconstruct(data)).toEqual(data);
  });

  it('round-trips through deconstruct back to the original value', () => {
    const original = { name: 'Bob', score: 99 };
    const serialised = deconstruct(original) as Parameters<typeof reconstruct>[0];
    expect(reconstruct(serialised)).toEqual(original);
  });
});
```

- [ ] **Step 3: Run tests**

```powershell
pnpm test src/common/socket/deconstruct.tests.ts src/common/socket/reconstruct.tests.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src/common/socket/deconstruct.tests.ts src/common/socket/reconstruct.tests.ts
git commit -m "test: strengthen deconstruct/reconstruct assertions and add round-trip tests"
```

---

### Task 3: Add SocketIOParser encode/decode behavior tests

**Files:**
- Modify: `src/common/socket/SocketIOParser.tests.ts`

The existing tests only cover listener management and structural checks. The custom encode/decode logic (type-2 and type-3 packet transformation) is completely untested.

Strategy: mock `./deconstruct` and `./reconstruct` at module level so we can verify they're called with the right arguments. Add separate error-path tests.

- [ ] **Step 1: Add the encode/decode tests to `SocketIOParser.tests.ts`**

Append the following `describe` blocks at the end of the existing file (after the closing `});` of the existing `describe('SocketIOParser', ...)`):

```typescript
// ---------------------------------------------------------------------------
// To test the data transformation in encode/decode we mock the transform
// functions and verify they're called with the correct packet data.
// ---------------------------------------------------------------------------
import { deconstruct } from './deconstruct';
import { reconstruct } from './reconstruct';

vi.mock('./deconstruct', () => ({ deconstruct: vi.fn((x: unknown) => x) }));
vi.mock('./reconstruct', () => ({ reconstruct: vi.fn((x: unknown) => x) }));
```

Wait — `vi.mock` calls must be at the top level of the module (they are hoisted). Because the existing test file already imports from `./SocketIOParser`, we cannot add `vi.mock('./deconstruct')` after the fact in the same file without breaking the existing tests. The cleanest solution is to **split** the encode/decode behavior tests into a separate file that has its own mocks.

- [ ] **Step 1 (revised): Create `src/common/socket/SocketIOParser.encode-decode.tests.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./deconstruct', () => ({ deconstruct: vi.fn((x: unknown) => x) }));
vi.mock('./reconstruct', () => ({ reconstruct: vi.fn((x: unknown) => x) }));

import { deconstruct } from './deconstruct';
import { reconstruct } from './reconstruct';
import { SocketIOParser } from './SocketIOParser';

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
  provide: vi.fn((fn: () => unknown) => fn()),
};

function makeParser() {
  return new SocketIOParser({ logger: mockLogger as never });
}

beforeEach(() => vi.clearAllMocks());

describe('CustomEncoder — type-2 packet transformation', () => {
  it('calls deconstruct on data[1] for type-2 EVENT packets', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    const payload = { foo: 'bar' };
    encoder.encode({ type: 2, nsp: '/', data: ['event', payload] });
    expect(deconstruct).toHaveBeenCalledWith(payload);
  });

  it('does NOT call deconstruct when data[1] is an ArrayBuffer', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    encoder.encode({ type: 2, nsp: '/', data: ['event', new ArrayBuffer(8)] });
    expect(deconstruct).not.toHaveBeenCalled();
  });
});

describe('CustomEncoder — type-3 packet transformation', () => {
  it('calls deconstruct on the entire data array for type-3 ACK packets', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    const data = [{ id: 1 }];
    encoder.encode({ type: 3, nsp: '/', id: 0, data });
    expect(deconstruct).toHaveBeenCalledWith(data);
  });
});

describe('CustomEncoder — non-data packet types', () => {
  it('does NOT call deconstruct for type-0 (CONNECT) packets', () => {
    const parser = makeParser();
    const encoder = new parser.Encoder();
    encoder.encode({ type: 0, nsp: '/' });
    expect(deconstruct).not.toHaveBeenCalled();
  });
});

describe('CustomEncoder — error resilience', () => {
  it('calls logger.error and does not throw when deconstruct throws', () => {
    vi.mocked(deconstruct).mockImplementationOnce(() => { throw new Error('serialise failed'); });
    const parser = makeParser();
    const encoder = new parser.Encoder();
    expect(() => encoder.encode({ type: 2, nsp: '/', data: ['event', { x: 1 }] })).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error occurred while deconstructing',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});

describe('CustomDecoder — type-2 packet reconstruction', () => {
  it('calls reconstruct on data[1] for type-2 decoded packets', () => {
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const rawData = { serialised: true };
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 2, nsp: '/', data: ['event', rawData] });
    expect(reconstruct).toHaveBeenCalledWith(rawData);
  });

  it('does NOT call reconstruct when data[1] is an ArrayBuffer', () => {
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 2, nsp: '/', data: ['event', new ArrayBuffer(4)] });
    expect(reconstruct).not.toHaveBeenCalled();
  });
});

describe('CustomDecoder — type-3 packet reconstruction', () => {
  it('calls reconstruct on data[0] for type-3 ACK decoded packets', () => {
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const rawData = { result: 42 };
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 3, nsp: '/', data: [rawData] });
    expect(reconstruct).toHaveBeenCalledWith(rawData);
  });
});

describe('CustomDecoder — error resilience', () => {
  it('calls logger.error and still invokes the callback when reconstruct throws', () => {
    vi.mocked(reconstruct).mockImplementationOnce(() => { throw new Error('deserialise failed'); });
    const parser = makeParser();
    const decoder = new parser.Decoder();
    const callback = vi.fn();
    decoder.on('decoded', callback);
    (decoder as any).emit('decoded', { type: 2, nsp: '/', data: ['event', '{}'] });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error occurred while reconstructing',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(callback).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the new tests**

```powershell
pnpm test src/common/socket/SocketIOParser.encode-decode.tests.ts
```

Expected: All 9 new tests pass.

- [ ] **Step 3: Commit**

```powershell
git add src/common/socket/SocketIOParser.encode-decode.tests.ts
git commit -m "test: add SocketIOParser encode/decode packet transformation tests"
```

---

### Task 4: Add createServerHandler socket dispatch tests

**Files:**
- Modify: `src/server/handler/createServerHandler.tests.ts`

The existing tests only verify that `registerSocket` is a function and that duplicate names throw. The actual socket dispatch logic (calling the handler, wrapping errors as `{ error }`, REST-only rejection) is untested.

The module has module-level state (`registeredHandlers` Set), which the existing tests reset via `vi.resetModules()`. We add mocks at the top level and use the same dynamic-import pattern.

- [ ] **Step 1: Add mocks and new describe block to `createServerHandler.tests.ts`**

Add the following at the very top of the file, before the existing `describe` block:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── hoisted mock references ─────────────────────────────────────────────────
const { mockLoggerRef, mockClientRef, mockLimitGate } = vi.hoisted(() => {
  const mockLoggerRef = { silly: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const mockClientRef = { on: vi.fn() };
  const mockLimitGate = { run: vi.fn(async (fn: () => unknown) => fn()) };
  return { mockLoggerRef, mockClientRef, mockLimitGate };
});

vi.mock('../async-context/socketApiContext', () => ({
  useLogger: vi.fn(() => mockLoggerRef),
  useConfig: vi.fn(() => ({})),
  wrap: vi.fn((_ctx: unknown, fn: Function) => fn),
}));

vi.mock('../providers', () => ({
  useClient: vi.fn(() => mockClientRef),
}));

vi.mock('../providers/authentication', () => ({
  useAuthentication: vi.fn(() => ({ user: null })),
}));

vi.mock('./actionLimitGate', () => ({
  createActionLimitGate: vi.fn(() => mockLimitGate),
}));

vi.mock('./handlerUtils', () => ({
  createSocketHandlerUtils: vi.fn(() => ({})),
}));

vi.mock('../../common/ackResponse', () => ({
  wrapAckHandler: vi.fn(async (fn: () => unknown) => fn()),
  getErrorFromAckResponse: vi.fn((result: unknown) => {
    if (result != null && typeof result === 'object' && 'error' in result) {
      return { error: (result as any).error, response: null };
    }
    return { response: result, error: null };
  }),
}));
```

Then add this new `describe` block after the existing one:

```typescript
describe('createServerHandler — socket dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockClientRef.on.mockReset();
    mockLimitGate.run.mockImplementation(async (fn: () => unknown) => fn());
  });

  async function makeHandler(
    name: string,
    handler: Function,
    opts: { isPublic?: boolean; transport?: Array<'socket' | 'rest'> } = {},
  ) {
    const { createServerHandler } = await import('./createServerHandler');
    const h = createServerHandler('action', 'test', name, handler as any, undefined, opts.isPublic ?? false, undefined, opts.transport);
    h.registerSocket();
    // Retrieve the handler registered on the mock client socket
    const [eventName, socketHandler] = mockClientRef.on.mock.calls[0];
    return { eventName, socketHandler };
  }

  it('registers the handler on the correct full event name', async () => {
    const { eventName } = await makeHandler('myAction', vi.fn(async () => 'ok'));
    expect(eventName).toBe('test.myAction');
  });

  it('calls the user handler with the request and returns the result via response callback', async () => {
    const userHandler = vi.fn(async (req: { id: string }) => ({ name: req.id }));
    const { socketHandler } = await makeHandler('dispatchAction', userHandler);
    const response = vi.fn();
    await socketHandler({ id: 'abc' }, response);
    expect(userHandler).toHaveBeenCalledWith({ id: 'abc' }, expect.anything());
    expect(response).toHaveBeenCalled();
  });

  it('rejects socket calls to REST-only actions before invoking the handler', async () => {
    const userHandler = vi.fn();
    const { socketHandler } = await makeHandler('restOnly', userHandler, { transport: ['rest'] });
    const response = vi.fn();
    await socketHandler({ x: 1 }, response);
    expect(userHandler).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
  });

  it('wraps handler errors in { error } response', async () => {
    const { wrapAckHandler } = await import('../../common/ackResponse');
    vi.mocked(wrapAckHandler).mockImplementationOnce(async (fn: () => unknown) => {
      try { await fn(); } catch (e) { return { error: { message: (e as Error).message } }; }
    });
    vi.mocked(await import('../../common/ackResponse')).getErrorFromAckResponse.mockReturnValueOnce(
      { error: { message: 'boom' }, response: null },
    );
    const userHandler = vi.fn(async () => { throw new Error('boom'); });
    const { socketHandler } = await makeHandler('failingAction2', userHandler);
    const response = vi.fn();
    await socketHandler({}, response);
    expect(mockLoggerRef.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/server/handler/createServerHandler.tests.ts
```

Expected: All existing tests plus the 4 new ones pass.

- [ ] **Step 3: Commit**

```powershell
git add src/server/handler/createServerHandler.tests.ts
git commit -m "test: add createServerHandler socket dispatch and REST-only rejection tests"
```

---

### Task 5: Strengthen createSecurityMiddleware tests

**Files:**
- Modify: `src/server/security/createSecurityMiddleware.tests.ts`

Two gaps: (1) rate-limit 429 test uses `toBeDefined()` instead of asserting a specific error message; (2) no test for CORS injection via a newline-embedded origin header.

- [ ] **Step 1: Replace the rate-limiting 429 test body**

In the `describe('rate limiting', ...)` block, find the test `'returns 429 after exceeding the limit'` and change the last two assertions:

Old:
```typescript
      expect(ctx.status).toBe(429);
      expect((ctx.body as any).error).toBeDefined();
```

New:
```typescript
      expect(ctx.status).toBe(429);
      expect((ctx.body as any).error).toBe('Rate limit exceeded');
```

- [ ] **Step 2: Add CORS injection test**

Add the following test inside the existing `describe('CORS', ...)` block, after all existing CORS tests:

```typescript
    it('rejects an origin that embeds a CRLF header injection attempt', async () => {
      const app = makeMockApp();
      const mw = createSecurityMiddleware(resolveSecurityConfig({
        cors: { allowedOrigins: 'https://allowed.com' },
        securityHeaders: false,
        rateLimit: false,
      }), app);
      // The embedded CRLF should not be treated as a valid origin match.
      const ctx = makeMockCtx({ headers: { origin: 'https://allowed.com\r\nX-Injected: foo' } });
      const next = vi.fn();
      await mw(ctx, next);
      expect(ctx.status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: Run the tests**

```powershell
pnpm test src/server/security/createSecurityMiddleware.tests.ts
```

Expected: All tests pass. If the 429 test fails, check the actual error message in `createSecurityMiddleware.ts` and match it exactly.

- [ ] **Step 4: Commit**

```powershell
git add src/server/security/createSecurityMiddleware.tests.ts
git commit -m "test: specific 429 body assertion and CORS header injection test"
```

---

### Task 6: Add signinAction resilience and security tests

**Files:**
- Modify: `src/server/actions/signinAction.tests.ts`

Two gaps: store.create throwing is not tested (resilience); XSS/injection payloads in credentials are not tested (security).

- [ ] **Step 1: Add tests to `signinAction.tests.ts`**

Append the following inside the existing `describe('handleSignIn', ...)` block, after the last existing test:

```typescript
  it('propagates error when store.create throws', async () => {
    const store = makeStore();
    vi.mocked(store.create).mockRejectedValueOnce(new Error('db-write-failed'));
    const setCookie = vi.fn();
    await expect(
      handleSignIn(store, async () => testUser, { credentials: { email: 'good@test.com', password: 'correct' }, deviceDetails }, setCookie),
    ).rejects.toThrow('db-write-failed');
  });

  const xssPayloads = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "' OR '1'='1",
    '; DROP TABLE sessions; --',
  ];

  it.each(xssPayloads)(
    'passes credentials containing payload %s to onAuthenticate without modification',
    async (payload) => {
      const onAuthenticate = vi.fn(async () => undefined);
      const setCookie = vi.fn();
      await expect(
        handleSignIn(makeStore(), onAuthenticate, { credentials: { email: payload, password: payload }, deviceDetails }, setCookie),
      ).rejects.toThrow('Authentication failed');
      // The payload must reach onAuthenticate unchanged — never silently dropped or mutated.
      expect(onAuthenticate).toHaveBeenCalledWith(expect.objectContaining({ email: payload, password: payload }));
    },
  );
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/server/actions/signinAction.tests.ts
```

Expected: All existing tests plus the 5 new ones (1 resilience + 4 security payloads) pass.

- [ ] **Step 3: Commit**

```powershell
git add src/server/actions/signinAction.tests.ts
git commit -m "test: signinAction store.create resilience and security payload passthrough tests"
```

---

### Task 7: Add googleConfigAction tests

**Files:**
- Create: `src/server/actions/googleConfigAction.tests.ts`

`createGoogleConfigAction` is a thin wrapper: it calls `createServerActionHandler` with the `googleOAuthConfigAction` contract, a handler that returns `{ clientId }`, and `{ isPublic: true }`. We mock `createServerActionHandler` to verify the call shape.

- [ ] **Step 1: Create `src/server/actions/googleConfigAction.tests.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockCreateServerActionHandler = vi.fn(() => ({ registerSocket: vi.fn() }));

vi.mock('./createServerActionHandler', () => ({
  createServerActionHandler: mockCreateServerActionHandler,
}));

import { googleOAuthConfigAction } from '../../common/internalActions';
import { createGoogleConfigAction } from './googleConfigAction';

describe('createGoogleConfigAction', () => {
  it('calls createServerActionHandler with the googleOAuthConfigAction contract', () => {
    createGoogleConfigAction('my-client-id');
    expect(mockCreateServerActionHandler).toHaveBeenCalledWith(
      googleOAuthConfigAction,
      expect.any(Function),
      { isPublic: true },
    );
  });

  it('handler returns the configured clientId', async () => {
    createGoogleConfigAction('test-id-123');
    const handler = mockCreateServerActionHandler.mock.calls.at(-1)![1] as () => Promise<{ clientId: string }>;
    const result = await handler();
    expect(result).toEqual({ clientId: 'test-id-123' });
  });

  it('returns the result of createServerActionHandler', () => {
    const fakeHandler = { registerSocket: vi.fn() };
    mockCreateServerActionHandler.mockReturnValueOnce(fakeHandler);
    const result = createGoogleConfigAction('x');
    expect(result).toBe(fakeHandler);
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/server/actions/googleConfigAction.tests.ts
```

Expected: All 3 tests pass.

- [ ] **Step 3: Commit**

```powershell
git add src/server/actions/googleConfigAction.tests.ts
git commit -m "test: add googleConfigAction wrapper tests"
```

---

### Task 8: Add setupKoa tests

**Files:**
- Create: `src/server/providers/koa/setupKoa.tests.ts`

`setupKoa` wires up Koa middleware and HTTP request handling. We mock all middleware factories to verify they're called with the right arguments and that the result is wired to the HTTP server.

- [ ] **Step 1: Create `src/server/providers/koa/setupKoa.tests.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockBodyParser = vi.fn(() => vi.fn());
const mockRequestLoggerMiddleware = vi.fn();
const mockCreateRequestLogger = vi.fn(() => mockRequestLoggerMiddleware);
const mockSecurityMiddleware = vi.fn();
const mockCreateSecurityMiddleware = vi.fn(() => mockSecurityMiddleware);
const mockKoaCallback = vi.fn(() => vi.fn());

vi.mock('koa-bodyparser', () => ({ default: mockBodyParser }));
vi.mock('../logger', () => ({ createRequestLogger: mockCreateRequestLogger }));
vi.mock('../../security', () => ({ createSecurityMiddleware: mockCreateSecurityMiddleware }));
vi.mock('../../async-context/socketApiContext', () => ({
  wrap: vi.fn((_selector: unknown, fn: Function) => fn),
}));

vi.mock('koa', () => {
  const useSpy = vi.fn();
  const MockKoa = vi.fn().mockImplementation(() => ({
    use: useSpy,
    callback: mockKoaCallback,
    proxy: false,
  }));
  (MockKoa as any).useSpy = useSpy;
  return { default: MockKoa, Koa: MockKoa };
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRegistry() {
  return { fromRequest: vi.fn(), fromSocket: vi.fn() };
}

function makeServer() {
  return { on: vi.fn() };
}

function makeSecurity() {
  return { maxBodySizeKb: 1024, rateLimit: false, securityHeaders: false, cors: null, trustedProxyHops: 0 };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('setupKoa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches body-parser middleware with the configured maxBodySizeKb', async () => {
    const { setupKoa } = await import('./setupKoa');
    setupKoa(makeServer() as never, makeRegistry() as never, { ...makeSecurity(), maxBodySizeKb: 512 } as never);
    expect(mockBodyParser).toHaveBeenCalledWith(expect.objectContaining({ jsonLimit: '512kb', formLimit: '512kb' }));
  });

  it('attaches the request logger middleware', async () => {
    const { setupKoa } = await import('./setupKoa');
    const app = setupKoa(makeServer() as never, makeRegistry() as never, makeSecurity() as never);
    expect(mockCreateRequestLogger).toHaveBeenCalled();
    expect(app.use).toHaveBeenCalledWith(mockRequestLoggerMiddleware);
  });

  it('attaches security middleware created with the resolved security config', async () => {
    const { setupKoa } = await import('./setupKoa');
    const security = makeSecurity();
    setupKoa(makeServer() as never, makeRegistry() as never, security as never);
    expect(mockCreateSecurityMiddleware).toHaveBeenCalledWith(security, expect.anything());
    expect((await import('koa')).default.prototype?.use ?? (await import('koa')).default.mock.results[0].value.use)
      .toHaveBeenCalledWith(mockSecurityMiddleware);
  });

  it('wires a request listener on the HTTP server', async () => {
    const { setupKoa } = await import('./setupKoa');
    const server = makeServer();
    setupKoa(server as never, makeRegistry() as never, makeSecurity() as never);
    expect(server.on).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('returns the Koa app instance', async () => {
    const { setupKoa } = await import('./setupKoa');
    const result = setupKoa(makeServer() as never, makeRegistry() as never, makeSecurity() as never);
    expect(result).toBeDefined();
    expect(typeof result.use).toBe('function');
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/server/providers/koa/setupKoa.tests.ts
```

Expected: All 5 tests pass. If middleware attachment assertions fail, inspect the `use` spy via `(new Koa()).use` mock call order.

- [ ] **Step 3: Commit**

```powershell
git add src/server/providers/koa/setupKoa.tests.ts
git commit -m "test: add setupKoa middleware wiring and HTTP request listener tests"
```

---

### Task 9: Add setupSocket tests

**Files:**
- Create: `src/server/providers/socket/setupSocket.tests.ts`

`setupSocket` sets up socket.io connection handling: per-connection async context, logging, `onClientConnected` callbacks, and disconnect cleanup. We mock `createServerSocket` to control socket.io events.

- [ ] **Step 1: Create `src/server/providers/socket/setupSocket.tests.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const { mockIo, mockSetClient } = vi.hoisted(() => {
  const mockIo = {
    on: vi.fn(),
    engine: { use: vi.fn() },
    use: vi.fn(),
  };
  return { mockIo, mockSetClient: vi.fn() };
});

vi.mock('./createServerSocket', () => ({ createServerSocket: vi.fn(() => mockIo) }));
vi.mock('../../async-context/socketApiContext', () => ({
  setClient: mockSetClient,
  wrap: vi.fn((selector: unknown, fn: Function) => {
    // Return fn bound so callers can invoke it directly in tests.
    // When selector is a function (scope selector), just return fn; when it's an
    // object (scope key), still return fn.
    return fn;
  }),
}));
vi.mock('../authentication', () => ({
  useAuthentication: vi.fn(() => ({ user: null })),
}));

// ── fake connection ──────────────────────────────────────────────────────────

function makeConnection() {
  return {
    openWebSocket: vi.fn(),
    closeWebSocket: vi.fn(),
  };
}

function makeRegistry(connection = makeConnection()) {
  return {
    fromSocket: vi.fn(() => connection),
    fromRequest: vi.fn(),
    connection,
  };
}

function makeLogger() {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    silly: vi.fn(),
    always: vi.fn(),
    createSubLogger: vi.fn(function () { return logger; }),
  };
  return logger;
}

function makeClient(id = 'client-1') {
  const handlers: Record<string, Function> = {};
  return {
    id,
    request: { headers: { 'user-agent': 'test-ua', 'accept-language': 'en' } },
    handshake: { address: '127.0.0.1' },
    on: vi.fn((event: string, fn: Function) => { handlers[event] = fn; }),
    emit: vi.fn(),
    _handlers: handlers,
  } as unknown as Socket & { _handlers: Record<string, Function> };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('setupSocket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns onClientConnected and io', async () => {
    const { setupSocket } = await import('./setupSocket');
    const result = setupSocket('api', {} as never, makeLogger() as never, undefined, makeRegistry() as never);
    expect(typeof result.onClientConnected).toBe('function');
    expect(result.io).toBe(mockIo);
  });

  it('calls createServerSocket with the configured name', async () => {
    const { createServerSocket } = await import('./createServerSocket');
    const { setupSocket } = await import('./setupSocket');
    setupSocket('my-api', {} as never, makeLogger() as never, undefined, makeRegistry() as never);
    expect(createServerSocket).toHaveBeenCalledWith('my-api', expect.anything(), expect.anything());
  });

  it('registers a connection handler on the socket', async () => {
    const { setupSocket } = await import('./setupSocket');
    setupSocket('api', {} as never, makeLogger() as never, undefined, makeRegistry() as never);
    expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('opens the web socket when a client connects', async () => {
    const { setupSocket } = await import('./setupSocket');
    const connection = makeConnection();
    const registry = makeRegistry(connection);
    setupSocket('api', {} as never, makeLogger() as never, undefined, registry as never);

    const connectionHandler = mockIo.on.mock.calls.find(([e]) => e === 'connection')?.[1];
    const client = makeClient();
    await connectionHandler(client);

    expect(connection.openWebSocket).toHaveBeenCalled();
  });

  it('calls onClientConnected callbacks when a client connects', async () => {
    const { setupSocket } = await import('./setupSocket');
    const registry = makeRegistry();
    const { onClientConnected } = setupSocket('api', {} as never, makeLogger() as never, undefined, registry as never);

    const callback = vi.fn(() => undefined);
    onClientConnected(callback);

    const connectionHandler = mockIo.on.mock.calls.find(([e]) => e === 'connection')?.[1];
    const client = makeClient();
    await connectionHandler(client);

    expect(callback).toHaveBeenCalledWith({ client });
  });

  it('closes the web socket when a client disconnects', async () => {
    const { setupSocket } = await import('./setupSocket');
    const connection = makeConnection();
    const registry = makeRegistry(connection);
    setupSocket('api', {} as never, makeLogger() as never, undefined, registry as never);

    const connectionHandler = mockIo.on.mock.calls.find(([e]) => e === 'connection')?.[1];
    const client = makeClient();
    await connectionHandler(client);

    // Trigger the disconnect event registered on the client
    const disconnectHandler = (client as any)._handlers['disconnect'];
    expect(disconnectHandler).toBeDefined();
    await disconnectHandler();

    expect(connection.closeWebSocket).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/server/providers/socket/setupSocket.tests.ts
```

Expected: All 6 tests pass. If `wrap` mock calls don't match, adjust the mock to pass the function through.

- [ ] **Step 3: Commit**

```powershell
git add src/server/providers/socket/setupSocket.tests.ts
git commit -m "test: add setupSocket connection lifecycle and callback wiring tests"
```

---

### Task 10: Add useSocket hook tests

**Files:**
- Create: `src/client/providers/socket/useSocket.tests.ts`

`useSocket` wraps the `SocketContext` and exposes `isConnected`, `clientId`, `emit`, `on`, `onConnected`, `onDisconnected`, and delegation to the context's connect/disconnect. We mock `SocketContext` and test via `renderHook`.

- [ ] **Step 1: Create `src/client/providers/socket/useSocket.tests.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { Socket } from 'socket.io-client';

// ── mock SocketContext ────────────────────────────────────────────────────────

const { mockContextValue } = vi.hoisted(() => {
  const onConnectionStateChangedCallbacks: Array<(connected: boolean, socket: Socket | undefined) => void> = [];
  const mockContextValue = {
    name: 'test',
    getSocket: vi.fn(() => undefined as Socket | undefined),
    getRawSocket: vi.fn(() => undefined as Socket | undefined),
    onConnectionStateChanged: vi.fn((cb: (connected: boolean, socket: Socket | undefined) => void) => {
      onConnectionStateChangedCallbacks.push(cb);
    }),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    reconnect: vi.fn(),
    waitForAuthCheck: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    onExclusive: vi.fn(),
    off: vi.fn(),
    _triggerConnectionChange: (connected: boolean, socket: Socket | undefined) => {
      onConnectionStateChangedCallbacks.forEach(cb => cb(connected, socket));
    },
    _callbacks: onConnectionStateChangedCallbacks,
  };
  return { mockContextValue };
});

vi.mock('./SocketContext', () => ({
  SocketContext: React.createContext(mockContextValue),
}));

vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    useBound: vi.fn((fn: Function) => fn),
    useId: vi.fn(() => 'hook-id-1'),
    useLogger: vi.fn(() => ({ error: vi.fn() })),
  };
});

import { useSocket } from './useSocket';

// ── fake connected socket ─────────────────────────────────────────────────────

function makeConnectedSocket(id = 'sock-1'): Socket {
  return { id, connected: true } as unknown as Socket;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContextValue._callbacks.length = 0;
    mockContextValue.getSocket.mockReturnValue(undefined);
    mockContextValue.getRawSocket.mockReturnValue(undefined);
  });

  it('returns isConnected as false when socket is not connected', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.isConnected).toBe(false);
  });

  it('getIsConnected() returns false when getSocket() returns undefined', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.getIsConnected()).toBe(false);
  });

  it('getIsConnected() returns true when getSocket() returns a connected socket', () => {
    mockContextValue.getSocket.mockReturnValue(makeConnectedSocket());
    const { result } = renderHook(() => useSocket());
    expect(result.current.getIsConnected()).toBe(true);
  });

  it('delegates emit to the socket when connected', async () => {
    const fakeSocket = makeConnectedSocket() as any;
    fakeSocket.emitWithAck = vi.fn().mockResolvedValue({ value: 'pong' });
    mockContextValue.getSocket.mockReturnValue(fakeSocket);

    const { result } = renderHook(() => useSocket());
    const response = await result.current.emit('testEvent', { ping: true });

    expect(fakeSocket.emitWithAck).toHaveBeenCalledWith('testEvent', { ping: true });
    expect(response).toEqual({ value: 'pong' });
  });

  it('throws when emit is called but socket is not available', async () => {
    mockContextValue.getSocket.mockReturnValue(undefined);
    const { result } = renderHook(() => useSocket());
    await expect(result.current.emit('testEvent', {})).rejects.toThrow();
  });

  it('delegates on() to the context', () => {
    const { result } = renderHook(() => useSocket());
    const handler = vi.fn();
    result.current.on('myEvent', handler);
    expect(mockContextValue.on).toHaveBeenCalledWith('hook-id-1', 'myEvent', handler);
  });

  it('delegates off() to the context', () => {
    const { result } = renderHook(() => useSocket());
    result.current.off('myEvent');
    expect(mockContextValue.off).toHaveBeenCalledWith('hook-id-1', 'myEvent');
  });

  it('delegates connect and disconnect to the context', () => {
    const { result } = renderHook(() => useSocket());
    result.current.connect();
    expect(mockContextValue.connect).toHaveBeenCalled();
    result.current.disconnect();
    expect(mockContextValue.disconnect).toHaveBeenCalled();
  });

  it('calls onConnected callback immediately when socket is already connected', () => {
    const fakeSocket = makeConnectedSocket();
    mockContextValue.getSocket.mockReturnValue(fakeSocket);

    const { result } = renderHook(() => useSocket());
    const callback = vi.fn();
    result.current.onConnected(callback);

    expect(callback).toHaveBeenCalledWith(fakeSocket);
  });

  it('calls onDisconnected callback immediately when socket is not connected', () => {
    mockContextValue.getSocket.mockReturnValue(undefined);
    const { result } = renderHook(() => useSocket());
    const callback = vi.fn();
    result.current.onDisconnected(callback);
    expect(callback).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/client/providers/socket/useSocket.tests.ts
```

Expected: All 10 tests pass. Adjust `useBound` mock if the codebase's `useBound` does something more specific than identity.

- [ ] **Step 3: Commit**

```powershell
git add src/client/providers/socket/useSocket.tests.ts
git commit -m "test: add useSocket hook tests covering connection state, emit, and event delegation"
```

---

### Task 11: Add SocketProvider tests

**Files:**
- Create: `src/client/providers/socket/SocketProvider.tests.tsx`

`SocketProvider` is the most complex component. Focus on the key behaviors: `connect()` promise lifecycle, `disconnect()`, `waitForAuthCheck()` timeout, and the exclusive handler conflict error. We mock `createClientSocket` to control the socket lifecycle.

- [ ] **Step 1: Create `src/client/providers/socket/SocketProvider.tests.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useContext } from 'react';
import type { Socket } from 'socket.io-client';
import { InternalError } from '@anupheaus/common';

// ── fake socket ───────────────────────────────────────────────────────────────

class FakeSocket {
  public id = 'fake-socket-1';
  public connected = false;
  private _handlers: Map<string, Function[]> = new Map();
  public io = { opts: {} };

  on(event: string, fn: Function) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(fn);
    return this;
  }

  off(event: string, fn: Function) {
    const list = this._handlers.get(event) ?? [];
    this._handlers.set(event, list.filter(h => h !== fn));
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    (this._handlers.get(event) ?? []).forEach(fn => fn(...args));
  }

  connect() {
    this.connected = true;
    this.emit('connect');
    return this;
  }

  disconnect() {
    this.connected = false;
    this.emit('disconnect', 'io client disconnect');
    return this;
  }

  removeListener = this.off.bind(this);
  listeners = (event: string) => this._handlers.get(event) ?? [];
}

// ── mocks ─────────────────────────────────────────────────────────────────────

const { mockCreateClientSocket, currentFakeSocket } = vi.hoisted(() => {
  let _socket: FakeSocket | null = null;
  const mockCreateClientSocket = vi.fn(() => {
    _socket = new FakeSocket();
    return _socket as unknown as Socket;
  });
  const currentFakeSocket = () => _socket!;
  return { mockCreateClientSocket, currentFakeSocket };
});

vi.mock('./createClientSocket', () => ({ createClientSocket: mockCreateClientSocket }));
vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
    useBound: vi.fn((fn: Function) => fn),
    useId: vi.fn(() => 'test-id'),
    useLogger: vi.fn(() => ({
      info: vi.fn(), debug: vi.fn(), error: vi.fn(), silly: vi.fn(),
      warn: vi.fn(), always: vi.fn(),
    })),
    useMap: vi.fn(() => new Map()),
    useOnUnmount: vi.fn(),
  };
});

import { SocketContext } from './SocketContext';
import { SocketProvider } from './SocketProvider';

// ── helpers ───────────────────────────────────────────────────────────────────

type CapturedContext = typeof SocketContext extends React.Context<infer T> ? T : never;

function CaptureContext({ onCapture }: { onCapture: (ctx: CapturedContext) => void }) {
  const ctx = useContext(SocketContext);
  React.useEffect(() => { onCapture(ctx); }, [ctx]);
  return null;
}

function renderProvider(props: Partial<React.ComponentProps<typeof SocketProvider>> = {}) {
  let capturedCtx: CapturedContext | undefined;
  render(
    React.createElement(SocketProvider as any, { name: 'test', autoConnect: false, ...props },
      React.createElement(CaptureContext, { onCapture: ctx => { capturedCtx = ctx; } }),
    ),
  );
  return { getCtx: () => capturedCtx! };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SocketProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('provides a context with name matching the prop', async () => {
    const { getCtx } = renderProvider({ name: 'my-api' });
    await act(async () => {});
    expect(getCtx().name).toBe('my-api');
  });

  it('does not call createClientSocket when autoConnect is false and connect() has not been called', async () => {
    renderProvider({ autoConnect: false });
    await act(async () => {});
    expect(mockCreateClientSocket).not.toHaveBeenCalled();
  });

  it('getSocket() returns undefined before connect()', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});
    expect(getCtx().getSocket()).toBeUndefined();
  });

  it('connect() resolves when the socket emits "connect"', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    let resolved = false;
    act(() => {
      getCtx().connect().then(() => { resolved = true; });
    });

    await act(async () => {
      currentFakeSocket()?.connect();
    });

    expect(resolved).toBe(true);
  });

  it('waitForAuthCheck() resolves immediately when authCheck already completed', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    act(() => { getCtx().connect(); });
    await act(async () => {
      const socket = currentFakeSocket();
      socket?.connect();
      socket?.emit('nexus:authCheckComplete');
    });

    const p = getCtx().waitForAuthCheck();
    await expect(p).resolves.toBeUndefined();
  });

  it('waitForAuthCheck() resolves after timeout when authCheckComplete is never emitted', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    act(() => { getCtx().connect(); });
    await act(async () => { currentFakeSocket()?.connect(); });

    let resolved = false;
    act(() => { getCtx().waitForAuthCheck().then(() => { resolved = true; }); });

    // Advance past the 10-second AUTH_CHECK_TIMEOUT_MS
    await act(async () => { vi.advanceTimersByTime(11_000); });

    expect(resolved).toBe(true);
  });

  it('exclusive handler conflict throws when registering two useServerActionHandler for same event', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    const ctx = getCtx();
    ctx.onExclusive('hook-a', 'myEvent', vi.fn());
    expect(() => ctx.onExclusive('hook-b', 'myEvent', vi.fn())).toThrow(InternalError);
  });

  it('exclusive and multicast conflict throws when adding a multicast listener to an exclusive event', async () => {
    const { getCtx } = renderProvider({ autoConnect: false });
    await act(async () => {});

    const ctx = getCtx();
    ctx.onExclusive('hook-a', 'exclusiveEvent', vi.fn());
    expect(() => ctx.on('hook-b', 'exclusiveEvent', vi.fn())).toThrow(InternalError);
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
pnpm test src/client/providers/socket/SocketProvider.tests.tsx
```

Expected: All 8 tests pass. If `useMap` mock causes issues, adjust to return a `new Map()` that also has `forEach` and `entries` — or use the real `useMap` from `@anupheaus/react-ui` by not mocking it.

- [ ] **Step 3: Commit**

```powershell
git add src/client/providers/socket/SocketProvider.tests.tsx
git commit -m "test: add SocketProvider connect lifecycle, auth-check timeout, and handler conflict tests"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

```powershell
pnpm test
```

Expected: All existing tests pass AND all new tests introduced in Tasks 1–11 pass. Zero regressions.

- [ ] **Step 2: Confirm test count summary**

The audit identified 12 gaps. Check that the following are all green:
- `createAsyncContext.tests.ts` renamed ✓
- `deconstruct.tests.ts` and `reconstruct.tests.ts` strengthened ✓
- `SocketIOParser.encode-decode.tests.ts` created ✓
- `createServerHandler.tests.ts` extended ✓
- `createSecurityMiddleware.tests.ts` strengthened ✓
- `signinAction.tests.ts` extended ✓
- `googleConfigAction.tests.ts` created ✓
- `setupKoa.tests.ts` created ✓
- `setupSocket.tests.ts` created ✓
- `useSocket.tests.ts` created ✓
- `SocketProvider.tests.tsx` created ✓
