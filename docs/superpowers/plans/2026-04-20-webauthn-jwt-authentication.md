# WebAuthn JWT Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebAuthn passkey registration and re-authentication support alongside the existing JWT auth, including server-side routes, `createInvite`, and client-side passkey ceremony.

**Architecture:** The existing JWT system (signin/signout routes, session cookies, `useAuthentication` server hook) stays unchanged. WebAuthn adds four new server routes (invite, register, reauth, shared signout already exists) and a `createInvite` method on the server hook. The client `signIn()` branches at runtime: credentials object → JWT; no credentials + `?requestId=` in URL → WebAuthn registration; no credentials + no `?requestId=` → WebAuthn re-auth (discoverable credential, no `allowCredentials` needed). Re-auth uses the same PRF-derived `keyHash` as registration — the server looks it up via `findByKeyHash`.

**Tech Stack:** Vitest (unit tests), Koa-router (HTTP routes), Web Crypto API (SHA-256 hashing, session tokens), `navigator.credentials.create` / `navigator.credentials.get` with PRF extension (browser passkey ceremony)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/common/auth/authTypes.ts` | **Modify** | Add `findByKeyHash` to `WebAuthnAuthStore` |
| `src/server/auth/routes/webauthnInviteRoute.ts` | **Create** | `GET /socketAPI/webauthn/invite?requestId=xxx` handler |
| `src/server/auth/routes/webauthnInviteRoute.tests.ts` | **Create** | Unit tests for invite route |
| `src/server/auth/routes/webauthnRegisterRoute.ts` | **Create** | `POST /socketAPI/webauthn/register` handler |
| `src/server/auth/routes/webauthnRegisterRoute.tests.ts` | **Create** | Unit tests for register route |
| `src/server/auth/routes/webauthnReauthRoute.ts` | **Create** | `POST /socketAPI/webauthn/reauth` handler |
| `src/server/auth/routes/webauthnReauthRoute.tests.ts` | **Create** | Unit tests for reauth route |
| `src/server/auth/registerAuthRoutes.ts` | **Modify** | Wire all three WebAuthn routes when `mode === 'webauthn'` |
| `src/server/providers/authentication/useAuthentication.ts` | **Modify** | Add `createInvite(userId, baseUrl)` method |
| `src/server/providers/authentication/useAuthentication.tests.ts` | **Modify** | Test `createInvite` |
| `src/server/auth/defineAuthentication.ts` | **Modify** | Add `WebAuthnConfigureOptions` overload |
| `src/server/auth/defineAuthentication.tests.ts` | **Modify** | Test WebAuthn mode config |
| `src/client/hooks/useAuthentication.ts` | **Modify** | Branched `signIn`: JWT / WebAuthn register / WebAuthn reauth |
| `src/server/auth/routes/README.md` | **Modify** | Document WebAuthn routes |
| `src/server/auth/README.md` | **Modify** | Add WebAuthn section |
| `src/server/providers/authentication/README.md` | **Modify** | Document `createInvite` |

---

### Task 1: Add `findByKeyHash` to `WebAuthnAuthStore`

**Files:**
- Modify: `src/common/auth/authTypes.ts`

This method is required by the reauth route (Task 3) to look up a record by its PRF-derived key hash.

- [ ] **Step 1: Update `authTypes.ts`**

In `src/common/auth/authTypes.ts`, add `findByKeyHash` to `WebAuthnAuthStore`:

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

export interface WebAuthnAuthRecord extends SocketAPIAuthRecord {
  registrationToken?: string;
  keyHash?: string;
}

export interface WebAuthnAuthStore extends SocketAPIAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  findByKeyHash(keyHash: string): Promise<WebAuthnAuthRecord | undefined>;
}
```

- [ ] **Step 2: Run existing tests to confirm nothing is broken**

```bash
pnpm test src/common/
```

Expected: PASS (no existing tests reference `WebAuthnAuthStore` directly — this is an additive interface change)

- [ ] **Step 3: Commit**

```bash
git add src/common/auth/authTypes.ts
git commit -m "feat(auth): add findByKeyHash to WebAuthnAuthStore"
```

---

### Task 2: WebAuthn invite route

**Files:**
- Create: `src/server/auth/routes/webauthnInviteRoute.ts`
- Create: `src/server/auth/routes/webauthnInviteRoute.tests.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/auth/routes/webauthnInviteRoute.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';
import type { WebAuthnAuthStore, WebAuthnAuthRecord } from '../../../common/auth';
import { createWebauthnInviteRoute } from './webauthnInviteRoute';

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

function makeCtx(query: Record<string, string> = {}) {
  return {
    query,
    status: 0,
    body: undefined as unknown,
  };
}

async function invokeRoute(
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<{ name: string; displayName?: string }>,
  query: Record<string, string>,
) {
  let handler: (ctx: any) => Promise<void> = async () => {};
  const router = {
    get: (_path: string, fn: (ctx: any) => Promise<void>) => { handler = fn; },
  } as unknown as Router;
  createWebauthnInviteRoute(router, 'api', store, onGetUserDetails);
  const ctx = makeCtx(query);
  await handler(ctx);
  return ctx;
}

describe('createWebauthnInviteRoute', () => {
  const onGetUserDetails = vi.fn(async () => ({ name: 'Alice', displayName: 'Alice A' }));

  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when requestId query param is missing', async () => {
    const ctx = await invokeRoute(makeStore(), onGetUserDetails, {});
    expect(ctx.status).toBe(400);
  });

  it('returns 404 when no record found for requestId', async () => {
    const ctx = await invokeRoute(makeStore(undefined), onGetUserDetails, { requestId: 'unknown' });
    expect(ctx.status).toBe(404);
  });

  it('returns 400 when record is already enabled (already registered)', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 't', deviceId: 'd' });
    const ctx = await invokeRoute(store, onGetUserDetails, { requestId: 'r1' });
    expect(ctx.status).toBe(400);
  });

  it('generates registrationToken, stores it, and returns userDetails on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: '', deviceId: '' });
    const ctx = await invokeRoute(store, onGetUserDetails, { requestId: 'r1' });
    expect(ctx.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ registrationToken: expect.any(String) }));
    expect((ctx.body as any).registrationToken).toBeTruthy();
    expect((ctx.body as any).userDetails).toEqual({ name: 'Alice', displayName: 'Alice A' });
  });

  it('calls onGetUserDetails with the record userId', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'user-42', isEnabled: false, sessionToken: '', deviceId: '' });
    await invokeRoute(store, onGetUserDetails, { requestId: 'r1' });
    expect(onGetUserDetails).toHaveBeenCalledWith('user-42');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm test src/server/auth/routes/webauthnInviteRoute.tests.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the invite route**

Create `src/server/auth/routes/webauthnInviteRoute.ts`:

```ts
import crypto from 'crypto';
import type Router from 'koa-router';
import type { WebAuthnAuthStore } from '../../../common/auth';

export function createWebauthnInviteRoute(
  router: Router,
  name: string,
  store: WebAuthnAuthStore,
  onGetUserDetails: (userId: string) => Promise<{ name: string; displayName?: string }>,
): void {
  router.get(`/${name}/socketAPI/webauthn/invite`, async ctx => {
    const requestId = ctx.query['requestId'] as string | undefined;
    if (!requestId) { ctx.status = 400; return; }

    const record = await store.findById(requestId);
    if (!record) { ctx.status = 404; return; }
    if (record.isEnabled) { ctx.status = 400; return; }

    const registrationToken = crypto.randomUUID();
    await store.update(record.requestId, { registrationToken });

    const userDetails = await onGetUserDetails(record.userId);

    ctx.status = 200;
    ctx.body = { registrationToken, userDetails };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/auth/routes/webauthnInviteRoute.tests.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/routes/webauthnInviteRoute.ts src/server/auth/routes/webauthnInviteRoute.tests.ts
git commit -m "feat(auth): add WebAuthn invite route GET /socketAPI/webauthn/invite"
```

---

### Task 3: WebAuthn register route

**Files:**
- Create: `src/server/auth/routes/webauthnRegisterRoute.ts`
- Create: `src/server/auth/routes/webauthnRegisterRoute.tests.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/auth/routes/webauthnRegisterRoute.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, SocketAPIDeviceDetails } from '../../../common/auth';
import { createWebauthnRegisterRoute } from './webauthnRegisterRoute';

const deviceDetails: SocketAPIDeviceDetails = {
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

function makeCtx(body: Record<string, unknown> = {}) {
  return {
    request: { body },
    status: 0,
    body: undefined as unknown,
    set: vi.fn(),
  };
}

async function invokeRoute(store: WebAuthnAuthStore, body: Record<string, unknown>) {
  let handler: (ctx: any) => Promise<void> = async () => {};
  const router = {
    post: (_path: string, fn: (ctx: any) => Promise<void>) => { handler = fn; },
  } as unknown as Router;
  createWebauthnRegisterRoute(router, 'api', store);
  const ctx = makeCtx(body);
  await handler(ctx);
  return ctx;
}

describe('createWebauthnRegisterRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when registrationToken is missing from body', async () => {
    const ctx = await invokeRoute(makeStore(), { keyHash: 'abc' });
    expect(ctx.status).toBe(400);
  });

  it('returns 404 when no record found for registrationToken', async () => {
    const ctx = await invokeRoute(makeStore(undefined), { registrationToken: 'bad', keyHash: 'abc' });
    expect(ctx.status).toBe(404);
  });

  it('updates record with keyHash, deviceDetails, sessionToken, clears registrationToken', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const ctx = await invokeRoute(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails });
    expect(ctx.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      keyHash: 'hash1',
      deviceDetails,
      sessionToken: expect.any(String),
      isEnabled: true,
      registrationToken: undefined,
    }));
  });

  it('sets HttpOnly session cookie on success', async () => {
    const store = makeStore({
      requestId: 'r1', userId: 'u1', isEnabled: false,
      sessionToken: '', deviceId: '', registrationToken: 'tok',
    });
    const ctx = await invokeRoute(store, { registrationToken: 'tok', keyHash: 'hash1', deviceDetails });
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socketapi_session='));
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm test src/server/auth/routes/webauthnRegisterRoute.tests.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the register route**

Create `src/server/auth/routes/webauthnRegisterRoute.ts`:

```ts
import crypto from 'crypto';
import type Router from 'koa-router';
import type { WebAuthnAuthStore, SocketAPIDeviceDetails } from '../../../common/auth';

const COOKIE_NAME = 'socketapi_session';

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function createWebauthnRegisterRoute(
  router: Router,
  name: string,
  store: WebAuthnAuthStore,
): void {
  router.post(`/${name}/socketAPI/webauthn/register`, async ctx => {
    const body = ctx.request.body as Record<string, unknown>;
    const { registrationToken, keyHash, deviceDetails } = body;

    if (!registrationToken) { ctx.status = 400; return; }

    const record = await store.findByRegistrationToken(String(registrationToken));
    if (!record) { ctx.status = 404; return; }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    await store.update(record.requestId, {
      keyHash: String(keyHash ?? ''),
      deviceDetails: deviceDetails as SocketAPIDeviceDetails | undefined,
      sessionToken,
      isEnabled: true,
      registrationToken: undefined,
    });

    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/auth/routes/webauthnRegisterRoute.tests.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/routes/webauthnRegisterRoute.ts src/server/auth/routes/webauthnRegisterRoute.tests.ts
git commit -m "feat(auth): add WebAuthn register route POST /socketAPI/webauthn/register"
```

---

### Task 4: WebAuthn reauth route

**Files:**
- Create: `src/server/auth/routes/webauthnReauthRoute.ts`
- Create: `src/server/auth/routes/webauthnReauthRoute.tests.ts`

The reauth route receives the PRF-derived `keyHash` from a returning user's authenticator, looks it up in the store, and issues a fresh session cookie. No invite or registration token is involved — this is the returning-device path.

- [ ] **Step 1: Write the failing tests**

Create `src/server/auth/routes/webauthnReauthRoute.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';
import type { WebAuthnAuthStore, WebAuthnAuthRecord, SocketAPIDeviceDetails } from '../../../common/auth';
import { createWebauthnReauthRoute } from './webauthnReauthRoute';

const deviceDetails: SocketAPIDeviceDetails = {
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

function makeCtx(body: Record<string, unknown> = {}) {
  return {
    request: { body },
    status: 0,
    body: undefined as unknown,
    set: vi.fn(),
  };
}

async function invokeRoute(store: WebAuthnAuthStore, body: Record<string, unknown>) {
  let handler: (ctx: any) => Promise<void> = async () => {};
  const router = {
    post: (_path: string, fn: (ctx: any) => Promise<void>) => { handler = fn; },
  } as unknown as Router;
  createWebauthnReauthRoute(router, 'api', store);
  const ctx = makeCtx(body);
  await handler(ctx);
  return ctx;
}

describe('createWebauthnReauthRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when keyHash is missing from body', async () => {
    const ctx = await invokeRoute(makeStore(), {});
    expect(ctx.status).toBe(400);
  });

  it('returns 401 when no record found for keyHash', async () => {
    const ctx = await invokeRoute(makeStore(undefined), { keyHash: 'unknown' });
    expect(ctx.status).toBe(401);
  });

  it('returns 401 when record exists but is disabled', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: false, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const ctx = await invokeRoute(store, { keyHash: 'h1' });
    expect(ctx.status).toBe(401);
  });

  it('issues a fresh session token and updates the record on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const ctx = await invokeRoute(store, { keyHash: 'h1', deviceDetails });
    expect(ctx.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      sessionToken: expect.any(String),
      lastConnectedAt: expect.any(Number),
      deviceDetails,
    }));
    const newToken = (store.update as ReturnType<typeof vi.fn>).mock.calls[0][1].sessionToken;
    expect(newToken).not.toBe('old');
  });

  it('sets HttpOnly session cookie on success', async () => {
    const store = makeStore({ requestId: 'r1', userId: 'u1', isEnabled: true, sessionToken: 'old', deviceId: 'd', keyHash: 'h1' });
    const ctx = await invokeRoute(store, { keyHash: 'h1' });
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('socketapi_session='));
    expect(ctx.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'));
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm test src/server/auth/routes/webauthnReauthRoute.tests.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the reauth route**

Create `src/server/auth/routes/webauthnReauthRoute.ts`:

```ts
import crypto from 'crypto';
import type Router from 'koa-router';
import type { WebAuthnAuthStore, SocketAPIDeviceDetails } from '../../../common/auth';

const COOKIE_NAME = 'socketapi_session';

function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
}

export function createWebauthnReauthRoute(
  router: Router,
  name: string,
  store: WebAuthnAuthStore,
): void {
  router.post(`/${name}/socketAPI/webauthn/reauth`, async ctx => {
    const body = ctx.request.body as Record<string, unknown>;
    const { keyHash, deviceDetails } = body;

    if (!keyHash) { ctx.status = 400; return; }

    const record = await store.findByKeyHash(String(keyHash));
    if (!record || !record.isEnabled) { ctx.status = 401; return; }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    await store.update(record.requestId, {
      sessionToken,
      lastConnectedAt: Date.now(),
      deviceDetails: deviceDetails as SocketAPIDeviceDetails | undefined,
    });

    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/auth/routes/webauthnReauthRoute.tests.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/routes/webauthnReauthRoute.ts src/server/auth/routes/webauthnReauthRoute.tests.ts
git commit -m "feat(auth): add WebAuthn reauth route POST /socketAPI/webauthn/reauth"
```

---

### Task 5: Wire WebAuthn routes in `registerAuthRoutes`

**Files:**
- Modify: `src/server/auth/registerAuthRoutes.ts`

- [ ] **Step 1: Update `registerAuthRoutes.ts`**

Replace the full contents of `src/server/auth/registerAuthRoutes.ts` with:

```ts
import Router from 'koa-router';
import type { AuthConfig } from './authConfig';
import { createSigninRoute } from './routes/signinRoute';
import { createSignoutRoute } from './routes/signoutRoute';
import { createWebauthnInviteRoute } from './routes/webauthnInviteRoute';
import { createWebauthnRegisterRoute } from './routes/webauthnRegisterRoute';
import { createWebauthnReauthRoute } from './routes/webauthnReauthRoute';

export function registerAuthRoutes(router: Router, name: string, config: AuthConfig): void {
  if (config.mode === 'jwt') {
    createSigninRoute(router, name, config.store, config.onAuthenticate);
  }
  if (config.mode === 'webauthn') {
    createWebauthnInviteRoute(router, name, config.store, config.onGetUserDetails);
    createWebauthnRegisterRoute(router, name, config.store);
    createWebauthnReauthRoute(router, name, config.store);
  }
  createSignoutRoute(router, name, config.store);
}
```

- [ ] **Step 2: Run all auth tests to confirm no regressions**

```bash
pnpm test src/server/auth/
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/auth/registerAuthRoutes.ts
git commit -m "feat(auth): register all WebAuthn routes when mode is webauthn"
```

---

### Task 6: Add `createInvite` to server `useAuthentication`

**Files:**
- Modify: `src/server/providers/authentication/useAuthentication.ts`
- Modify: `src/server/providers/authentication/useAuthentication.tests.ts`

- [ ] **Step 1: Write the failing tests**

Add these test cases to `src/server/providers/authentication/useAuthentication.tests.ts`:

```ts
// At top of file add:
import { getAuthConfig } from '../../auth/authConfig';

// Add these inside the existing describe('server useAuthentication', ...) block:

  describe('createInvite', () => {
    it('is a function on the returned object', () => {
      const auth = useAuthentication();
      expect(typeof auth.createInvite).toBe('function');
    });

    it('throws when auth mode is not webauthn', async () => {
      vi.mocked(getAuthConfig).mockReturnValue({ mode: 'jwt', store: {} as any, onAuthenticate: vi.fn(), onGetUser: vi.fn(), syncUserToClient: true });
      const auth = useAuthentication();
      await expect(auth.createInvite('u1', 'https://app.com')).rejects.toThrow('createInvite is only available in webauthn mode');
    });

    it('creates a store record and returns invite URL containing requestId', async () => {
      const storeMock = {
        create: vi.fn(),
        findById: vi.fn(),
        findBySessionToken: vi.fn(),
        findByDevice: vi.fn(),
        findByRegistrationToken: vi.fn(),
        findByKeyHash: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(getAuthConfig).mockReturnValue({
        mode: 'webauthn',
        store: storeMock,
        onGetUserDetails: vi.fn(),
        onGetUser: vi.fn(),
        syncUserToClient: true,
      });
      const auth = useAuthentication();
      const url = await auth.createInvite('user-99', 'https://myapp.com');
      expect(storeMock.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-99',
        isEnabled: false,
        sessionToken: '',
        deviceId: '',
      }));
      expect(url).toMatch(/^https:\/\/myapp\.com\?requestId=.+/);
    });
  });
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
pnpm test src/server/providers/authentication/useAuthentication.tests.ts
```

Expected: FAIL — `auth.createInvite is not a function`

- [ ] **Step 3: Implement `createInvite` in `useAuthentication.ts`**

Replace the full contents of `src/server/providers/authentication/useAuthentication.ts` with:

```ts
import crypto from 'crypto';
import type { MakePromise } from '@anupheaus/common';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserChanged } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, wrap } from '../../async-context/socketApiContext';
import { getAuthConfig } from '../../auth/authConfig';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser>() {
  function getUser(): UserType | undefined {
    return useAuthData()?.user as UserType | undefined;
  }

  async function setUser(user: UserType | undefined) {
    const { getClient } = internalUseSocket();
    const emitUserChanged = useEvent(socketAPIUserChanged);

    const existingAuthData = useAuthData() ?? {};
    setAuthData({ ...existingAuthData, user });

    const authConfig = getAuthConfig();
    const syncUserToClient = authConfig?.syncUserToClient ?? true;

    if (syncUserToClient) {
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

  async function createInvite(userId: string, baseUrl: string): Promise<string> {
    const authConfig = getAuthConfig();
    if (!authConfig || authConfig.mode !== 'webauthn') {
      throw new Error('createInvite is only available in webauthn mode');
    }
    const requestId = crypto.randomUUID();
    await authConfig.store.create({
      requestId,
      userId,
      isEnabled: false,
      sessionToken: '',
      deviceId: '',
    });
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}?requestId=${requestId}`;
  }

  return {
    get user() { return getUser(); },
    setUser,
    signOut,
    impersonateUser,
    createInvite,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/providers/authentication/useAuthentication.tests.ts
```

Expected: PASS (all existing + 3 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/authentication/useAuthentication.ts src/server/providers/authentication/useAuthentication.tests.ts
git commit -m "feat(auth): add createInvite to server useAuthentication for WebAuthn mode"
```

---

### Task 7: WebAuthn mode in server `defineAuthentication`

**Files:**
- Modify: `src/server/auth/defineAuthentication.ts`
- Modify: `src/server/auth/defineAuthentication.tests.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/server/auth/defineAuthentication.tests.ts`:

```ts
// Add at top of file:
import type { WebAuthnAuthStore } from '../../common/auth';

// Add these inside the existing describe block:

  it('configureAuthentication accepts webauthn mode', () => {
    const webauthnStore: WebAuthnAuthStore = {
      create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
      findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
      findByKeyHash: vi.fn(), update: vi.fn(),
    };
    const { configureAuthentication } = defineAuthentication<TestUser>();
    const config = configureAuthentication({
      mode: 'webauthn',
      store: webauthnStore,
      onGetUserDetails: async () => ({ name: 'Alice' }),
      onGetUser: async () => undefined,
    });
    expect(config.mode).toBe('webauthn');
    expect((config as any).syncUserToClient).toBe(true);
  });

  it('webauthn configureAuthentication respects syncUserToClient: false', () => {
    const webauthnStore: WebAuthnAuthStore = {
      create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
      findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
      findByKeyHash: vi.fn(), update: vi.fn(),
    };
    const { configureAuthentication } = defineAuthentication<TestUser>();
    const config = configureAuthentication({
      mode: 'webauthn',
      store: webauthnStore,
      onGetUserDetails: async () => ({ name: 'Alice' }),
      onGetUser: async () => undefined,
      syncUserToClient: false,
    });
    expect((config as any).syncUserToClient).toBe(false);
  });
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
pnpm test src/server/auth/defineAuthentication.tests.ts
```

Expected: FAIL — TypeScript error or runtime failure on webauthn mode

- [ ] **Step 3: Update `defineAuthentication.ts`**

Replace the full contents of `src/server/auth/defineAuthentication.ts` with:

```ts
import type { SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';
import type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
import { useAuthentication } from '../providers/authentication/useAuthentication';
import type { MakePromise } from '@anupheaus/common';

export interface JwtConfigureOptions<U extends SocketAPIUser, C> {
  mode: 'jwt';
  store: JwtAuthStore;
  onAuthenticate(credentials: C): Promise<U | undefined>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface WebAuthnConfigureOptions<U extends SocketAPIUser> {
  mode: 'webauthn';
  store: WebAuthnAuthStore;
  onGetUserDetails(userId: string): Promise<{ name: string; displayName?: string }>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface ServerUseAuthResult<U extends SocketAPIUser> {
  readonly user: U | undefined;
  setUser(user: U | undefined): Promise<void>;
  signOut(): Promise<void>;
  impersonateUser<T>(user: U, handler: () => T): MakePromise<T>;
  createInvite(userId: string, baseUrl: string): Promise<string>;
}

export function defineAuthentication<U extends SocketAPIUser, C = void>() {
  function configureAuthentication(options: JwtConfigureOptions<U, C> | WebAuthnConfigureOptions<U>): AuthConfig {
    if (options.mode === 'webauthn') {
      const config: WebAuthnAuthConfig = {
        mode: 'webauthn',
        store: options.store,
        onGetUserDetails: options.onGetUserDetails,
        onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
        syncUserToClient: options.syncUserToClient ?? true,
      };
      return config;
    }
    const config: JwtAuthConfig = {
      mode: 'jwt',
      store: (options as JwtConfigureOptions<U, C>).store,
      onAuthenticate: (options as JwtConfigureOptions<U, C>).onAuthenticate as (credentials: unknown) => Promise<SocketAPIUser | undefined>,
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/auth/defineAuthentication.tests.ts
```

Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/defineAuthentication.ts src/server/auth/defineAuthentication.tests.ts
git commit -m "feat(auth): add WebAuthn mode to server defineAuthentication"
```

---

### Task 8: Client WebAuthn `signIn()` — registration and re-auth

**Files:**
- Modify: `src/client/hooks/useAuthentication.ts`

`signIn()` branches at runtime based on credentials and URL:
- `credentials` is an object → JWT flow (existing)
- `credentials` is `undefined` + `?requestId=` in URL → WebAuthn registration (first-time device, via invite link)
- `credentials` is `undefined` + no `?requestId=` → WebAuthn re-auth (returning device, discoverable credential)

Both WebAuthn paths use the PRF extension to derive the same `keyHash` from the same passkey — the browser's passkey manager surfaces the right credential automatically without `allowCredentials`.

- [ ] **Step 1: Replace `src/client/hooks/useAuthentication.ts`**

```ts
import { useReducer, useRef, useContext, useCallback, useEffect } from 'react';
import type { SocketAPIUser } from '../../common';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { collectDeviceDetails } from '../auth/collectDeviceDetails';
import { computeDeviceId } from '../auth/computeDeviceId';

export interface ClientUseAuthResult<U, C> {
  readonly user: U | undefined;
  signIn(credentials: C): Promise<void>;
  signOut(): Promise<void>;
}

async function computeKeyHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getPrfResult(credential: PublicKeyCredential): ArrayBuffer | undefined {
  return (credential.getClientExtensionResults() as any).prf?.results?.first as ArrayBuffer | undefined;
}

async function performWebAuthnRegistration(name: string, reconnect: () => void): Promise<void> {
  const requestId = new URLSearchParams(window.location.search).get('requestId');
  if (!requestId) throw new Error('WebAuthn registration requires a ?requestId= query parameter (from invite URL)');

  const inviteRes = await fetch(`/${name}/socketAPI/webauthn/invite?requestId=${encodeURIComponent(requestId)}`, {
    credentials: 'include',
  });
  if (!inviteRes.ok) throw new Error(`Invite fetch failed: ${inviteRes.status}`);
  const { registrationToken, userDetails } = await inviteRes.json() as {
    registrationToken: string;
    userDetails: { name: string; displayName?: string };
  };

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: new TextEncoder().encode(registrationToken),
      rp: { id: window.location.hostname, name: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userDetails.name),
        name: userDetails.name,
        displayName: userDetails.displayName ?? userDetails.name,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: { userVerification: 'required' },
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('socket-api-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey creation cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const details = collectDeviceDetails();

  const regRes = await fetch(`/${name}/socketAPI/webauthn/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ registrationToken, keyHash, deviceDetails: details }),
  });
  if (!regRes.ok) throw new Error(`WebAuthn registration failed: ${regRes.status}`);

  const url = new URL(window.location.href);
  url.searchParams.delete('requestId');
  window.history.replaceState({}, '', url.toString());

  reconnect();
}

async function performWebAuthnReauth(name: string, reconnect: () => void): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('socket-api-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey authentication cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const details = collectDeviceDetails();

  const res = await fetch(`/${name}/socketAPI/webauthn/reauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ keyHash, deviceDetails: details }),
  });
  if (!res.ok) throw new Error(`WebAuthn re-authentication failed: ${res.status}`);

  reconnect();
}

async function performJwtSignIn<C>(name: string, credentials: C, reconnect: () => void): Promise<void> {
  const details = collectDeviceDetails();
  const deviceId = await computeDeviceId(details);
  const res = await fetch(`/${name}/socketAPI/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...(credentials as any), deviceId, deviceDetails: details }),
  });
  if (!res.ok) throw new Error(`Sign in failed: ${res.status}`);
  reconnect();
}

export function useAuthentication<U extends SocketAPIUser = SocketAPIUser, C = void>(): ClientUseAuthResult<U, C> {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const userRef = useRef<U | undefined>(undefined);
  const isUserAccessedRef = useRef(false);
  const { name, reconnect, on, off } = useContext(SocketContext);

  const hookId = useRef(`useAuthentication-${Math.random()}`).current;
  const eventName = `${eventPrefix}.${socketAPIUserChanged.name}`;
  on(hookId, eventName, (payload: { user: U | undefined }) => {
    userRef.current = payload.user;
    if (isUserAccessedRef.current) forceUpdate();
  });

  useEffect(() => {
    return () => off(hookId, eventName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (credentials?: C) => {
    if (credentials == null) {
      const hasInvite = new URLSearchParams(window.location.search).has('requestId');
      if (hasInvite) {
        await performWebAuthnRegistration(name, reconnect);
      } else {
        await performWebAuthnReauth(name, reconnect);
      }
    } else {
      await performJwtSignIn(name, credentials, reconnect);
    }
  }, [name, reconnect]) as (credentials: C) => Promise<void>;

  const signOut = useCallback(async () => {
    await fetch(`/${name}/socketAPI/signout`, { method: 'POST', credentials: 'include' });
    userRef.current = undefined;
    if (isUserAccessedRef.current) forceUpdate();
    reconnect();
  }, [name, reconnect]);

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

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/client/hooks/useAuthentication.ts
git commit -m "feat(auth): client signIn branches JWT / WebAuthn register / WebAuthn reauth"
```

---

### Task 9: Update READMEs

**Files:**
- Modify: `src/server/auth/routes/README.md`
- Modify: `src/server/auth/README.md`
- Modify: `src/server/providers/authentication/README.md`

- [ ] **Step 1: Read current READMEs**

Read each file before editing:
- `src/server/auth/routes/README.md`
- `src/server/auth/README.md`
- `src/server/providers/authentication/README.md`

- [ ] **Step 2: Update `src/server/auth/routes/README.md`**

Add the three WebAuthn route files to the file table:

```markdown
| `webauthnInviteRoute.ts` | `GET /{name}/socketAPI/webauthn/invite?requestId=xxx` — validates invite, generates registrationToken, returns userDetails |
| `webauthnRegisterRoute.ts` | `POST /{name}/socketAPI/webauthn/register` — validates registrationToken, stores keyHash, sets session cookie |
| `webauthnReauthRoute.ts` | `POST /{name}/socketAPI/webauthn/reauth` — looks up record by keyHash, issues fresh session cookie |
```

- [ ] **Step 3: Update `src/server/auth/README.md`**

Add a WebAuthn section documenting both flows:
- **Registration** (first-time device): invite URL → `GET /invite` → browser passkey ceremony (`credentials.create`) → `POST /register`
- **Re-authentication** (returning device): browser passkey discovery (`credentials.get`, no `allowCredentials`) → `POST /reauth`

- [ ] **Step 4: Update `src/server/providers/authentication/README.md`**

Add `createInvite` to the return-type table:

```markdown
| `createInvite(userId, baseUrl)` | `Promise<string>` | Creates an invite record in the store, returns `${baseUrl}?requestId=<id>`. WebAuthn mode only — throws in JWT mode. |
```

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/routes/README.md src/server/auth/README.md src/server/providers/authentication/README.md
git commit -m "docs(auth): document WebAuthn routes including reauth, and createInvite"
```

---

## Self-Review

### Spec coverage

| Spec section | Covered by task |
|---|---|
| §1 `defineAuthentication` API | Task 7 |
| §2 Package entry points (node/browser) | Already exists — no change needed |
| §3 `useAuthentication` server return (`createInvite`) | Task 6 |
| §3 `useAuthentication` client WebAuthn `signIn()` | Task 8 |
| §4 Client reactivity (accessed-flag pattern) | Already exists — no change needed |
| §5 `configureAuthentication` JWT options | Already exists — no change needed |
| §5 `configureAuthentication` WebAuthn options | Task 7 |
| §6 Device details / deviceId hash | Already exists — no change needed |
| §7 Auth store interfaces | Task 1 (`findByKeyHash`); rest already exists |
| §8 Session token security | Tasks 3, 4 (register/reauth both rotate token) |
| §9 JWT endpoints | Already exists — no change needed |
| §9 WebAuthn invite endpoint | Task 2 |
| §9 WebAuthn register endpoint | Task 3 |
| §9 `createInvite` server-side | Task 6 |
| §10 Socket connect flow | Already exists — no change needed |
| §11 Client socket lifecycle | Task 8 (reconnect calls in all three branches) |
| §12 Internal socket events | Already exists — no change needed |
| §13 `startServer` changes (no legacy fields) | Already done |
| §14 Backward compatibility | Sub-path imports unchanged |
| Re-auth (added to scope) | Task 4 (server route) + Task 8 (client branch) |

### Placeholder scan

No TBDs, TODOs, or "similar to Task N" patterns. All tasks contain complete code.

### Type consistency

- `WebAuthnAuthStore.findByKeyHash` — added in Task 1, used in Task 4 route and Task 6 `useAuthentication` test mock. ✓
- `WebAuthnAuthRecord.registrationToken` — used in Task 2 (invite, set) and Task 3 (register, clear). ✓
- `WebAuthnAuthRecord.keyHash` — set in Task 3 (register), looked up via `findByKeyHash` in Task 4 (reauth). ✓
- `createInvite(userId, baseUrl)` — implemented in Task 6, typed in Task 7 `ServerUseAuthResult`. ✓
- `getPrfResult` helper — defined once in Task 8, used in both `performWebAuthnRegistration` and `performWebAuthnReauth`. ✓
- PRF salt `'socket-api-auth'` — identical string in both `credentials.create` (Task 8 registration) and `credentials.get` (Task 8 reauth), ensuring same `keyHash` from same passkey. ✓
