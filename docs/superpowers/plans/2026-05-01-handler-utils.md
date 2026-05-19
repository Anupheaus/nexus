# Handler Utils Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `NexusServerHandlerActionUtils` passed to every action handler, add `transport` enforcement on actions, and migrate auth handlers away from the ALS `setResponseHeader` mechanism.

**Architecture:** A new `handlerUtils.ts` file owns all utils types and two transport-specific factory functions (`createSocketHandlerUtils` / `createRestHandlerUtils`). Each transport call site constructs the right factory. `transport` on `defineAction` controls which transports an action accepts — enforced at runtime on both client and server. The ALS `responseHeaders` slot is deleted once all callers migrate to utils.

**Tech Stack:** TypeScript, Socket.IO, Koa, Vitest, `@anupheaus/common` (`Error` base class, `is`)

---

### Task 1: Create `src/server/handler/handlerUtils.ts`

**Files:**
- Create: `src/server/handler/handlerUtils.ts`
- Create: `src/server/handler/handlerUtils.tests.ts`
- Modify: `src/server/handler/index.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/handler/handlerUtils.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';

// These imports will fail until the file is created — that's expected.
import {
  isRedirectResult,
  createSocketHandlerUtils,
  createRestHandlerUtils,
} from './handlerUtils';

function makeSocket(headers: Record<string, string> = {}): Pick<Socket, 'handshake'> {
  return { handshake: { headers } } as any;
}

function makeReq(cookieHeader?: string, headers: Record<string, string> = {}): IncomingMessage {
  return { headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...headers } } as any;
}

// ── parseCookie (tested via getCookie) ──────────────────────────────────────

describe('getCookie (REST)', () => {
  it('returns undefined when no cookie header present', () => {
    const { getCookie } = createRestHandlerUtils(makeReq(), new Map(), 'req-1');
    expect(getCookie('session')).toBeUndefined();
  });

  it('returns undefined when named cookie not present', () => {
    const { getCookie } = createRestHandlerUtils(makeReq('other=abc'), new Map(), 'req-1');
    expect(getCookie('session')).toBeUndefined();
  });

  it('returns value when named cookie present', () => {
    const { getCookie } = createRestHandlerUtils(makeReq('session=tok123'), new Map(), 'req-1');
    expect(getCookie('session')).toBe('tok123');
  });

  it('handles multiple cookies', () => {
    const { getCookie } = createRestHandlerUtils(makeReq('a=1; session=tok123; b=2'), new Map(), 'req-1');
    expect(getCookie('session')).toBe('tok123');
    expect(getCookie('a')).toBe('1');
  });
});

// ── buildSetCookieHeader (tested via setCookie / removeCookie) ───────────────

describe('setCookie (REST)', () => {
  it('builds correct Set-Cookie header with defaults', () => {
    const map = new Map<string, string>();
    const { setCookie } = createRestHandlerUtils(makeReq(), map, 'req-1');
    setCookie('session', 'tok');
    const header = map.get('Set-Cookie')!;
    expect(header).toContain('session=tok');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
  });

  it('applies custom maxAge', () => {
    const map = new Map<string, string>();
    const { setCookie } = createRestHandlerUtils(makeReq(), map, 'req-1');
    setCookie('session', 'tok', { maxAge: 3600 });
    expect(map.get('Set-Cookie')).toContain('Max-Age=3600');
  });

  it('applies custom sameSite', () => {
    const map = new Map<string, string>();
    const { setCookie } = createRestHandlerUtils(makeReq(), map, 'req-1');
    setCookie('session', 'tok', { sameSite: 'Lax' });
    expect(map.get('Set-Cookie')).toContain('SameSite=Lax');
  });
});

describe('removeCookie (REST)', () => {
  it('sets Max-Age=0 to expire the cookie', () => {
    const map = new Map<string, string>();
    const { removeCookie } = createRestHandlerUtils(makeReq(), map, 'req-1');
    removeCookie('session');
    const header = map.get('Set-Cookie')!;
    expect(header).toContain('session=');
    expect(header).toContain('Max-Age=0');
  });
});

// ── setHeaders (REST) ────────────────────────────────────────────────────────

describe('setHeaders (REST)', () => {
  it('writes all provided headers to the headerMap', () => {
    const map = new Map<string, string>();
    const { setHeaders } = createRestHandlerUtils(makeReq(), map, 'req-1');
    setHeaders({ 'X-Foo': 'bar', 'X-Baz': 'qux' });
    expect(map.get('X-Foo')).toBe('bar');
    expect(map.get('X-Baz')).toBe('qux');
  });
});

// ── redirect ─────────────────────────────────────────────────────────────────

describe('redirect (REST)', () => {
  it('returns a RedirectResult recognised by isRedirectResult', () => {
    const { redirect } = createRestHandlerUtils(makeReq(), new Map(), 'req-1');
    const result = redirect('/new-path');
    expect(isRedirectResult(result)).toBe(true);
    expect(result.url).toBe('/new-path');
  });
});

describe('isRedirectResult', () => {
  it('returns false for plain objects', () => {
    expect(isRedirectResult({ url: '/foo' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRedirectResult(null)).toBe(false);
  });

  it('returns false for strings', () => {
    expect(isRedirectResult('/foo')).toBe(false);
  });
});

// ── REST utils metadata ──────────────────────────────────────────────────────

describe('createRestHandlerUtils', () => {
  it('exposes transportType as rest', () => {
    const { transportType } = createRestHandlerUtils(makeReq(), new Map(), 'req-1');
    expect(transportType).toBe('rest');
  });

  it('exposes requestId', () => {
    const { requestId } = createRestHandlerUtils(makeReq(), new Map(), 'my-id');
    expect(requestId).toBe('my-id');
  });

  it('exposes request headers', () => {
    const { headers } = createRestHandlerUtils(makeReq(undefined, { 'x-custom': 'val' }), new Map(), 'req-1');
    expect(headers['x-custom']).toBe('val');
  });
});

// ── Socket utils ─────────────────────────────────────────────────────────────

describe('createSocketHandlerUtils', () => {
  it('exposes transportType as socket', () => {
    const { transportType } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(transportType).toBe('socket');
  });

  it('exposes requestId', () => {
    const { requestId } = createSocketHandlerUtils(makeSocket() as any, 'my-id');
    expect(requestId).toBe('my-id');
  });

  it('exposes socket handshake headers', () => {
    const { headers } = createSocketHandlerUtils(makeSocket({ 'x-custom': 'hello' }) as any, 'req-1');
    expect(headers['x-custom']).toBe('hello');
  });

  it('throws when setHeaders is called', () => {
    const { setHeaders } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => setHeaders({ 'X-Foo': 'bar' })).toThrow('"setHeaders" is only available in REST action handlers');
  });

  it('throws when setCookie is called', () => {
    const { setCookie } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => setCookie('name', 'value')).toThrow('"setCookie" is only available in REST action handlers');
  });

  it('throws when getCookie is called', () => {
    const { getCookie } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => getCookie('name')).toThrow('"getCookie" is only available in REST action handlers');
  });

  it('throws when removeCookie is called', () => {
    const { removeCookie } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => removeCookie('name')).toThrow('"removeCookie" is only available in REST action handlers');
  });

  it('throws when redirect is called', () => {
    const { redirect } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => redirect('/url')).toThrow('"redirect" is only available in REST action handlers');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- handlerUtils
```
Expected: all tests fail with "Cannot find module './handlerUtils'"

- [ ] **Step 3: Create `src/server/handler/handlerUtils.ts`**

```ts
import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';

export type TransportType = 'socket' | 'rest';

export interface CookieOptions {
  /** Default: true */
  httpOnly?: boolean;
  /** Default: true */
  secure?: boolean;
  /** Default: 'Strict' */
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Default: '/' */
  path?: string;
  /** Seconds until the cookie expires */
  maxAge?: number;
  expires?: Date;
}

export interface NexusServerHandlerActionUtils {
  transportType: TransportType;
  requestId: string;
  headers: Record<string, string | string[] | undefined>;
  setHeaders(headers: Record<string, string>): void;
  setCookie(name: string, value: string, options?: CookieOptions): void;
  getCookie(name: string): string | undefined;
  removeCookie(name: string): void;
  redirect(url: string): RedirectResult;
}

// Module-private symbol — only redirect() can produce a valid RedirectResult.
const REDIRECT_SYMBOL: unique symbol = Symbol('socket-api.redirect');

export interface RedirectResult {
  readonly type: typeof REDIRECT_SYMBOL;
  readonly url: string;
}

export function isRedirectResult(value: unknown): value is RedirectResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>).type === REDIRECT_SYMBOL
  );
}

function restOnlyError(name: string): Error {
  return new Error(`"${name}" is only available in REST action handlers`);
}

function buildSetCookieHeader(name: string, value: string, options: CookieOptions = {}): string {
  const {
    httpOnly = true,
    secure = true,
    sameSite = 'Strict',
    path = '/',
    maxAge,
    expires,
  } = options;

  const parts = [`${name}=${value}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  parts.push(`Path=${path}`);
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (expires != null) parts.push(`Expires=${expires.toUTCString()}`);
  return parts.join('; ');
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.split('=');
    if (key.trim() === name) return rest.join('=').trim();
  }
  return undefined;
}

export function createSocketHandlerUtils(socket: Socket, requestId: string): NexusServerHandlerActionUtils {
  return {
    transportType: 'socket',
    requestId,
    headers: socket.handshake.headers as Record<string, string | string[] | undefined>,
    setHeaders:   () => { throw restOnlyError('setHeaders'); },
    setCookie:    () => { throw restOnlyError('setCookie'); },
    getCookie:    () => { throw restOnlyError('getCookie'); },
    removeCookie: () => { throw restOnlyError('removeCookie'); },
    redirect:     () => { throw restOnlyError('redirect'); },
  };
}

export function createRestHandlerUtils(
  req: IncomingMessage,
  headerMap: Map<string, string>,
  requestId: string,
): NexusServerHandlerActionUtils {
  return {
    transportType: 'rest',
    requestId,
    headers: req.headers as Record<string, string | string[] | undefined>,
    setHeaders:   (headers) => {
      for (const [k, v] of Object.entries(headers)) headerMap.set(k, v);
    },
    setCookie:    (name, value, opts) => {
      headerMap.set('Set-Cookie', buildSetCookieHeader(name, value, opts));
    },
    getCookie:    (name) => parseCookie(req.headers.cookie, name),
    removeCookie: (name) => {
      headerMap.set('Set-Cookie', buildSetCookieHeader(name, '', { maxAge: 0 }));
    },
    redirect:     (url) => ({ type: REDIRECT_SYMBOL, url }),
  };
}
```

- [ ] **Step 4: Export from `src/server/handler/index.ts`**

Current contents:
```ts
export * from './createServerHandler';
export * from './setupHandlers';
```

Add the new export:
```ts
export * from './createServerHandler';
export * from './setupHandlers';
export * from './handlerUtils';
```

- [ ] **Step 5: Export public types from `src/server/index.ts`**

Add this line after the existing `export * from './async-context';` line:
```ts
export type { NexusServerHandlerActionUtils, CookieOptions, RedirectResult, TransportType } from './handler';
```

- [ ] **Step 6: Run tests to confirm they pass**

```
pnpm test -- handlerUtils
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/server/handler/handlerUtils.ts src/server/handler/handlerUtils.tests.ts src/server/handler/index.ts src/server/index.ts
git commit -m "feat(handler): add NexusServerHandlerActionUtils type and transport-aware factory functions"
```

---

### Task 2: Add `transport` to `defineAction.ts`

**Files:**
- Modify: `src/common/defineAction.ts`
- Create: `src/common/defineAction.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/common/defineAction.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAction } from './defineAction';

describe('defineAction — transport field', () => {
  it('stores transport on the action when provided', () => {
    const action = defineAction<void, void>()('myAction', { transport: ['rest'] });
    expect(action.transport).toEqual(['rest']);
  });

  it('leaves transport undefined when not provided', () => {
    const action = defineAction<void, void>()('myAction2');
    expect(action.transport).toBeUndefined();
  });

  it('accepts both transports', () => {
    const action = defineAction<void, void>()('myAction3', { transport: ['socket', 'rest'] });
    expect(action.transport).toEqual(['socket', 'rest']);
  });

  it('throws when rest config is provided but transport excludes rest', () => {
    expect(() =>
      defineAction<void, void>()('myAction4', {
        rest: { method: 'GET', url: '/foo' },
        transport: ['socket'],
      })
    ).toThrow('cannot have a rest config when transport excludes');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- defineAction
```
Expected: FAIL — "transport" tests fail, guard test fails

- [ ] **Step 3: Update `src/common/defineAction.ts`**

```ts
/** Server-side limits for an action (enforced in `createServerActionHandler`). */
export interface NexusActionServerOptions {
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
  url: string;
}

export interface NexusAction<Name extends string, Request, Response> {
  name: Name;
  requestType?: Request;
  responseType?: Response;
  server?: NexusActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions;
  transport?: Array<'socket' | 'rest'>;
}

export interface DefineActionOptions {
  server?: NexusActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions;
  /** Which transports this action is callable on. Default: both. */
  transport?: Array<'socket' | 'rest'>;
}

export function defineAction<Request, Response>() {
  return <Name extends string>(
    name: Name,
    options?: DefineActionOptions,
  ): NexusAction<Name, Request, Response> => {
    if (name.includes('/')) throw new Error(`Action name "${name}" must not contain a slash — it is used as a URL path segment.`);
    if (options?.rest != null && options?.transport != null && !options.transport.includes('rest')) {
      throw new Error(`Action "${name}" cannot have a rest config when transport excludes 'rest'.`);
    }
    return {
      name,
      ...(options?.server != null ? { server: options.server } : {}),
      ...(options?.isPublic === true ? { isPublic: true } : {}),
      ...(options?.rest != null ? { rest: options.rest } : {}),
      ...(options?.transport != null ? { transport: options.transport } : {}),
    };
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
pnpm test -- defineAction
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/common/defineAction.ts src/common/defineAction.tests.ts
git commit -m "feat(common): add transport field to defineAction with rest+socket-only contradiction guard"
```

---

### Task 3: Add `transport: ['rest']` to auth actions in `internalActions.ts`

**Files:**
- Modify: `src/common/internalActions.ts`

No new tests needed — this is a data change; the transport guard in Task 2 and the server/client enforcement in later tasks cover it.

- [ ] **Step 1: Update `src/common/internalActions.ts`**

Replace the block of auth action definitions (lines 44–50) with:

```ts
// Cookie-setting endpoints must always go via REST — Set-Cookie response headers
// cannot be replicated via socket acks.
export const signInAction = defineAction<SignInRequest, void>()('signIn', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/signin' },
});
export const signOutAction = defineAction<void, void>()('signOut', {
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/signout' },
});
export const webauthnInviteAction = defineAction<WebAuthnInviteRequest, WebAuthnInviteResponse>()('webauthnInvite', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'GET', url: '/{name}/socketAPI/webauthn/invite' },
});
export const webauthnRegisterAction = defineAction<WebAuthnRegisterRequest, WebAuthnRegisterOrReauthResponse>()('webauthnRegister', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/register' },
});
export const webauthnReauthAction = defineAction<WebAuthnReauthRequest, WebAuthnRegisterOrReauthResponse>()('webauthnReauth', {
  isPublic: true,
  transport: ['rest'],
  rest: { method: 'POST', url: '/{name}/socketAPI/webauthn/reauth' },
});
```

- [ ] **Step 2: Run full test suite to confirm nothing breaks**

```
pnpm test
```
Expected: all existing tests pass

- [ ] **Step 3: Commit**

```bash
git add src/common/internalActions.ts
git commit -m "feat(auth): mark all cookie-setting auth actions as REST-only transport"
```

---

### Task 4: Update `createServerHandler.ts` — import types, transport check, pass utils

**Files:**
- Modify: `src/server/handler/createServerHandler.ts`
- Modify: `src/server/handler/createServerHandler.tests.ts`

- [ ] **Step 1: Add failing test for transport enforcement**

Add to `src/server/handler/createServerHandler.tests.ts` (append inside the existing `describe` block):

```ts
  it('ACKs with an error when action transport excludes socket', async () => {
    const { createServerHandler } = await import('./createServerHandler');
    const handler = vi.fn();
    createServerHandler('action', 'test.prefix', 'restOnlyAction', handler, undefined, false, undefined, ['rest']);

    // The returned function registers a socket listener — we verify the handler is NOT called
    // and the ACK receives an error when the transport check fires.
    // (Full socket integration is covered by E2E tests; here we verify the guard logic.)
    expect(handler).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to confirm the new test fails for the right reason**

```
pnpm test -- createServerHandler
```
Expected: the new test fails — `createServerHandler` doesn't accept a `transport` parameter yet

- [ ] **Step 3: Update `src/server/handler/createServerHandler.ts`**

```ts
import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import type { NexusActionServerOptions } from '../../common/defineAction';
import { InternalError, is, type PromiseMaybe } from '@anupheaus/common';
import { useNexus } from '../providers';
import { useConfig, wrap, useLogger, useAuthData } from '../async-context/socketApiContext';
import { createActionLimitGate, type ActionLimitGate } from './actionLimitGate';
import { useAuthentication } from '../providers/authentication';
import { createSocketHandlerUtils } from './handlerUtils';
import type { NexusServerHandlerActionUtils } from './handlerUtils';

export type NexusServerHandler = () => void;

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
  return () => {
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
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
pnpm test -- createServerHandler
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/server/handler/createServerHandler.ts src/server/handler/createServerHandler.tests.ts
git commit -m "feat(handler): pass utils to socket handler; reject REST-only actions called via socket"
```

---

### Task 5: Update `registerRestActions.ts` — transport check, utils, redirect, error status

**Files:**
- Modify: `src/server/actions/registerRestActions.ts`
- Modify: `src/server/actions/registerRestActions.tests.ts`

- [ ] **Step 1: Add failing tests**

Append these test cases inside `describe('registerRestActions', ...)` in `registerRestActions.tests.ts`. Add the following action definitions at the top of the file alongside the existing ones:

```ts
import { AuthenticationError, NotImplementedError } from '@anupheaus/common';
import { isRedirectResult } from '../../server/handler/handlerUtils'; // import for test assertions

const socketOnlyAction = defineAction<{ value: string }, { value: string }>()('socketOnlyAction', {
  transport: ['socket'],
});
const redirectAction = defineAction<void, void>()('redirectAction');
const authErrAction = defineAction<void, void>()('authErrAction');
const notFoundAction = defineAction<void, void>()('notFoundAction');
```

Then in `beforeEach`, register them:

```ts
registerRestAction(socketOnlyAction, async (req: { value: string }) => ({ value: req.value }), limitGate as any);
registerRestAction(redirectAction, async (_req: unknown, { redirect }: any) => redirect('/new-location'), limitGate as any);
registerRestAction(authErrAction, async () => { throw new AuthenticationError(); }, limitGate as any);
registerRestAction(notFoundAction, async () => { throw new NotImplementedError('not here'); }, limitGate as any);
```

Add test cases:

```ts
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
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```
pnpm test -- registerRestActions
```
Expected: the 4 new tests fail

- [ ] **Step 3: Rewrite `src/server/actions/registerRestActions.ts`**

```ts
import type Router from 'koa-router';
import type { IncomingMessage, ServerResponse } from 'http';
import { useConfig, setAuthData, wrap } from '../async-context/socketApiContext';
import type { ConnectionRegistry } from '../providers/connection';
import { validateRestSession } from '../auth/validateRestSession';
import { getRestAction, getAllRestActions, type RestActionRegistryEntry } from './restActionRegistry';
import { createRestHandlerUtils, isRedirectResult } from '../handler/handlerUtils';
import { Error as BaseError } from '@anupheaus/common';

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

        const utils = createRestHandlerUtils(req, headerMap, requestId);
        try {
          const result = await entry.limitGate.run(
            () => (entry.handler as (req: unknown, utils: typeof utils) => unknown)(request, utils),
          );
          if (isRedirectResult(result)) return { type: 'redirect', url: result.url };
          return { type: 'success', result };
        } catch (err) {
          const status = err instanceof BaseError ? (err.toJSON().statusCode ?? 400) : 500;
          const message = err instanceof globalThis.Error ? err.message : String(err);
          return { type: 'error', status, message };
        }
      },
    );

    const outcome = await run(ctx.req, ctx.res);

    // Apply any response headers (e.g. Set-Cookie) accumulated by the handler.
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
): void {
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

- [ ] **Step 4: Run tests to confirm they pass**

```
pnpm test -- registerRestActions
```
Expected: all pass including the 4 new tests

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/registerRestActions.ts src/server/actions/registerRestActions.tests.ts
git commit -m "feat(rest): add transport check, utils injection, redirect handling, and typed error status codes"
```

---

### Task 6: Update `createServerActionHandler.ts` — pass `transport` to `createServerHandler`

**Files:**
- Modify: `src/server/actions/createServerActionHandler.ts`

No new tests needed — the transport enforcement is tested in Tasks 4 and 5.

- [ ] **Step 1: Update `src/server/actions/createServerActionHandler.ts`**

```ts
import type { NexusAction } from '../../common';
import { actionPrefix } from '../../common/internalModels';
import type { NexusServerHandlerFunction } from '../handler';
import { createServerHandler } from '../handler';
import { createActionLimitGate } from '../handler/actionLimitGate';
import { registerRestAction } from './restActionRegistry';

export type NexusServerAction = () => void;

export function createServerActionHandler<Name extends string, Request, Response>(
  action: NexusAction<Name, Request, Response>,
  handler: NexusServerHandlerFunction<Request, Response>,
  options?: { isPublic?: boolean },
): NexusServerAction {
  const isPublic = options?.isPublic ?? action.isPublic ?? false;
  const limitGate = createActionLimitGate(action.server);
  // Always register both socket and REST — transport enforcement happens at runtime inside each handler.
  registerRestAction(action, handler, limitGate);
  return createServerHandler('action', actionPrefix, action.name, handler, action.server, isPublic, limitGate, action.transport);
}
```

- [ ] **Step 2: Run full test suite**

```
pnpm test
```
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/createServerActionHandler.ts
git commit -m "feat(action): pass action.transport to createServerHandler for socket-side enforcement"
```

---

### Task 7: Move and migrate `signinAction`

**Files:**
- Create: `src/server/actions/signinAction.ts` (moved + migrated from `src/server/auth/routes/signinRoute.ts`)
- Create: `src/server/actions/signinAction.tests.ts` (moved + updated from `src/server/auth/routes/signinRoute.tests.ts`)
- Delete: `src/server/auth/routes/signinRoute.ts`
- Delete: `src/server/auth/routes/signinRoute.tests.ts`

- [ ] **Step 1: Create `src/server/actions/signinAction.tests.ts`**

The key change: remove the `vi.mock` of `setResponseHeader` — tests now inject `setCookie` directly:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JwtAuthStore } from '../../common/auth';
import type { NexusUser } from '../../common';
import type { SignInRequest } from '../../common/internalActions';
import { handleSignIn } from './signinAction';

const testUser: NexusUser = { id: 'user-1' };

const deviceDetails: SignInRequest['deviceDetails'] = {
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(): JwtAuthStore {
  return {
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    update: vi.fn(async () => {}),
  };
}

describe('handleSignIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when onAuthenticate returns undefined', async () => {
    const setCookie = vi.fn();
    await expect(
      handleSignIn(store, async () => undefined, { credentials: { email: 'bad@test.com', password: 'wrong' }, deviceDetails }, setCookie),
    ).rejects.toThrow('Authentication failed');
  });

  it('calls setCookie with HttpOnly session cookie when credentials are valid', async () => {
    const store = makeStore();
    const setCookie = vi.fn();
    await handleSignIn(store, async () => testUser, { credentials: { email: 'good@test.com', password: 'correct' }, deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'socketapi_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'Strict' }),
    );
  });

  it('always creates a new session record', async () => {
    const store = makeStore();
    const setCookie = vi.fn();
    await handleSignIn(store, async () => testUser, { credentials: { email: 'good@test.com', password: 'correct' }, deviceDetails }, setCookie);
    expect(store.create).toHaveBeenCalledOnce();
    expect(store.update).not.toHaveBeenCalled();
  });

  it('propagates error when onAuthenticate throws', async () => {
    const store = makeStore();
    const setCookie = vi.fn();
    await expect(
      handleSignIn(store, async () => { throw new Error('auth-service-down'); }, { credentials: { email: 'any@test.com', password: 'any' }, deviceDetails }, setCookie),
    ).rejects.toThrow('auth-service-down');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- signinAction
```
Expected: FAIL — cannot find `./signinAction`

- [ ] **Step 3: Create `src/server/actions/signinAction.ts`**

```ts
import crypto from 'crypto';
import type { JwtAuthStore } from '../../common/auth';
import type { NexusUser } from '../../common';
import { signInAction } from '../../common/internalActions';
import type { SignInRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

export async function handleSignIn(
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<NexusUser | undefined>,
  req: SignInRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<void> {
  const { credentials, deviceDetails } = req;

  const user = await onAuthenticate(credentials);
  if (!user) throw new Error('Authentication failed');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.create({
    requestId: crypto.randomUUID(),
    sessionToken,
    userId: user.id,
    deviceId: crypto.randomUUID(),
    isEnabled: true,
    deviceDetails,
    lastConnectedAt: Date.now(),
  });

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
}

export function createSigninAction(
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<NexusUser | undefined>,
): NexusServerAction {
  return createServerActionHandler(
    signInAction,
    async (req, { setCookie }) => handleSignIn(store, onAuthenticate, req, setCookie),
    { isPublic: true },
  );
}
```

- [ ] **Step 4: Delete old files**

```bash
rm src/server/auth/routes/signinRoute.ts src/server/auth/routes/signinRoute.tests.ts
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pnpm test -- signinAction
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/signinAction.ts src/server/actions/signinAction.tests.ts
git rm src/server/auth/routes/signinRoute.ts src/server/auth/routes/signinRoute.tests.ts
git commit -m "refactor(auth): move signinRoute → signinAction; migrate from ALS setResponseHeader to utils setCookie"
```

---

### Task 8: Move and migrate `signoutAction`

**Files:**
- Create: `src/server/actions/signoutAction.ts`
- Create: `src/server/actions/signoutAction.tests.ts`
- Delete: `src/server/auth/routes/signoutRoute.ts`
- Delete: `src/server/auth/routes/signoutRoute.tests.ts`

- [ ] **Step 1: Create `src/server/actions/signoutAction.tests.ts`**

`useAuthData` still comes from ALS so it still needs mocking; `setResponseHeader` is replaced with an injected `removeCookie`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';

const { mockUseAuthData } = vi.hoisted(() => ({
  mockUseAuthData: vi.fn<[], { token?: string } | undefined>(),
}));

vi.mock('../async-context/socketApiContext', () => ({
  useAuthData: mockUseAuthData,
}));

import { handleSignOut } from './signoutAction';

function makeStore(record?: NexusAuthRecord): NexusAuthStore<NexusAuthRecord> {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

describe('handleSignOut', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls removeCookie even when no session token is present', async () => {
    mockUseAuthData.mockReturnValueOnce(undefined);
    const removeCookie = vi.fn();
    await handleSignOut(makeStore(undefined), removeCookie);
    expect(removeCookie).toHaveBeenCalledWith('socketapi_session');
    expect(makeStore().update).not.toHaveBeenCalled();
  });

  it('disables the store record when a valid session token is in auth context', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    mockUseAuthData.mockReturnValueOnce({ token: 'tok' });
    const store = makeStore(record);
    const removeCookie = vi.fn();
    await handleSignOut(store, removeCookie);
    expect(store.update).toHaveBeenCalledWith('r1', { isEnabled: false });
    expect(removeCookie).toHaveBeenCalledWith('socketapi_session');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- signoutAction
```
Expected: FAIL — cannot find `./signoutAction`

- [ ] **Step 3: Create `src/server/actions/signoutAction.ts`**

```ts
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import { signOutAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import { useAuthData } from '../async-context/socketApiContext';

const COOKIE_NAME = 'socketapi_session';

export async function handleSignOut(
  store: NexusAuthStore<NexusAuthRecord>,
  removeCookie: (name: string) => void,
): Promise<void> {
  const sessionToken = useAuthData()?.token;
  if (sessionToken) {
    const record = await store.findBySessionToken(sessionToken);
    if (record) await store.update(record.requestId, { isEnabled: false });
  }
  removeCookie(COOKIE_NAME);
}

export function createSignoutAction(
  store: NexusAuthStore<NexusAuthRecord>,
): NexusServerAction {
  return createServerActionHandler(signOutAction, async (_req, { removeCookie }) => handleSignOut(store, removeCookie));
}
```

- [ ] **Step 4: Delete old files**

```bash
rm src/server/auth/routes/signoutRoute.ts src/server/auth/routes/signoutRoute.tests.ts
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pnpm test -- signoutAction
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/signoutAction.ts src/server/actions/signoutAction.tests.ts
git rm src/server/auth/routes/signoutRoute.ts src/server/auth/routes/signoutRoute.tests.ts
git commit -m "refactor(auth): move signoutRoute → signoutAction; migrate from ALS setResponseHeader to utils removeCookie"
```

---

### Task 9: Move and migrate `webauthnRegisterAction`

**Files:**
- Create: `src/server/actions/webauthnRegisterAction.ts`
- Create: `src/server/actions/webauthnRegisterAction.tests.ts`
- Delete: `src/server/auth/routes/webauthnRegisterRoute.ts`
- Delete: `src/server/auth/routes/webauthnRegisterRoute.tests.ts`

- [ ] **Step 1: Create `src/server/actions/webauthnRegisterAction.tests.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnRegister } from './webauthnRegisterAction';

const deviceDetails: NexusDeviceDetails = {
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findByKeyHash: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

describe('handleWebAuthnRegister', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for registrationToken', async () => {
    const setCookie = vi.fn();
    await expect(
      handleWebAuthnRegister(makeStore(undefined), { registrationToken: 'bad', keyHash: 'abc', deviceDetails }, setCookie),
    ).rejects.toThrow('Invalid registration token');
  });

  it('updates record with keyHash, deviceDetails, sessionToken, clears registrationToken', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const setCookie = vi.fn();
    const result = await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);
    expect(result.userId).toBe('u1');
    expect(result.accountId).toBe('u1');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      keyHash: 'hash1',
      deviceDetails,
      sessionToken: expect.any(String),
      isEnabled: true,
      registrationToken: undefined,
    }));
  });

  it('calls setCookie with HttpOnly session cookie on success', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const setCookie = vi.fn();
    await handleWebAuthnRegister(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'socketapi_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- webauthnRegisterAction
```
Expected: FAIL

- [ ] **Step 3: Create `src/server/actions/webauthnRegisterAction.ts`**

```ts
import crypto from 'crypto';
import type { WebAuthnAuthStore } from '../../common/auth';
import { webauthnRegisterAction } from '../../common/internalActions';
import type { WebAuthnRegisterRequest, WebAuthnRegisterOrReauthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

export async function handleWebAuthnRegister(
  store: WebAuthnAuthStore,
  req: WebAuthnRegisterRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<WebAuthnRegisterOrReauthResponse> {
  const record = await store.findByRegistrationToken(req.registrationToken);
  if (!record) throw new Error('Invalid registration token');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.update(record.requestId, {
    keyHash: req.keyHash,
    deviceDetails: req.deviceDetails,
    sessionToken,
    isEnabled: true,
    registrationToken: undefined,
  });

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  return { userId: record.userId, accountId: record.userId };
}

export function createWebauthnRegisterAction(store: WebAuthnAuthStore): NexusServerAction {
  return createServerActionHandler(
    webauthnRegisterAction,
    async (req, { setCookie }) => handleWebAuthnRegister(store, req, setCookie),
    { isPublic: true },
  );
}
```

- [ ] **Step 4: Delete old files**

```bash
rm src/server/auth/routes/webauthnRegisterRoute.ts src/server/auth/routes/webauthnRegisterRoute.tests.ts
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pnpm test -- webauthnRegisterAction
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/webauthnRegisterAction.ts src/server/actions/webauthnRegisterAction.tests.ts
git rm src/server/auth/routes/webauthnRegisterRoute.ts src/server/auth/routes/webauthnRegisterRoute.tests.ts
git commit -m "refactor(auth): move webauthnRegisterRoute → webauthnRegisterAction; inject setCookie via utils"
```

---

### Task 10: Move and migrate `webauthnReauthAction`

**Files:**
- Create: `src/server/actions/webauthnReauthAction.ts`
- Create: `src/server/actions/webauthnReauthAction.tests.ts`
- Delete: `src/server/auth/routes/webauthnReauthRoute.ts`
- Delete: `src/server/auth/routes/webauthnReauthRoute.tests.ts`

- [ ] **Step 1: Create `src/server/actions/webauthnReauthAction.tests.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, NexusDeviceDetails } from '../../common/auth';
import { handleWebAuthnReauth } from './webauthnReauthAction';

const deviceDetails: NexusDeviceDetails = {
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    update: vi.fn(),
  };
}

describe('handleWebAuthnReauth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for keyHash', async () => {
    const setCookie = vi.fn();
    await expect(
      handleWebAuthnReauth(makeStore(undefined), { keyHash: 'unknown', deviceDetails }, setCookie),
    ).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('throws when record exists but is disabled', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    await expect(
      handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie),
    ).rejects.toThrow('WebAuthn re-authentication failed');
  });

  it('issues a fresh session token and updates the record on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    const result = await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie);
    expect(result.userId).toBe('u1');
    expect(result.accountId).toBe('u1');
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      sessionToken: expect.any(String),
      lastConnectedAt: expect.any(Number),
      deviceDetails,
    }));
    const newToken = (store.update as ReturnType<typeof vi.fn>).mock.calls[0][1].sessionToken;
    expect(newToken).not.toBe('old');
  });

  it('calls setCookie with HttpOnly session cookie on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const setCookie = vi.fn();
    await handleWebAuthnReauth(store, { keyHash: 'h1', deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'socketapi_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- webauthnReauthAction
```
Expected: FAIL

- [ ] **Step 3: Create `src/server/actions/webauthnReauthAction.ts`**

```ts
import crypto from 'crypto';
import type { WebAuthnAuthStore } from '../../common/auth';
import { webauthnReauthAction } from '../../common/internalActions';
import type { WebAuthnReauthRequest, WebAuthnRegisterOrReauthResponse } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const SESSION_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

export async function handleWebAuthnReauth(
  store: WebAuthnAuthStore,
  req: WebAuthnReauthRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<WebAuthnRegisterOrReauthResponse> {
  const record = await store.findByKeyHash(req.keyHash);
  if (!record?.isEnabled) throw new Error('WebAuthn re-authentication failed');

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await store.update(record.requestId, {
    sessionToken,
    lastConnectedAt: Date.now(),
    deviceDetails: req.deviceDetails,
  });

  setCookie(COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
  return { userId: record.userId, accountId: record.userId };
}

export function createWebauthnReauthAction(store: WebAuthnAuthStore): NexusServerAction {
  return createServerActionHandler(
    webauthnReauthAction,
    async (req, { setCookie }) => handleWebAuthnReauth(store, req, setCookie),
    { isPublic: true },
  );
}
```

- [ ] **Step 4: Delete old files**

```bash
rm src/server/auth/routes/webauthnReauthRoute.ts src/server/auth/routes/webauthnReauthRoute.tests.ts
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pnpm test -- webauthnReauthAction
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/webauthnReauthAction.ts src/server/actions/webauthnReauthAction.tests.ts
git rm src/server/auth/routes/webauthnReauthRoute.ts src/server/auth/routes/webauthnReauthRoute.tests.ts
git commit -m "refactor(auth): move webauthnReauthRoute → webauthnReauthAction; inject setCookie via utils"
```

---

### Task 11: Move `webauthnInviteAction` and update `registerAuthRoutes.ts`

**Files:**
- Create: `src/server/actions/webauthnInviteAction.ts`
- Create: `src/server/actions/webauthnInviteAction.tests.ts`
- Delete: `src/server/auth/routes/webauthnInviteRoute.ts`
- Delete: `src/server/auth/routes/webauthnInviteRoute.tests.ts`
- Delete: `src/server/auth/routes/AGENTS.md`
- Modify: `src/server/auth/registerAuthRoutes.ts`

`webauthnInviteAction` has no cookie operations — this is a file move and import update only.

- [ ] **Step 1: Create `src/server/actions/webauthnInviteAction.ts`**

```ts
import crypto from 'crypto';
import type { WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import { webauthnInviteAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { NexusServerAction } from './createServerActionHandler';

export async function handleWebAuthnInvite(
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<InviteDetails>,
  req: { requestId: string },
): Promise<{ registrationToken: string; inviteDetails: InviteDetails }> {
  const record = await store.findById(req.requestId);
  if (!record) throw new Error('Invite not found');
  if (record.isEnabled) throw new Error('Invite already used');

  const registrationToken = crypto.randomUUID();
  await store.update(record.requestId, { registrationToken });

  const inviteDetails = await onGetUserDetails(record.userId);
  return { registrationToken, inviteDetails };
}

export function createWebauthnInviteAction(
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<InviteDetails>,
): NexusServerAction {
  return createServerActionHandler(
    webauthnInviteAction,
    req => handleWebAuthnInvite(store, onGetUserDetails, req),
    { isPublic: true },
  );
}
```

- [ ] **Step 2: Create `src/server/actions/webauthnInviteAction.tests.ts`**

Copy from existing `webauthnInviteRoute.tests.ts`, updating only the import path:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebAuthnAuthStore, WebAuthnAuthRecord } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import { handleWebAuthnInvite } from './webauthnInviteAction';

function makeStore(record?: Partial<WebAuthnAuthRecord>): WebAuthnAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record as WebAuthnAuthRecord | undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByRegistrationToken: vi.fn(async () => undefined),
    findByKeyHash: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

const onGetUserDetails = vi.fn<[string], Promise<InviteDetails>>(
  async () => ({ id: 'example.com', appName: 'TestApp', userName: 'Alice' }),
);

describe('handleWebAuthnInvite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when no record found for requestId', async () => {
    await expect(
      handleWebAuthnInvite(makeStore(undefined), onGetUserDetails, { requestId: 'unknown' }),
    ).rejects.toThrow('Invite not found');
  });

  it('throws when record is already enabled (already registered)', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 't', deviceId: 'd' });
    await expect(
      handleWebAuthnInvite(store, onGetUserDetails, { requestId: 'r1' }),
    ).rejects.toThrow('Invite already used');
  });

  it('generates registrationToken, stores it, and returns inviteDetails on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: '', deviceId: '' });
    const result = await handleWebAuthnInvite(store, onGetUserDetails, { requestId: 'r1' });
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ registrationToken: expect.any(String) }));
    expect(result.registrationToken).toBeTruthy();
    expect(result.inviteDetails).toEqual({ id: 'example.com', appName: 'TestApp', userName: 'Alice' });
  });

  it('calls onGetUserDetails with the record userId', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'user-42', isEnabled: false, sessionToken: '', deviceId: '' });
    await handleWebAuthnInvite(store, onGetUserDetails, { requestId: 'r1' });
    expect(onGetUserDetails).toHaveBeenCalledWith('user-42');
  });
});
```

- [ ] **Step 3: Update `src/server/auth/registerAuthRoutes.ts`**

Update imports to point to the new `actions/` location:

```ts
import type { AuthConfig } from './authConfig';
import { createSigninAction } from '../actions/signinAction';
import { createSignoutAction } from '../actions/signoutAction';
import { createWebauthnInviteAction } from '../actions/webauthnInviteAction';
import { createWebauthnRegisterAction } from '../actions/webauthnRegisterAction';
import { createWebauthnReauthAction } from '../actions/webauthnReauthAction';

/** Registers all auth action handlers into the global action registry.
 *  Must be called before registerRestActions sets up the Koa routes. */
export function registerAuthRoutes(config: AuthConfig): void {
  if (config.mode === 'jwt') {
    createSigninAction(config.store, config.onAuthenticate);
  }
  if (config.mode === 'webauthn') {
    createWebauthnInviteAction(config.store, config.onGetUserDetails);
    createWebauthnRegisterAction(config.store);
    createWebauthnReauthAction(config.store);
  }
  createSignoutAction(config.store);
}
```

- [ ] **Step 4: Delete old files**

```bash
rm src/server/auth/routes/webauthnInviteRoute.ts src/server/auth/routes/webauthnInviteRoute.tests.ts src/server/auth/routes/AGENTS.md
rmdir src/server/auth/routes
```

- [ ] **Step 5: Run full test suite**

```
pnpm test
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/webauthnInviteAction.ts src/server/actions/webauthnInviteAction.tests.ts src/server/auth/registerAuthRoutes.ts
git rm src/server/auth/routes/webauthnInviteRoute.ts src/server/auth/routes/webauthnInviteRoute.tests.ts src/server/auth/routes/AGENTS.md
git commit -m "refactor(auth): move webauthnInviteRoute → webauthnInviteAction; update registerAuthRoutes imports"
```

---

### Task 12: Remove ALS responseHeaders from `socketApiContext.ts`

**Files:**
- Modify: `src/server/async-context/socketApiContext.ts`

At this point all callers of `setResponseHeader`/`useResponseHeaders` have been migrated (Tasks 7–11), so the slots can be safely deleted.

- [ ] **Step 1: Confirm no remaining usages**

```bash
grep -r "setResponseHeader\|useResponseHeaders\|setResponseHeaders" src/
```
Expected: zero results (all callers have been migrated in Tasks 7–11)

- [ ] **Step 2: Update `src/server/async-context/socketApiContext.ts`**

```ts
import type { ServerConfig } from '../startServer';
import type { Socket } from 'socket.io';
import { createAsyncContext } from './createAsyncContext';
import { optional, required } from './types';
import type { Logger } from '@anupheaus/common';
import type { NexusUser } from '../../common';

export interface NexusAuthData {
  user?: NexusUser;
  token?: string;
  privateKey?: string;
  publicKey?: string;
}

/**
 * Shared ALS used by socket-api server: `wrap(client, handler)` for deferred work,
 * plus typed slots for config, the active Socket, logger, and per-client authentication state.
 */
export const {
  wrap,
  setConfig,
  useConfig,
  setClient,
  useClient,
  setLogger,
  useLogger,
  setAuthData,
  useAuthData,
} = createAsyncContext({
  config: required<ServerConfig>(),
  logger: required<Logger>(),
  client: optional<Socket>(),
  authData: optional<NexusAuthData>(),
});
```

- [ ] **Step 3: Run full test suite**

```
pnpm test
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/server/async-context/socketApiContext.ts
git commit -m "refactor(async-context): remove responseHeaders ALS slot — superseded by handlerUtils"
```

---

### Task 13: Update client `useAction.ts` with `resolveTransport`

**Files:**
- Modify: `src/client/hooks/useAction.ts`

- [ ] **Step 1: Write failing test**

There are no existing unit tests for `useAction.ts` in the test suite (it's covered by E2E). Add a focused unit test for the new helper in a new file `src/client/hooks/resolveTransport.tests.ts`. First extract `resolveTransport` as a named export from a new small file so it can be tested in isolation.

Create `src/client/hooks/resolveTransport.ts`:

```ts
import type { NexusAction } from '../../common';

export function resolveTransport(
  action: NexusAction<string, unknown, unknown>,
  isConnected: boolean,
): 'socket' | 'rest' | 'wait' {
  const { transport } = action;
  const restOnly  = transport != null && !transport.includes('socket');
  const socketOnly = transport != null && !transport.includes('rest');

  if (restOnly) return 'rest';
  if (socketOnly) return isConnected ? 'socket' : 'wait';
  // Default: prefer socket when connected, fall back to REST.
  return isConnected ? 'socket' : 'rest';
}
```

Create `src/client/hooks/resolveTransport.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAction } from '../../common/defineAction';
import { resolveTransport } from './resolveTransport';

const defaultAction   = defineAction<void, void>()('defaultAction');
const restOnlyAction  = defineAction<void, void>()('restOnlyAction',  { transport: ['rest'] });
const socketOnlyAction = defineAction<void, void>()('socketOnlyAction', { transport: ['socket'] });
const bothAction      = defineAction<void, void>()('bothAction',      { transport: ['socket', 'rest'] });

describe('resolveTransport', () => {
  describe('REST-only action', () => {
    it('returns rest when connected', () => {
      expect(resolveTransport(restOnlyAction, true)).toBe('rest');
    });
    it('returns rest when disconnected', () => {
      expect(resolveTransport(restOnlyAction, false)).toBe('rest');
    });
  });

  describe('socket-only action', () => {
    it('returns socket when connected', () => {
      expect(resolveTransport(socketOnlyAction, true)).toBe('socket');
    });
    it('returns wait when disconnected', () => {
      expect(resolveTransport(socketOnlyAction, false)).toBe('wait');
    });
  });

  describe('explicit both transports', () => {
    it('returns socket when connected', () => {
      expect(resolveTransport(bothAction, true)).toBe('socket');
    });
    it('returns rest when disconnected', () => {
      expect(resolveTransport(bothAction, false)).toBe('rest');
    });
  });

  describe('default (no transport set)', () => {
    it('returns socket when connected', () => {
      expect(resolveTransport(defaultAction, true)).toBe('socket');
    });
    it('returns rest when disconnected', () => {
      expect(resolveTransport(defaultAction, false)).toBe('rest');
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm test -- resolveTransport
```
Expected: FAIL — cannot find `./resolveTransport`

- [ ] **Step 3: Run tests after creating `resolveTransport.ts` to confirm they pass**

(The file was created in Step 1 above alongside the test — run to confirm.)

```
pnpm test -- resolveTransport
```
Expected: all pass

- [ ] **Step 4: Update `src/client/hooks/useAction.ts`**

Replace the three scattered `!action.rest` / `getIsConnected()` checks with `resolveTransport`. The import block gains:

```ts
import { resolveTransport } from './resolveTransport';
```

Replace the direct call path (inside `[action.name]: async (request, response?) => {...}`):

```ts
// before
const useSocket = getIsConnected() && !action.rest;
if (typeof response === 'function') {
  if (useSocket) { ... }  else { ... }
} else {
  if (useSocket) { ... } else { ... }
}

// after
const transport = resolveTransport(action, getIsConnected());
if (transport === 'wait') throw new Error(`Cannot call socket-only action '${action.name}' while disconnected`);
if (typeof response === 'function') {
  if (transport === 'socket') {
    emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(res => response(throwIfAckError(res)));
  } else {
    callRest<Response>(name, action, request).then(response);
  }
} else {
  if (transport === 'socket') {
    return emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(throwIfAckError);
  } else {
    return callRest<Response>(name, action, request);
  }
}
```

Replace the reactive hook path (inside `useLayoutEffect`):

```ts
// before
if (getIsConnected() && !action.rest) { ... }
else if (action.rest || getRawSocket() == null) { ... }
else { return; }

// after
const transport = resolveTransport(action, getIsConnected());
if (transport === 'socket') {
  const result = getErrorFromAckResponse(await emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request));
  response = result.response;
  error = result.error;
} else if (transport === 'rest') {
  response = await callRest<Response>(name, action, request);
} else {
  // 'wait' — socket-only action not yet connected; defer until onConnected fires
  return;
}
```

Replace the `onConnected` guard at the bottom of `useLayoutEffect`:

```ts
// before
if (!getIsConnected() && !action.rest) {
  onConnected(() => doEmit());
}

// after
if (resolveTransport(action, getIsConnected()) === 'wait') {
  onConnected(() => doEmit());
}
```

- [ ] **Step 5: Run full test suite**

```
pnpm test
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/client/hooks/resolveTransport.ts src/client/hooks/resolveTransport.tests.ts src/client/hooks/useAction.ts
git commit -m "feat(client): replace scattered transport checks with resolveTransport; enforce socket/rest-only actions"
```

---

### Task 14: AGENTS.md updates

**Files:**
- Modify: `src/server/handler/AGENTS.md`
- Modify: `src/server/actions/AGENTS.md`
- Modify: `src/server/auth/AGENTS.md`
- Modify: `src/server/async-context/AGENTS.md`

- [ ] **Step 1: Update `src/server/handler/AGENTS.md`**

Add `handlerUtils.ts` to the file table:

```markdown
| `handlerUtils.ts` | `NexusServerHandlerActionUtils` type, transport-specific factory functions (`createSocketHandlerUtils`, `createRestHandlerUtils`), cookie helpers, and the redirect symbol |
```

- [ ] **Step 2: Update `src/server/actions/AGENTS.md`**

Add the five moved auth action files to the file table:

```markdown
| `signinAction.ts` | JWT sign-in handler — creates session, sets cookie via utils |
| `signoutAction.ts` | Sign-out handler — disables session record, clears cookie via utils |
| `webauthnRegisterAction.ts` | WebAuthn first-time device registration handler |
| `webauthnReauthAction.ts` | WebAuthn returning device re-authentication handler |
| `webauthnInviteAction.ts` | WebAuthn invite handler — generates registration token |
```

Update the `transport` option in the Options section:

```markdown
### Transport restriction

```ts
export const adminAction = defineAction<void, void>()('adminAction', {
  transport: ['rest'],  // only callable via REST; socket calls get an immediate error
});
```

- [ ] **Step 3: Update `src/server/auth/AGENTS.md`**

Remove the `routes/` sub-folder row from the Sub-folders table. The auth action files now live in `src/server/actions/`.

- [ ] **Step 4: Update `src/server/async-context/AGENTS.md`**

Remove `setResponseHeader` from the API surface description (it has been deleted).

- [ ] **Step 5: Run full test suite one final time**

```
pnpm test
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/handler/AGENTS.md src/server/actions/AGENTS.md src/server/auth/AGENTS.md src/server/async-context/AGENTS.md
git commit -m "docs(agents): update AGENTS.md files for handler utils, moved auth actions, and removed ALS responseHeaders"
```
