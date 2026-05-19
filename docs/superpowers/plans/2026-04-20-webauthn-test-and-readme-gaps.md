# WebAuthn Test & README Gap Fill Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill all test coverage gaps and fix all stale README documentation left after the WebAuthn authentication implementation.

**Architecture:** Four self-contained tasks — README fixes first (no tests needed, safe to do solo), then missing test files, then missing tests inside existing files. Each task commits independently.

**Tech Stack:** Vitest, @testing-library/react (renderHook/act), koa-router, TypeScript

---

## File structure

| File | Action | Reason |
|------|--------|--------|
| `src/common/auth/README.md` | Modify | Completely stale — still documents non-existent `saveToken`/`loadToken` API |
| `src/server/auth/README.md` | Modify | Title says "JWT Authentication" but doc now covers both JWT and WebAuthn |
| `src/client/hooks/README.md` | Modify | Line 12 says `useAuthentication.ts` "Re-exports from `client/auth`" — it is the full implementation |
| `src/server/auth/registerAuthRoutes.tests.ts` | Create | No tests exist for this file at all |
| `src/client/hooks/useAuthentication.tests.ts` | Modify | Add: JWT signIn branch, WebAuthn registration branch, WebAuthn re-auth branch, signOut behaviour, unmount cleanup |
| `src/server/providers/authentication/useAuthentication.tests.ts` | Modify | Add: trailing-slash `baseUrl` trimming, UUID format of generated `requestId` |

---

### Task 1: Fix stale READMEs

**Files:**
- Modify: `src/common/auth/README.md`
- Modify: `src/server/auth/README.md`
- Modify: `src/client/hooks/README.md`

No failing test — these are documentation fixes. Write the content, verify with a quick read, commit.

- [ ] **Step 1: Rewrite `src/common/auth/README.md`**

The current file documents `saveToken`/`loadToken` — those methods do not exist in the actual `authTypes.ts`. Replace the entire file with:

```markdown
# common/auth — Shared Auth Type Definitions

Shared authentication interfaces and records used by both the client and server auth modules.

## Files

| File | Purpose |
|------|---------|
| `authTypes.ts` | Defines the base `NexusAuthStore` interface plus JWT and WebAuthn store/record specialisations |

## Base interfaces

```ts
interface NexusAuthRecord {
  requestId: string;
  sessionToken: string;
  userId: string;
  deviceId: string;
  isEnabled: boolean;
  deviceDetails?: NexusDeviceDetails;
  lastConnectedAt?: number;
}

interface NexusAuthStore<TRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}
```

## JWT

`JwtAuthRecord` and `JwtAuthStore` extend the base types directly — no extra fields or methods are required.

## WebAuthn

```ts
interface WebAuthnAuthRecord extends NexusAuthRecord {
  registrationToken?: string; // set by invite route; cleared after registration
  keyHash?: string;           // SHA-256 hex of PRF-derived key; set at registration
}

interface WebAuthnAuthStore extends NexusAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  findByKeyHash(keyHash: string): Promise<WebAuthnAuthRecord | undefined>;
}
```

`keyHash` is the deterministic output of the WebAuthn PRF extension using salt `'socket-api-auth'`. It is the same on every re-authentication from the same device passkey, enabling passwordless re-auth without storing a credential ID.

Pass a `WebAuthnAuthStore` implementation to `defineAuthentication({ mode: 'webauthn', store: ... })` on the server.
```

- [ ] **Step 2: Fix the title in `src/server/auth/README.md`**

Change line 1 from:
```
# server/auth — JWT Authentication
```
to:
```
# server/auth — Authentication (JWT & WebAuthn)
```

- [ ] **Step 3: Fix the misleading description in `src/client/hooks/README.md`**

Change line 12 from:
```
| `useAuthentication.ts` | Re-exports from `client/auth` — access current user and auth methods |
```
to:
```
| `useAuthentication.ts` | React hook providing current user, `signIn`, and `signOut`. Automatically routes to JWT sign-in, WebAuthn registration (when `?requestId=` is in the URL), or WebAuthn re-auth depending on call site |
```

- [ ] **Step 4: Commit**

```bash
git add src/common/auth/README.md src/server/auth/README.md src/client/hooks/README.md
git commit -m "docs: fix stale README files after WebAuthn auth implementation"
```

---

### Task 2: Add `registerAuthRoutes.tests.ts`

**Files:**
- Create: `src/server/auth/registerAuthRoutes.tests.ts`

Reference: `src/server/auth/registerAuthRoutes.ts` (the file under test — read it first):

```ts
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

The test strategy is to mock all five route creator functions so they become spy functions, then assert which ones are called (and with what arguments) for each auth mode.

- [ ] **Step 1: Write the test file**

Create `src/server/auth/registerAuthRoutes.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';

const {
  mockCreateSigninRoute,
  mockCreateSignoutRoute,
  mockCreateWebauthnInviteRoute,
  mockCreateWebauthnRegisterRoute,
  mockCreateWebauthnReauthRoute,
} = vi.hoisted(() => ({
  mockCreateSigninRoute: vi.fn(),
  mockCreateSignoutRoute: vi.fn(),
  mockCreateWebauthnInviteRoute: vi.fn(),
  mockCreateWebauthnRegisterRoute: vi.fn(),
  mockCreateWebauthnReauthRoute: vi.fn(),
}));

vi.mock('./routes/signinRoute', () => ({ createSigninRoute: mockCreateSigninRoute }));
vi.mock('./routes/signoutRoute', () => ({ createSignoutRoute: mockCreateSignoutRoute }));
vi.mock('./routes/webauthnInviteRoute', () => ({ createWebauthnInviteRoute: mockCreateWebauthnInviteRoute }));
vi.mock('./routes/webauthnRegisterRoute', () => ({ createWebauthnRegisterRoute: mockCreateWebauthnRegisterRoute }));
vi.mock('./routes/webauthnReauthRoute', () => ({ createWebauthnReauthRoute: mockCreateWebauthnReauthRoute }));

import { registerAuthRoutes } from './registerAuthRoutes';
import type { JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';

describe('registerAuthRoutes', () => {
  let router: Router;

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

  const webauthnStore = {} as any;
  const onGetUserDetails = vi.fn();

  const webauthnConfig: WebAuthnAuthConfig = {
    mode: 'webauthn',
    store: webauthnStore,
    onGetUserDetails,
    onGetUser,
    syncUserToClient: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
  });

  describe('jwt mode', () => {
    it('registers the signin route with the correct arguments', () => {
      registerAuthRoutes(router, 'api', jwtConfig);
      expect(mockCreateSigninRoute).toHaveBeenCalledOnce();
      expect(mockCreateSigninRoute).toHaveBeenCalledWith(router, 'api', jwtStore, onAuthenticate);
    });

    it('registers the signout route', () => {
      registerAuthRoutes(router, 'api', jwtConfig);
      expect(mockCreateSignoutRoute).toHaveBeenCalledOnce();
      expect(mockCreateSignoutRoute).toHaveBeenCalledWith(router, 'api', jwtStore);
    });

    it('does not register any WebAuthn routes', () => {
      registerAuthRoutes(router, 'api', jwtConfig);
      expect(mockCreateWebauthnInviteRoute).not.toHaveBeenCalled();
      expect(mockCreateWebauthnRegisterRoute).not.toHaveBeenCalled();
      expect(mockCreateWebauthnReauthRoute).not.toHaveBeenCalled();
    });
  });

  describe('webauthn mode', () => {
    it('registers the invite route with store and onGetUserDetails', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateWebauthnInviteRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteRoute).toHaveBeenCalledWith(router, 'api', webauthnStore, onGetUserDetails);
    });

    it('registers the register route with store', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateWebauthnRegisterRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);
    });

    it('registers the reauth route with store', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateWebauthnReauthRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);
    });

    it('registers the signout route', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateSignoutRoute).toHaveBeenCalledOnce();
      expect(mockCreateSignoutRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);
    });

    it('does not register the signin route', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateSigninRoute).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they pass**

```bash
pnpm test src/server/auth/registerAuthRoutes.tests.ts
```

Expected: 7 tests passing.

- [ ] **Step 3: Commit**

```bash
git add src/server/auth/registerAuthRoutes.tests.ts
git commit -m "test(auth): add registerAuthRoutes tests for jwt and webauthn route wiring"
```

---

### Task 3: Expand client `useAuthentication` tests

**Files:**
- Modify: `src/client/hooks/useAuthentication.tests.ts`

Read both `src/client/hooks/useAuthentication.ts` and the existing test file first so you understand what is already tested.

The current test file (5 tests) covers: initial user undefined, function shapes, `on` registration, lazy re-render optimisation, and user getter. It does NOT test `signIn` (any branch) or `signOut`.

The `signIn` callback has three branches, controlled by two conditions:
1. `credentials != null` → JWT path → calls `performJwtSignIn`
2. `credentials == null && window.location.search` has `requestId` → WebAuthn registration path
3. `credentials == null && no requestId` → WebAuthn re-auth path

Each internal helper (`performJwtSignIn`, `performWebAuthnRegistration`, `performWebAuthnReauth`) calls `fetch` and/or `navigator.credentials` APIs, then calls `reconnect()`.

**Mock strategy:**
- `fetch` → `vi.stubGlobal('fetch', mockFetch)` (in `beforeAll`)
- `navigator.credentials.create` / `.get` → `vi.stubGlobal('navigator', { credentials: { create: ..., get: ... } })`
- `crypto.subtle.digest` and `crypto.getRandomValues` → `vi.stubGlobal('crypto', { ... })`
- `window.location` → `Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ... } })`
- `window.history.replaceState` → `vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})`
- `collectDeviceDetails` → `vi.mock('../auth/collectDeviceDetails', ...)`
- `computeDeviceId` → `vi.mock('../auth/computeDeviceId', ...)`

- [ ] **Step 1: Replace the test file with the expanded version**

Replace `src/client/hooks/useAuthentication.tests.ts` with:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthentication } from './useAuthentication';

// ── hoisted mocks (must be before any imports that use them) ─────────────────
const { mockOn, mockOff, mockReconnect, mockConnect, mockDisconnect } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
  mockConnect: vi.fn(() => Promise.resolve()),
  mockDisconnect: vi.fn(() => Promise.resolve()),
}));

vi.mock('../providers/socket/SocketContext', () => ({
  SocketContext: {
    _currentValue: {
      name: 'test',
      reconnect: mockReconnect,
      connect: mockConnect,
      disconnect: mockDisconnect,
      on: mockOn,
      off: mockOff,
      getSocket: vi.fn(),
      getRawSocket: vi.fn(),
      onConnectionStateChanged: vi.fn(),
      onExclusive: vi.fn(),
    },
  },
}));

vi.mock('../auth/collectDeviceDetails', () => ({
  collectDeviceDetails: vi.fn(() => ({
    userAgent: 'test', platform: 'test', language: 'en',
    hardwareConcurrency: 4, maxTouchPoints: 0, vendor: 'test',
    screenWidth: 1920, screenHeight: 1080, viewportWidth: 1920,
    viewportHeight: 1080, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
  })),
}));

vi.mock('../auth/computeDeviceId', () => ({
  computeDeviceId: vi.fn(() => Promise.resolve('device-test-123')),
}));

// ── global browser API mocks ──────────────────────────────────────────────────
const mockFetch = vi.fn();
const mockCredentialsCreate = vi.fn();
const mockCredentialsGet = vi.fn();
const mockDigest = vi.fn(() => Promise.resolve(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer));

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('navigator', {
    credentials: { create: mockCredentialsCreate, get: mockCredentialsGet },
  });
  vi.stubGlobal('crypto', {
    getRandomValues: (arr: Uint8Array) => arr.fill(1),
    subtle: { digest: mockDigest },
  });
});

// Helper: build a mock PublicKeyCredential that returns a PRF result
function makeMockCredential() {
  return {
    getClientExtensionResults: () => ({
      prf: { results: { first: new Uint8Array([1, 2, 3, 4]).buffer } },
    }),
  } as unknown as PublicKeyCredential;
}

// Helper: set window.location.search without navigation
function setLocationSearch(search: string) {
  const href = `http://localhost/${search}`;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { search, href, hostname: 'localhost' },
  });
}

describe('client useAuthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocationSearch('');
  });

  // ── existing coverage ──────────────────────────────────────────────────────

  it('user is undefined initially', () => {
    const { result } = renderHook(() => useAuthentication());
    expect(result.current.user).toBeUndefined();
  });

  it('exposes signIn and signOut functions', () => {
    const { result } = renderHook(() => useAuthentication());
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });

  it('registers an event listener via on during render', () => {
    renderHook(() => useAuthentication());
    expect(mockOn).toHaveBeenCalledWith(
      expect.stringContaining('useAuthentication'),
      'socket-api.events.socketAPIUserChanged',
      expect.any(Function),
    );
  });

  it('does not re-render when user changes and user was not accessed', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useAuthentication();
    });
    const initialCount = renderCount;
    expect(typeof result.current.signOut).toBe('function');
    expect(renderCount).toBe(initialCount);
  });

  it('accessing user enables the reactive re-render flag', () => {
    const { result } = renderHook(() => useAuthentication());
    const _user = result.current.user;
    expect(_user).toBeUndefined();
  });

  // ── signOut ────────────────────────────────────────────────────────────────

  describe('signOut', () => {
    it('calls the signout endpoint and then reconnects', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useAuthentication());
      await act(async () => {
        await result.current.signOut();
      });
      expect(mockFetch).toHaveBeenCalledWith(
        '/test/socketAPI/signout',
        { method: 'POST', credentials: 'include' },
      );
      expect(mockReconnect).toHaveBeenCalled();
    });
  });

  // ── unmount cleanup ────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('deregisters the event listener on unmount', () => {
      const { unmount } = renderHook(() => useAuthentication());
      unmount();
      expect(mockOff).toHaveBeenCalledWith(
        expect.stringContaining('useAuthentication'),
        'socket-api.events.socketAPIUserChanged',
      );
    });
  });

  // ── signIn — JWT branch ────────────────────────────────────────────────────

  describe('signIn with credentials (JWT)', () => {
    it('posts to the signin endpoint with credentials and device info', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useAuthentication<any, { email: string }>());
      await act(async () => {
        await result.current.signIn({ email: 'a@b.com' });
      });
      expect(mockFetch).toHaveBeenCalledWith(
        '/test/socketAPI/signin',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.email).toBe('a@b.com');
      expect(body.deviceId).toBe('device-test-123');
    });

    it('calls reconnect after successful JWT sign-in', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useAuthentication<any, { email: string }>());
      await act(async () => {
        await result.current.signIn({ email: 'a@b.com' });
      });
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when the signin endpoint returns a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const { result } = renderHook(() => useAuthentication<any, { email: string }>());
      await expect(
        act(async () => { await result.current.signIn({ email: 'bad@b.com' }); }),
      ).rejects.toThrow('Sign in failed: 401');
    });
  });

  // ── signIn — WebAuthn registration branch ─────────────────────────────────

  describe('signIn without credentials + ?requestId (WebAuthn registration)', () => {
    beforeEach(() => {
      setLocationSearch('?requestId=test-req-id-123');
      vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    });

    it('fetches the invite then posts to the register endpoint', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            registrationToken: 'reg-token-abc',
            userDetails: { name: 'alice', displayName: 'Alice' },
          }),
        })
        .mockResolvedValueOnce({ ok: true });
      mockCredentialsCreate.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => {
        await (result.current.signIn as any)();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/invite?requestId=test-req-id-123'),
        expect.objectContaining({ credentials: 'include' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/register'),
        expect.objectContaining({ method: 'POST' }),
      );
      const registerBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      expect(registerBody.registrationToken).toBe('reg-token-abc');
      expect(typeof registerBody.keyHash).toBe('string');
      expect(registerBody.keyHash).toHaveLength(64); // SHA-256 hex = 32 bytes = 64 hex chars
    });

    it('removes ?requestId from the URL after successful registration', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ registrationToken: 'tok', userDetails: { name: 'alice' } }),
        })
        .mockResolvedValueOnce({ ok: true });
      mockCredentialsCreate.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => {
        await (result.current.signIn as any)();
      });

      expect(window.history.replaceState).toHaveBeenCalled();
      const replacedUrl = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(replacedUrl).not.toContain('requestId');
    });

    it('calls reconnect after successful registration', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ registrationToken: 'tok', userDetails: { name: 'alice' } }),
        })
        .mockResolvedValueOnce({ ok: true });
      mockCredentialsCreate.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => {
        await (result.current.signIn as any)();
      });
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when the invite fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('Invite fetch failed: 404');
    });

    it('throws when navigator.credentials.create returns null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ registrationToken: 'tok', userDetails: { name: 'alice' } }),
      });
      mockCredentialsCreate.mockResolvedValueOnce(null);
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('Passkey creation cancelled or failed');
    });
  });

  // ── signIn — WebAuthn re-auth branch ──────────────────────────────────────

  describe('signIn without credentials + no ?requestId (WebAuthn re-auth)', () => {
    beforeEach(() => {
      setLocationSearch('');
    });

    it('calls navigator.credentials.get and posts to the reauth endpoint', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => {
        await (result.current.signIn as any)();
      });

      expect(mockCredentialsGet).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/socketAPI/webauthn/reauth'),
        expect.objectContaining({ method: 'POST' }),
      );
      const reauthBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(typeof reauthBody.keyHash).toBe('string');
      expect(reauthBody.keyHash).toHaveLength(64);
    });

    it('calls reconnect after successful re-auth', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());

      const { result } = renderHook(() => useAuthentication());
      await act(async () => {
        await (result.current.signIn as any)();
      });
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('throws when navigator.credentials.get returns null', async () => {
      mockCredentialsGet.mockResolvedValueOnce(null);
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('Passkey authentication cancelled or failed');
    });

    it('throws when the reauth endpoint returns a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      mockCredentialsGet.mockResolvedValueOnce(makeMockCredential());
      const { result } = renderHook(() => useAuthentication());
      await expect(
        act(async () => { await (result.current.signIn as any)(); }),
      ).rejects.toThrow('WebAuthn re-authentication failed: 401');
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test src/client/hooks/useAuthentication.tests.ts
```

Expected: all tests passing (around 17 total). If any test fails due to jsdom not supporting a particular browser API, add a `vi.stubGlobal` for that API in `beforeAll`.

- [ ] **Step 3: Commit**

```bash
git add src/client/hooks/useAuthentication.tests.ts
git commit -m "test(client): add signIn branch tests, signOut, and cleanup to useAuthentication"
```

---

### Task 4: Add missing `createInvite` server tests

**Files:**
- Modify: `src/server/providers/authentication/useAuthentication.tests.ts`

Read the existing test file first. The current `createInvite` describe block (lines 52–91) has three tests:
1. `is a function on the returned object`
2. `throws when auth mode is not webauthn`
3. `creates a store record and returns invite URL containing requestId`

Two edge cases are missing:
- A `baseUrl` ending with `/` should produce a URL without a double-slash (`https://app.com?requestId=...` not `https://app.com/?requestId=...`)
- The `requestId` embedded in the URL should be a valid UUID v4

- [ ] **Step 1: Add the two missing tests inside the existing `createInvite` describe block**

After the existing third test (line 90, closing `}`), add:

```ts
    it('trims a trailing slash from baseUrl before appending the query param', async () => {
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
      const url = await auth.createInvite('user-1', 'https://app.com/');
      expect(url).toMatch(/^https:\/\/app\.com\?requestId=/);
      expect(url).not.toContain('/?');
    });

    it('embeds a valid UUID as the requestId', async () => {
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
      const url = await auth.createInvite('user-1', 'https://app.com');
      const requestId = new URL(url).searchParams.get('requestId');
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test src/server/providers/authentication/useAuthentication.tests.ts
```

Expected: all tests passing (7 total in this file).

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/providers/authentication/useAuthentication.tests.ts
git commit -m "test(auth): add createInvite edge-case tests for trailing-slash baseUrl and UUID format"
```
