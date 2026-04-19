# Authentication Redesign — Core + JWT Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc JWT auth fields on `ServerConfig` with a typed `defineAuthentication` API, HttpOnly cookie session management, JWT signin/signout REST endpoints, and a reactive client `useAuthentication` hook.

**Architecture:** `defineAuthentication<U, C>()` is exported from both the server and client entry points with different TypeScript signatures (via `package.json` `node`/`browser` export conditions). Auth state is persisted as HttpOnly cookies; the socket carries only the `socketAPIUserChanged` event to push user state to the client. Device fingerprinting produces a stable `deviceId` for one-session-per-device enforcement.

**Tech Stack:** TypeScript, Koa (HTTP routes), Socket.IO (user push event), Vitest (tests), React (client hook), Node.js `crypto` (session token generation), browser `SubtleCrypto` (device ID hash).

**Spec:** `docs/superpowers/specs/2026-04-19-webauthn-jwt-authentication-design.md`

**Out of scope for this plan:** WebAuthn invite/register routes and passkey ceremony — covered in a separate plan.

---

## File Map

### New files
| Path | Responsibility |
|------|----------------|
| `src/common/auth/authTypes.ts` | All shared interfaces: `SocketAPIDeviceDetails`, `SocketAPIAuthRecord`, `SocketAPIAuthStore`, `JwtAuthRecord`, `JwtAuthStore` |
| `src/common/auth/index.ts` | Re-exports from `authTypes.ts` |
| `src/server/auth/authConfig.ts` | Module-level `AuthConfig` store (set by `startServer`, read by routes and cookie validation) |
| `src/server/auth/validateSessionCookie.ts` | Parse cookie → `findBySessionToken` → `onGetUser` → `setUser` → update `lastConnectedAt` |
| `src/server/auth/routes/signinRoute.ts` | `POST /{name}/socketAPI/signin` Koa handler |
| `src/server/auth/routes/signoutRoute.ts` | `POST /{name}/socketAPI/signout` Koa handler |
| `src/server/auth/registerAuthRoutes.ts` | Registers signin + signout routes on the Koa Router |
| `src/server/auth/index.ts` | Re-exports server auth public API |
| `src/server/auth/defineAuthentication.ts` | Server-typed `defineAuthentication<U, C>()` — returns `{ configureAuthentication, useAuthentication }` with server signatures |
| `src/client/auth/collectDeviceDetails.ts` | Collect `SocketAPIDeviceDetails` from browser APIs |
| `src/client/auth/computeDeviceId.ts` | SHA-256 hash of stable fields → hex `deviceId` |
| `src/client/auth/defineAuthentication.ts` | Client-typed `defineAuthentication<U, C>()` — returns `{ useAuthentication }` with client signature |
| `src/client/hooks/useAuthentication.ts` | Client `useAuthentication` hook (accessed-flag reactive `user`, `signIn`, `signOut`) |

### Modified files
| Path | Change |
|------|--------|
| `src/common/internalEvents.ts` | Add `socketAPIUserChanged` event |
| `src/server/providers/authentication/useAuthentication.ts` | Rewrite: new return shape `{ user, setUser, impersonateUser, signOut }`, emit `socketAPIUserChanged` in `setUser` |
| `src/server/startServer.ts` | Remove legacy auth fields; add `auth?: AuthConfig`; call `registerAuthRoutes`; run `validateSessionCookie` on connect |
| `src/server/index.ts` | Export server `defineAuthentication` (replaces common re-export) |
| `src/client/providers/user/AuthenticationProvider.tsx` | Rewrite: remove token/JWT logic; wire `socketAPIUserChanged` → update user state; expose `reconnect` trigger |
| `src/client/providers/socket/SocketProvider.tsx` | Add `reconnect()` to `SocketContextProps` and implementation |
| `src/client/providers/socket/SocketContext.ts` | Add `reconnect(): void` to `SocketContextProps` |
| `src/client/index.ts` | Export client `defineAuthentication` (replaces common re-export) |
| `package.json` | Add root `.` export with `node`/`browser` conditions |

---

### Task 1: Common auth types

**Files:**
- Create: `src/common/auth/authTypes.ts`
- Create: `src/common/auth/index.ts`

- [ ] **Step 1: Create `src/common/auth/authTypes.ts`**

```ts
export interface SocketAPIDeviceDetails {
  userAgent: string;
  platform: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  maxTouchPoints: number;
  vendor: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
}

export interface SocketAPIAuthRecord {
  requestId: string;
  sessionToken: string;
  userId: string;
  deviceId: string;
  isEnabled: boolean;
  deviceDetails?: SocketAPIDeviceDetails;
  lastConnectedAt?: number;
}

export interface SocketAPIAuthStore<TRecord extends SocketAPIAuthRecord = SocketAPIAuthRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}

export interface JwtAuthRecord extends SocketAPIAuthRecord {}
export interface JwtAuthStore extends SocketAPIAuthStore<JwtAuthRecord> {}

// WebAuthn types — defined here for completeness; routes implemented in a separate plan
export interface WebAuthnAuthRecord extends SocketAPIAuthRecord {
  registrationToken?: string;
  keyHash?: string;
}

export interface WebAuthnAuthStore extends SocketAPIAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
}
```

- [ ] **Step 2: Create `src/common/auth/index.ts`**

```ts
export type {
  SocketAPIDeviceDetails,
  SocketAPIAuthRecord,
  SocketAPIAuthStore,
  JwtAuthRecord,
  JwtAuthStore,
  WebAuthnAuthRecord,
  WebAuthnAuthStore,
} from './authTypes';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/common/auth/authTypes.ts src/common/auth/index.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add shared auth record and store type interfaces"
```

---

### Task 2: `socketAPIUserChanged` internal event

**Files:**
- Modify: `src/common/internalEvents.ts`

- [ ] **Step 1: Write failing test**

Create `src/common/internalEvents.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { socketAPIUserChanged } from './internalEvents';

describe('socketAPIUserChanged', () => {
  it('is defined and has the correct event name', () => {
    expect(socketAPIUserChanged).toBeDefined();
    expect((socketAPIUserChanged as any).name ?? (socketAPIUserChanged as any).eventName ?? String(socketAPIUserChanged))
      .toContain('socketAPIUserChanged');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm test src/common/internalEvents.tests.ts`
Expected: FAIL — `socketAPIUserChanged` is not exported

- [ ] **Step 3: Add the event to `src/common/internalEvents.ts`**

```ts
import { defineEvent } from './defineEvent';

export interface SocketAPIUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export const socketAPIUserAuthenticated = defineEvent<SocketAPIUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
export const socketAPIUserChanged = defineEvent<{ user: unknown | undefined }>('socketAPIUserChanged');
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm test src/common/internalEvents.tests.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/common/internalEvents.ts src/common/internalEvents.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add socketAPIUserChanged internal event"
```

---

### Task 3: Server auth config module

**Files:**
- Create: `src/server/auth/authConfig.ts`

- [ ] **Step 1: Write failing test**

Create `src/server/auth/authConfig.tests.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setAuthConfig, getAuthConfig, clearAuthConfig } from './authConfig';

describe('authConfig', () => {
  beforeEach(() => clearAuthConfig());

  it('returns undefined before config is set', () => {
    expect(getAuthConfig()).toBeUndefined();
  });

  it('returns the config after it is set', () => {
    const store = {} as any;
    const onGetUser = async () => undefined;
    setAuthConfig({ mode: 'jwt', store, onAuthenticate: async () => undefined, onGetUser, syncUserToClient: true });
    const config = getAuthConfig();
    expect(config?.mode).toBe('jwt');
    expect(config?.syncUserToClient).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm test src/server/auth/authConfig.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/auth/authConfig.ts`**

```ts
import type { SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';

export interface JwtAuthConfig {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: unknown): Promise<SocketAPIUser | undefined>;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  syncUserToClient: boolean;
}

export interface WebAuthnAuthConfig {
  mode: 'webauthn';
  store: WebAuthnAuthStore;
  onGetUserDetails(userId: string): Promise<{ name: string; displayName?: string }>;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  syncUserToClient: boolean;
}

export type AuthConfig = JwtAuthConfig | WebAuthnAuthConfig;

let _config: AuthConfig | undefined;

export function setAuthConfig(config: AuthConfig): void {
  _config = config;
}

export function getAuthConfig(): AuthConfig | undefined {
  return _config;
}

export function clearAuthConfig(): void {
  _config = undefined;
}
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm test src/server/auth/authConfig.tests.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/authConfig.ts src/server/auth/authConfig.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add server auth config module"
```

---

### Task 4: Session cookie validation

**Files:**
- Create: `src/server/auth/validateSessionCookie.ts`
- Create: `src/server/auth/validateSessionCookie.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/validateSessionCookie.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { validateSessionCookie } from './validateSessionCookie';
import type { JwtAuthStore, JwtAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

function makeStore(record?: JwtAuthRecord): JwtAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

function makeSocket(cookieHeader?: string): Pick<Socket, 'handshake' | 'disconnect'> {
  return {
    handshake: { headers: { cookie: cookieHeader } } as any,
    disconnect: vi.fn(),
  };
}

const testUser: SocketAPIUser = { id: 'user-1' };

describe('validateSessionCookie', () => {
  it('disconnects socket when no cookie header is present', async () => {
    const store = makeStore();
    const socket = makeSocket(undefined);
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn();
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('disconnects socket when sessionToken not found in store', async () => {
    const store = makeStore(undefined); // findBySessionToken returns undefined
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn();
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('disconnects socket when record isEnabled is false', async () => {
    const record: JwtAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn();
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('calls setUser and updates lastConnectedAt when valid', async () => {
    const record: JwtAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => testUser);
    const setUser = vi.fn();
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(testUser);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('disconnects when onGetUser returns undefined', async () => {
    const record: JwtAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const onGetUser = vi.fn(async () => undefined);
    const setUser = vi.fn();
    await validateSessionCookie(socket as any, store, onGetUser, setUser);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/server/auth/validateSessionCookie.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/auth/validateSessionCookie.ts`**

```ts
import type { Socket } from 'socket.io';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../common/auth';
import type { SocketAPIUser } from '../../common';

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
  const sessionToken = parseCookie(cookieHeader);
  if (!sessionToken) { socket.disconnect(); return false; }

  const record = await store.findBySessionToken(sessionToken);
  if (!record || !record.isEnabled) { socket.disconnect(); return false; }

  const user = await onGetUser(record.userId);
  if (!user) { socket.disconnect(); return false; }

  await setUser(user);
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  return true;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/server/auth/validateSessionCookie.tests.ts`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/validateSessionCookie.ts src/server/auth/validateSessionCookie.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add session cookie validation for socket connect"
```

---

### Task 5: JWT signin route

**Files:**
- Create: `src/server/auth/routes/signinRoute.ts`
- Create: `src/server/auth/routes/signinRoute.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/routes/signinRoute.tests.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { createSigninRoute } from './signinRoute';
import type { JwtAuthStore, JwtAuthRecord } from '../../../common/auth';
import type { SocketAPIUser } from '../../../common';

const testUser: SocketAPIUser = { id: 'user-1' };

function makeStore(existingRecord?: JwtAuthRecord): JwtAuthStore {
  return {
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => existingRecord),
    findBySessionToken: vi.fn(async () => existingRecord),
    findByDevice: vi.fn(async () => existingRecord),
    update: vi.fn(async () => {}),
  };
}

async function makeServer(store: JwtAuthStore, onAuthenticate: (creds: unknown) => Promise<SocketAPIUser | undefined>) {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());
  createSigninRoute(router, 'test', store, onAuthenticate);
  app.use(router.routes());
  const server = http.createServer(app.callback());
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port as number;
  return { server, port };
}

describe('signinRoute', () => {
  it('returns 401 when onAuthenticate returns undefined', async () => {
    const store = makeStore();
    const { server, port } = await makeServer(store, async () => undefined);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bad@test.com', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it('returns 200 and sets HttpOnly cookie when credentials are valid (new device)', async () => {
    const store = makeStore(undefined); // findByDevice returns undefined → create
    const { server, port } = await makeServer(store, async () => testUser);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'good@test.com', password: 'correct', deviceId: 'dev-1', deviceDetails: {} }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('socketapi_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(store.create).toHaveBeenCalledOnce();
    server.close();
  });

  it('updates existing record when device already has a session', async () => {
    const existing: JwtAuthRecord = { requestId: 'r1', sessionToken: 'old', userId: 'user-1', deviceId: 'dev-1', isEnabled: true };
    const store = makeStore(existing); // findByDevice returns existing
    const { server, port } = await makeServer(store, async () => testUser);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'good@test.com', password: 'correct', deviceId: 'dev-1', deviceDetails: {} }),
    });
    expect(res.status).toBe(200);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ sessionToken: expect.any(String), isEnabled: true }));
    server.close();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/server/auth/routes/signinRoute.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/auth/routes/signinRoute.ts`**

```ts
import crypto from 'crypto';
import type Router from 'koa-router';
import type { JwtAuthStore } from '../../../common/auth';
import type { SocketAPIUser } from '../../../common';
import { ulid } from 'ulidx';

const COOKIE_NAME = 'socketapi_session';

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function createSigninRoute(
  router: Router,
  name: string,
  store: JwtAuthStore,
  onAuthenticate: (credentials: unknown) => Promise<SocketAPIUser | undefined>,
): void {
  router.post(`/${name}/socketAPI/signin`, async ctx => {
    const body = ctx.request.body as Record<string, unknown>;
    const { deviceId, deviceDetails, ...credentials } = body;

    const user = await onAuthenticate(credentials);
    if (!user) { ctx.status = 401; return; }

    const sessionToken = generateSessionToken();
    const existing = await store.findByDevice(user.id, String(deviceId ?? ''));

    if (existing) {
      await store.update(existing.requestId, {
        sessionToken,
        isEnabled: true,
        deviceDetails: deviceDetails as any,
        lastConnectedAt: Date.now(),
      });
    } else {
      await store.create({
        requestId: ulid(),
        sessionToken,
        userId: user.id,
        deviceId: String(deviceId ?? ''),
        isEnabled: true,
        deviceDetails: deviceDetails as any,
        lastConnectedAt: Date.now(),
      });
    }

    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}
```

- [ ] **Step 4: Install `ulidx` if not present**

Run: `pnpm list ulidx`

If not installed: `pnpm add ulidx`

- [ ] **Step 5: Run tests to confirm they pass**

Run: `pnpm test src/server/auth/routes/signinRoute.tests.ts`
Expected: all 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/routes/signinRoute.ts src/server/auth/routes/signinRoute.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add JWT signin REST endpoint"
```

---

### Task 6: Signout route

**Files:**
- Create: `src/server/auth/routes/signoutRoute.ts`
- Create: `src/server/auth/routes/signoutRoute.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/routes/signoutRoute.tests.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { createSignoutRoute } from './signoutRoute';
import type { JwtAuthStore, JwtAuthRecord } from '../../../common/auth';

function makeStore(record?: JwtAuthRecord): JwtAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

async function makeServer(store: JwtAuthStore) {
  const app = new Koa();
  const router = new Router();
  app.use(bodyParser());
  createSignoutRoute(router, 'test', store);
  app.use(router.routes());
  const server = http.createServer(app.callback());
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port as number;
  return { server, port };
}

describe('signoutRoute', () => {
  it('returns 200 and clears cookie even when no cookie present', async () => {
    const store = makeStore(undefined);
    const { server, port } = await makeServer(store);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('socketapi_session=;');
    expect(setCookie).toContain('Max-Age=0');
    server.close();
  });

  it('disables the store record when a valid cookie is present', async () => {
    const record: JwtAuthRecord = { requestId: 'r1', sessionToken: 'tok', userId: 'u1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const { server, port } = await makeServer(store);
    const res = await fetch(`http://localhost:${port}/test/socketAPI/signout`, {
      method: 'POST',
      headers: { Cookie: 'socketapi_session=tok' },
    });
    expect(res.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', { isEnabled: false });
    server.close();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/server/auth/routes/signoutRoute.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/auth/routes/signoutRoute.ts`**

```ts
import type Router from 'koa-router';
import type { SocketAPIAuthStore, SocketAPIAuthRecord } from '../../../common/auth';

const COOKIE_NAME = 'socketapi_session';
const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

export function createSignoutRoute(
  router: Router,
  name: string,
  store: SocketAPIAuthStore<SocketAPIAuthRecord>,
): void {
  router.post(`/${name}/socketAPI/signout`, async ctx => {
    const sessionToken = parseCookie(ctx.get('Cookie'));
    if (sessionToken) {
      const record = await store.findBySessionToken(sessionToken);
      if (record) await store.update(record.requestId, { isEnabled: false });
    }
    ctx.set('Set-Cookie', CLEAR_COOKIE);
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/server/auth/routes/signoutRoute.tests.ts`
Expected: both tests PASS

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/routes/signoutRoute.ts src/server/auth/routes/signoutRoute.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add signout REST endpoint (shared JWT + WebAuthn)"
```

---

### Task 7: Register auth routes + server auth index

**Files:**
- Create: `src/server/auth/registerAuthRoutes.ts`
- Create: `src/server/auth/index.ts`

- [ ] **Step 1: Create `src/server/auth/registerAuthRoutes.ts`**

```ts
import Router from 'koa-router';
import type { AuthConfig } from './authConfig';
import { createSigninRoute } from './routes/signinRoute';
import { createSignoutRoute } from './routes/signoutRoute';

export function registerAuthRoutes(router: Router, name: string, config: AuthConfig): void {
  if (config.mode === 'jwt') {
    createSigninRoute(router, name, config.store, config.onAuthenticate);
  }
  // WebAuthn routes registered in a separate plan
  createSignoutRoute(router, name, config.store);
}
```

- [ ] **Step 2: Create `src/server/auth/index.ts`**

```ts
export type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
export { setAuthConfig, getAuthConfig, clearAuthConfig } from './authConfig';
export { validateSessionCookie } from './validateSessionCookie';
export { registerAuthRoutes } from './registerAuthRoutes';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/registerAuthRoutes.ts src/server/auth/index.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add registerAuthRoutes and server auth index"
```

---

### Task 8: Wire auth into `startServer` — remove legacy fields

**Files:**
- Modify: `src/server/startServer.ts`

- [ ] **Step 1: Read the current `startServer.ts`** (already read at session start — reference lines 1–96)

- [ ] **Step 2: Rewrite `src/server/startServer.ts`**

Replace the entire file:

```ts
import type { PromiseMaybe } from '@anupheaus/common';
import { Logger } from '@anupheaus/common';
import type { AnyHttpServer } from './internalModels';
import type { Koa } from './providers';
import { setupSocket, setupKoa } from './providers';
import type { SocketAPIServerAction } from './actions';
import type { Server, Socket } from 'socket.io';
export type { Server };
import type { SocketAPIClientLoggingService } from '../common';
import type { SocketAPIServerSubscription } from './subscriptions';
import { setupHandlers } from './handler';
import Router from 'koa-router';
import { wrap, setConfig, setLogger } from './async-context/socketApiContext';
import type { SecurityConfig } from './security';
import { resolveSecurityConfig } from './security';
import { ConnectionRegistry } from './providers/connection';
import { cleanupSocketSubscriptions } from './subscriptions';
import type { AuthConfig } from './auth';
import { setAuthConfig, registerAuthRoutes, validateSessionCookie } from './auth';
import { useAuthentication } from './providers/authentication/useAuthentication';

export interface ServerConfig {
  name: string;
  actions?: SocketAPIServerAction[];
  subscriptions?: SocketAPIServerSubscription[];
  logger?: Logger;
  server: AnyHttpServer;
  auth?: AuthConfig;
  clientLoggingService?: SocketAPIClientLoggingService;
  onStartup?(): PromiseMaybe<void>;
  onClientConnecting?(client: Socket): PromiseMaybe<void>;
  onClientConnected?(client: Socket): PromiseMaybe<void>;
  onClientDisconnected?(client: Socket): PromiseMaybe<void>;
  onBeforeHandle?(client: Socket): PromiseMaybe<void>;
  onRegisterNamespaces?(io: Server): PromiseMaybe<void>;
  onRegisterRoutes?(router: Router): PromiseMaybe<void>;
  security?: SecurityConfig;
}

export async function startServer(config: ServerConfig) {
  const {
    name,
    server,
    actions,
    subscriptions,
    logger: providedLogger,
    clientLoggingService,
    onClientConnecting,
    onClientConnected,
    onClientDisconnected,
    onRegisterRoutes,
    auth,
  } = config;

  setConfig(config);
  if (auth) setAuthConfig(auth);

  const logger = providedLogger ?? new Logger('Socket-API');
  setLogger(logger);

  return logger.provide(async () => {
    const registry = new ConnectionRegistry();
    const app = setupKoa(server, registry, resolveSecurityConfig(config.security));

    // Register auth REST routes first so they are available before socket setup
    const router = new Router();
    if (auth) registerAuthRoutes(router, name, auth);
    if (onRegisterRoutes) await onRegisterRoutes(router);
    app.use(router.routes());

    const { onClientConnected: localOnClientConnected, io } = setupSocket(name, server, logger, clientLoggingService, registry);
    attachKoaFallbackToEngineIO(app, io, registry);
    if (config.onRegisterNamespaces) await config.onRegisterNamespaces(io);
    if (config.onStartup) await config.onStartup();

    localOnClientConnected(wrap(({ client }) => registry.fromSocket(client), ({ client }) => {
      onClientConnecting?.(client);

      // Validate cookie and authenticate user if auth config is present
      if (auth) {
        const { setUser } = useAuthentication();
        validateSessionCookie(client, auth.store, auth.onGetUser, async user => {
          await setUser(user);
        });
      }

      setupHandlers([...(actions ?? []), ...(subscriptions ?? [])]);
      onClientConnected?.(client);

      return wrap(innerClient => registry.fromSocket(innerClient), (innerClient: Socket) => {
        cleanupSocketSubscriptions(innerClient.id);
        onClientDisconnected?.(innerClient);
      });
    }));

    return { app, io };
  });
}

async function registerRoutes(app: Koa, onRegisterRoutes: Required<ServerConfig>['onRegisterRoutes']) {
  const router = new Router();
  await onRegisterRoutes(router);
  app.use(router.routes());
}

function attachKoaFallbackToEngineIO(app: Koa, io: Server, registry: ConnectionRegistry) {
  const koaHandler = app.callback();
  io.engine.use(
    wrap(
      (req: any, res: any) => registry.fromRequest(req, res),
      (req: any, res: any, next: () => void) => {
        if (req._query?.transport) { next(); return; }
        koaHandler(req, res);
      },
    ),
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors (some existing tests may reference removed fields — fix in next step)

- [ ] **Step 4: Update existing tests that used `privateKey` or `disableJwtAuth`**

Search for references:
```bash
grep -rl "privateKey\|disableJwtAuth\|onSavePrivateKey\|onLoadPrivateKey" C:/code/personal/socket-api/src C:/code/personal/socket-api/tests
```

For each file found, remove the legacy field from the `startServer` call. The `privateKey` field is no longer needed — auth is cookie-based. If a test relies on JWT token re-auth, that test should be removed or rewritten to use the new signin endpoint.

- [ ] **Step 5: Run all unit tests**

Run: `pnpm test`
Expected: tests pass (adjust any that fail due to removed legacy fields)

- [ ] **Step 6: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/startServer.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): wire auth routes and cookie validation into startServer, remove legacy auth fields"
```

---

### Task 9: Server `useAuthentication` hook rewrite

**Files:**
- Modify: `src/server/providers/authentication/useAuthentication.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/providers/authentication/useAuthentication.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../startServer';
import { createServerActionHandler } from '../../actions/createServerActionHandler';
import { defineAction } from '../../../common';
import { TestClient } from '../../../../tests/e2e/TestClient';

const getUserAction = defineAction<void, { id: string } | undefined>()('useAuthGetUser');

describe('server useAuthentication', () => {
  it('getUser returns undefined when no user is authenticated', async () => {
    let capturedUser: any;
    const server = http.createServer();
    await startServer({
      name: 'auth-test',
      logger: new Logger('test'),
      server,
      actions: [
        createServerActionHandler(getUserAction, async () => {
          const { useAuthentication } = await import('./useAuthentication');
          const { user } = useAuthentication();
          capturedUser = user;
          return user as any;
        }),
      ],
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const c = new TestClient(port, 'auth-test');
    await c.connect();
    const result = await c.call(getUserAction, undefined);
    expect(result).toBeUndefined();
    c.disconnect();
    server.close();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm test src/server/providers/authentication/useAuthentication.tests.ts`
Expected: FAIL or import error

- [ ] **Step 3: Rewrite `src/server/providers/authentication/useAuthentication.ts`**

```ts
import type { MakePromise } from '@anupheaus/common';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserChanged } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, useConfig, wrap } from '../../async-context/socketApiContext';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser>() {
  function getUser(): UserType | undefined {
    return useAuthData()?.user as UserType | undefined;
  }

  async function setUser(user: UserType | undefined) {
    const { getClient } = internalUseSocket();
    const emitUserChanged = useEvent(socketAPIUserChanged);
    const { syncUserToClient } = (useConfig() as any)?.auth ?? { syncUserToClient: true };

    const existingAuthData = useAuthData() ?? {};
    setAuthData({ ...existingAuthData, user });

    if (syncUserToClient !== false) {
      const client = getClient();
      if (client != null) emitUserChanged({ user });
    }
  }

  async function signOut() {
    await setUser(undefined);
  }

  function impersonateUser<ImpersonatedUserType extends SocketAPIUser, T>(
    user: ImpersonatedUserType,
    handler: () => T,
  ): MakePromise<T> {
    const newTarget = {};
    return wrap(newTarget, async () => {
      await setUser(user as unknown as UserType);
      return handler();
    })() as MakePromise<T>;
  }

  return {
    get user() { return getUser(); },
    setUser,
    signOut,
    impersonateUser,
  };
}
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm test src/server/providers/authentication/useAuthentication.tests.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/providers/authentication/useAuthentication.ts src/server/providers/authentication/useAuthentication.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): rewrite server useAuthentication hook with new return shape and socketAPIUserChanged"
```

---

### Task 10: Server `defineAuthentication` + `configureAuthentication`

**Files:**
- Create: `src/server/auth/defineAuthentication.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Create `src/server/auth/defineAuthentication.ts`**

```ts
import type { SocketAPIUser } from '../../common';
import type { JwtAuthStore } from '../../common/auth';
import type { AuthConfig, JwtAuthConfig } from './authConfig';
import { useAuthentication } from '../providers/authentication/useAuthentication';
import type { MakePromise } from '@anupheaus/common';

export interface JwtConfigureOptions<U extends SocketAPIUser, C> {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: C): Promise<U | undefined>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface ServerUseAuthResult<U extends SocketAPIUser> {
  readonly user: U | undefined;
  setUser(user: U | undefined): Promise<void>;
  signOut(): Promise<void>;
  impersonateUser<T>(user: U, handler: () => T): MakePromise<T>;
}

export function defineAuthentication<U extends SocketAPIUser, C = void>() {
  function configureAuthentication(options: JwtConfigureOptions<U, C>): AuthConfig {
    const config: JwtAuthConfig = {
      mode: 'jwt',
      store: options.store,
      onAuthenticate: options.onAuthenticate as (credentials: unknown) => Promise<SocketAPIUser | undefined>,
      onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
      syncUserToClient: options.syncUserToClient ?? true,
    };
    return config;
  }

  function useAuth(): ServerUseAuthResult<U> {
    return useAuthentication<U>();
  }

  return {
    configureAuthentication,
    useAuthentication: useAuth,
  };
}
```

- [ ] **Step 2: Export `defineAuthentication` from `src/server/index.ts`**

Open `src/server/index.ts` and add the export:

```ts
export { defineAuthentication } from './auth/defineAuthentication';
```

(Add to the end of the existing exports in that file.)

- [ ] **Step 3: Write a smoke test**

Create `src/server/auth/defineAuthentication.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { defineAuthentication } from './defineAuthentication';
import type { JwtAuthStore } from '../../common/auth';

interface TestUser { id: string; name: string; }
interface TestCreds { email: string; password: string; }

const store: JwtAuthStore = {
  create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
  findByDevice: vi.fn(), update: vi.fn(),
};

describe('defineAuthentication (server)', () => {
  it('returns configureAuthentication and useAuthentication', () => {
    const auth = defineAuthentication<TestUser, TestCreds>();
    expect(typeof auth.configureAuthentication).toBe('function');
    expect(typeof auth.useAuthentication).toBe('function');
  });

  it('configureAuthentication returns config with defaults', () => {
    const { configureAuthentication } = defineAuthentication<TestUser, TestCreds>();
    const config = configureAuthentication({
      mode: 'jwt',
      store,
      onAuthenticate: async () => undefined,
      onGetUser: async () => undefined,
    });
    expect(config.mode).toBe('jwt');
    expect((config as any).syncUserToClient).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm test src/server/auth/defineAuthentication.tests.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/defineAuthentication.ts src/server/auth/defineAuthentication.tests.ts src/server/index.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add server defineAuthentication with configureAuthentication and typed useAuthentication"
```

---

### Task 11: Package.json root export with node/browser conditions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `package.json` to add root `.` export**

Open `package.json` and update the `exports` field:

```json
"exports": {
  ".": {
    "node": {
      "require": "./dist/server.js",
      "import": "./dist/server.js",
      "types": "./dist/server/index.d.ts"
    },
    "browser": {
      "require": "./dist/client.js",
      "import": "./dist/client.js",
      "types": "./dist/client/index.d.ts"
    },
    "default": {
      "require": "./dist/common.js",
      "import": "./dist/common.js",
      "types": "./dist/common/index.d.ts"
    }
  },
  "./server": {
    "require": "./dist/server.js",
    "import": "./dist/server.js",
    "types": "./dist/server/index.d.ts"
  },
  "./client": {
    "require": "./dist/client.js",
    "import": "./dist/client.js",
    "types": "./dist/client/index.d.ts"
  },
  "./common": {
    "require": "./dist/common.js",
    "import": "./dist/common.js",
    "types": "./dist/common/index.d.ts"
  }
}
```

Also update `typesVersions` to add the root condition:

```json
"typesVersions": {
  "*": {
    ".": ["./dist/server/index.d.ts"],
    "server": ["./dist/server/index.d.ts"],
    "client": ["./dist/client/index.d.ts"]
  }
}
```

- [ ] **Step 2: Verify `pnpm tsc --noEmit` still passes**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add package.json
git -C C:/code/personal/socket-api commit -m "feat(auth): add root package.json export with node/browser conditions for auto type resolution"
```

---

### Task 12: Client device details collection

**Files:**
- Create: `src/client/auth/collectDeviceDetails.ts`
- Create: `src/client/auth/computeDeviceId.ts`
- Create: `src/client/auth/collectDeviceDetails.tests.ts`
- Create: `src/client/auth/computeDeviceId.tests.ts`

- [ ] **Step 1: Write failing tests for `collectDeviceDetails`**

Create `src/client/auth/collectDeviceDetails.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectDeviceDetails } from './collectDeviceDetails';

describe('collectDeviceDetails', () => {
  it('returns an object with all required fields', () => {
    const details = collectDeviceDetails();
    expect(typeof details.userAgent).toBe('string');
    expect(typeof details.platform).toBe('string');
    expect(typeof details.language).toBe('string');
    expect(typeof details.hardwareConcurrency).toBe('number');
    expect(typeof details.maxTouchPoints).toBe('number');
    expect(typeof details.vendor).toBe('string');
    expect(typeof details.screenWidth).toBe('number');
    expect(typeof details.screenHeight).toBe('number');
    expect(typeof details.viewportWidth).toBe('number');
    expect(typeof details.viewportHeight).toBe('number');
    expect(typeof details.colorDepth).toBe('number');
    expect(typeof details.pixelRatio).toBe('number');
    expect(typeof details.timezone).toBe('string');
  });
});
```

- [ ] **Step 2: Write failing tests for `computeDeviceId`**

Create `src/client/auth/computeDeviceId.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDeviceId } from './computeDeviceId';

describe('computeDeviceId', () => {
  it('returns a non-empty string', async () => {
    const id = await computeDeviceId({
      userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'en-GB',
      hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.',
      screenWidth: 1920, screenHeight: 1080, viewportWidth: 1280, viewportHeight: 720,
      colorDepth: 24, pixelRatio: 1, timezone: 'Europe/London',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns the same id for the same stable fields regardless of viewport', async () => {
    const base = {
      userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'en-GB',
      hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.',
      screenWidth: 1920, screenHeight: 1080, colorDepth: 24, pixelRatio: 1, timezone: 'Europe/London',
    };
    const id1 = await computeDeviceId({ ...base, viewportWidth: 1280, viewportHeight: 720 });
    const id2 = await computeDeviceId({ ...base, viewportWidth: 800, viewportHeight: 600 });
    expect(id1).toBe(id2);
  });

  it('returns different ids for different stable fields', async () => {
    const base = {
      platform: 'Win32', language: 'en-GB', hardwareConcurrency: 8, maxTouchPoints: 0,
      vendor: 'Google Inc.', screenWidth: 1920, screenHeight: 1080, viewportWidth: 1280,
      viewportHeight: 720, colorDepth: 24, pixelRatio: 1, timezone: 'Europe/London',
    };
    const id1 = await computeDeviceId({ ...base, userAgent: 'Chrome/120' });
    const id2 = await computeDeviceId({ ...base, userAgent: 'Firefox/121' });
    expect(id1).not.toBe(id2);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `pnpm test src/client/auth/collectDeviceDetails.tests.ts src/client/auth/computeDeviceId.tests.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Create `src/client/auth/collectDeviceDetails.ts`**

```ts
import type { SocketAPIDeviceDetails } from '../../common/auth';

export function collectDeviceDetails(): SocketAPIDeviceDetails {
  const nav = navigator;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: (nav as any).deviceMemory as number | undefined,
    maxTouchPoints: nav.maxTouchPoints,
    vendor: nav.vendor,
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
```

- [ ] **Step 5: Create `src/client/auth/computeDeviceId.ts`**

```ts
import type { SocketAPIDeviceDetails } from '../../common/auth';

export async function computeDeviceId(details: SocketAPIDeviceDetails): Promise<string> {
  const stable = [
    details.userAgent,
    details.platform,
    String(details.hardwareConcurrency),
    String(details.screenWidth),
    String(details.screenHeight),
    String(details.colorDepth),
    String(details.pixelRatio),
    details.timezone,
  ].join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(stable);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 6: Run tests to confirm they pass**

Run: `pnpm test src/client/auth/collectDeviceDetails.tests.ts src/client/auth/computeDeviceId.tests.ts`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/auth/collectDeviceDetails.ts src/client/auth/computeDeviceId.tests.ts src/client/auth/collectDeviceDetails.tests.ts src/client/auth/computeDeviceId.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add client device details collection and stable deviceId hash"
```

---

### Task 13: Socket context — expose `reconnect()`

**Files:**
- Modify: `src/client/providers/socket/SocketContext.ts`
- Modify: `src/client/providers/socket/SocketProvider.tsx`

- [ ] **Step 1: Add `reconnect()` and `name` to `SocketContextProps` in `src/client/providers/socket/SocketContext.ts`**

Add to the `SocketContextProps` interface:
```ts
name: string;
reconnect(): void;
```

Add to the `createContext` default object:
```ts
name: '',
reconnect: missingSocketProvider('reconnect'),
```

- [ ] **Step 2: Implement `reconnect()` and expose `name` in `src/client/providers/socket/SocketProvider.tsx`**

In the `context` object built inside `useMemo` (around line 138), add:

```ts
name,  // pass the name prop through to context
function reconnect() {
  reconnectRef.current = true;
  setUniqueConnectionId(Math.random().toString(36).slice(2));
}
```

And include both `name` and `reconnect` in the returned context object.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/socket/SocketContext.ts src/client/providers/socket/SocketProvider.tsx
git -C C:/code/personal/socket-api commit -m "feat(auth): expose reconnect() on SocketContext for auth state transitions"
```

---

### Task 14: Client `useAuthentication` hook

**Files:**
- Create: `src/client/hooks/useAuthentication.ts`
- Create: `src/client/hooks/useAuthentication.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/client/hooks/useAuthentication.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthentication } from './useAuthentication';

// Mock socket and event infrastructure
vi.mock('../providers/socket/SocketContext', () => ({
  SocketContext: {
    _currentValue: {
      reconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      onConnectionStateChanged: vi.fn(),
      getSocket: vi.fn(() => undefined),
      getRawSocket: vi.fn(() => undefined),
      testDisconnect: vi.fn(),
      testReconnect: vi.fn(),
    },
  },
}));

describe('client useAuthentication', () => {
  it('user is undefined initially', () => {
    const { result } = renderHook(() => useAuthentication<{ id: string }, { email: string }>());
    expect(result.current.user).toBeUndefined();
  });

  it('does not re-render when user changes and user was not accessed', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useAuthentication<{ id: string }, { email: string }>();
    });
    // Only access signOut, not user
    const initialCount = renderCount;
    expect(typeof result.current.signOut).toBe('function');
    // Simulate user change — should NOT trigger re-render since user was not accessed
    expect(renderCount).toBe(initialCount);
  });

  it('exposes signIn and signOut functions', () => {
    const { result } = renderHook(() => useAuthentication<{ id: string }, { email: string }>());
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/client/hooks/useAuthentication.tests.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/client/hooks/useAuthentication.ts`**

```ts
import { useReducer, useRef, useContext, useCallback } from 'react';
import type { SocketAPIUser } from '../../common';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { SocketContext } from '../providers/socket/SocketContext';
import { collectDeviceDetails } from '../auth/collectDeviceDetails';
import { computeDeviceId } from '../auth/computeDeviceId';

export interface ClientUseAuthResult<U, C> {
  readonly user: U | undefined;
  signIn(credentials: C): Promise<void>;
  signOut(): Promise<void>;
}

let _currentUser: SocketAPIUser | undefined;

export function useAuthentication<U extends SocketAPIUser = SocketAPIUser, C = void>(): ClientUseAuthResult<U, C> {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const userRef = useRef<U | undefined>(_currentUser as U | undefined);
  const isUserAccessedRef = useRef(false);
  const { name, reconnect, on, off } = useContext(SocketContext);

  // Listen for server-pushed user changes
  const hookId = useRef(`useAuthentication-${Math.random()}`).current;
  on(hookId, `socket-api.events.${socketAPIUserChanged.name ?? 'socketAPIUserChanged'}`, (payload: { user: U | undefined }) => {
    _currentUser = payload.user;
    userRef.current = payload.user;
    if (isUserAccessedRef.current) forceUpdate();
  });

  const signIn = useCallback(async (credentials: C) => {
    const details = collectDeviceDetails();
    const deviceId = await computeDeviceId(details);
    const res = await fetch(`/${name}/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...credentials as any, deviceId, deviceDetails: details }),
    });
    if (!res.ok) throw new Error(`Sign in failed: ${res.status}`);
    reconnect();
  }, [name, reconnect]);

  const signOut = useCallback(async () => {
    await fetch(`/${name}/socketAPI/signout`, { method: 'POST', credentials: 'include' });
    _currentUser = undefined;
    userRef.current = undefined;
    if (isUserAccessedRef.current) forceUpdate();
    reconnect();
  }, [name, reconnect, forceUpdate]);

  return {
    get user(): U | undefined {
      isUserAccessedRef.current = true;
      return userRef.current;
    },
    signIn,
    signOut,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/client/hooks/useAuthentication.tests.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/hooks/useAuthentication.ts src/client/hooks/useAuthentication.tests.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add client useAuthentication hook with accessed-flag reactive user"
```

---

### Task 15: Client `defineAuthentication` + `AuthenticationProvider` rewrite

**Files:**
- Create: `src/client/auth/defineAuthentication.ts`
- Modify: `src/client/providers/user/AuthenticationProvider.tsx`
- Modify: `src/client/index.ts`

- [ ] **Step 1: Create `src/client/auth/defineAuthentication.ts`**

```ts
import type { SocketAPIUser } from '../../common';
import { useAuthentication } from '../hooks/useAuthentication';
import type { ClientUseAuthResult } from '../hooks/useAuthentication';

export function defineAuthentication<U extends SocketAPIUser, C = void>() {
  return {
    configureAuthentication: null as never,
    useAuthentication(): ClientUseAuthResult<U, C> {
      return useAuthentication<U, C>();
    },
  };
}
```

- [ ] **Step 2: Rewrite `src/client/providers/user/AuthenticationProvider.tsx`**

```tsx
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';

interface Props {
  children: ReactNode;
}

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({ children }: Props) => {
  // User state is now managed by useAuthentication() in individual components.
  // AuthenticationProvider remains as a thin wrapper that provides the UserContext
  // for components that still consume it via useUser().
  const context = useMemo<UserContextType>(() => ({
    isValid: true,
    userState: undefined as any,
    signOut: async () => {}, // signOut is now on useAuthentication()
  }), []);

  return (
    <UserContext.Provider value={context}>
      {children}
    </UserContext.Provider>
  );
});
```

- [ ] **Step 3: Add `defineAuthentication` export to `src/client/index.ts`**

Open `src/client/index.ts` and add:

```ts
export { defineAuthentication } from './auth/defineAuthentication';
export { useAuthentication } from './hooks/useAuthentication';
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/auth/defineAuthentication.ts src/client/providers/user/AuthenticationProvider.tsx src/client/index.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): add client defineAuthentication and rewrite AuthenticationProvider"
```

---

### Task 16: End-to-end integration test

**Files:**
- Create: `tests/e2e/auth.tests.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/e2e/auth.tests.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server/startServer';
import { defineAuthentication } from '../../src/server/auth/defineAuthentication';
import type { JwtAuthStore, JwtAuthRecord } from '../../src/common/auth';

interface TestUser { id: string; email: string; }
interface TestCreds { email: string; password: string; }

const users: Record<string, TestUser> = {
  'test@test.com': { id: 'user-1', email: 'test@test.com' },
};

const records: Map<string, JwtAuthRecord> = new Map();

const store: JwtAuthStore = {
  async create(r) { records.set(r.requestId, { ...r }); },
  async findById(id) { return records.get(id); },
  async findBySessionToken(t) { return [...records.values()].find(r => r.sessionToken === t); },
  async findByDevice(userId, deviceId) { return [...records.values()].find(r => r.userId === userId && r.deviceId === deviceId); },
  async update(id, patch) {
    const r = records.get(id);
    if (r) records.set(id, { ...r, ...patch });
  },
};

const { configureAuthentication } = defineAuthentication<TestUser, TestCreds>();

describe('JWT auth integration', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer();
    await startServer({
      name: 'e2e-auth',
      logger: new Logger('e2e'),
      server,
      auth: configureAuthentication({
        mode: 'jwt',
        store,
        onAuthenticate: async ({ email, password }) => {
          if (password === 'correct') return users[email];
          return undefined;
        },
        onGetUser: async (userId) => Object.values(users).find(u => u.id === userId),
      }),
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as any).port;
  }, 15_000);

  afterAll(() => server?.close());

  it('POST /signin returns 401 for wrong password', async () => {
    const res = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'wrong', deviceId: 'dev-e2e', deviceDetails: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /signin returns 200 and Set-Cookie for correct credentials', async () => {
    const res = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'correct', deviceId: 'dev-e2e', deviceDetails: {} }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('socketapi_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST /signout returns 200 and clears cookie', async () => {
    // First sign in to get a token
    const signinRes = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'correct', deviceId: 'dev-signout', deviceDetails: {} }),
    });
    const rawCookie = signinRes.headers.get('set-cookie') ?? '';
    const token = rawCookie.match(/socketapi_session=([^;]+)/)?.[1] ?? '';
    expect(token).toBeTruthy();

    const signoutRes = await fetch(`http://localhost:${port}/e2e-auth/socketAPI/signout`, {
      method: 'POST',
      headers: { Cookie: `socketapi_session=${token}` },
    });
    expect(signoutRes.status).toBe(200);
    const clearCookie = signoutRes.headers.get('set-cookie') ?? '';
    expect(clearCookie).toContain('Max-Age=0');

    // Verify record is disabled
    const record = [...records.values()].find(r => r.sessionToken === token);
    expect(record?.isEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm test:e2e tests/e2e/auth.tests.ts`
Expected: all 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add tests/e2e/auth.tests.ts
git -C C:/code/personal/socket-api commit -m "test(auth): add e2e integration test for JWT signin/signout flow"
```

---

## Self-Review Checklist

After implementation, verify:

- [ ] `SocketAPIDeviceDetails`, `SocketAPIAuthRecord`, `SocketAPIAuthStore`, `JwtAuthStore` all exported from `src/common/auth/index.ts`
- [ ] `socketAPIUserChanged` event defined and used in server `setUser`
- [ ] `validateSessionCookie` called on every socket connect when `auth` config present
- [ ] Cookie name `socketapi_session` consistent across all files (`signinRoute`, `signoutRoute`, `validateSessionCookie`)
- [ ] `sessionToken` generated with `crypto.randomBytes(32).toString('base64url')` (256-bit) everywhere
- [ ] `findByDevice` called in signin route; `update` called when existing, `create` when new
- [ ] `reconnect()` on `SocketContext` triggers actual socket disconnect + reconnect
- [ ] `isUserAccessedRef` only triggers re-renders after `user` getter has been called
- [ ] `pnpm test` passes — no broken existing tests
- [ ] `pnpm tsc --noEmit` passes — no TypeScript errors
