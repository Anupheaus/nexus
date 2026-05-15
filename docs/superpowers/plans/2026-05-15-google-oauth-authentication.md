# Google OAuth Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `google-oauth` as a third auth mode to `@anupheaus/socket-api`, with auto-registered server routes, Google One Tap → popup → redirect client flow, Capacitor support, token lifecycle management, and incremental scope requests.

**Architecture:** New `GoogleOAuthAuthConfig` is added to the `AuthConfig` union. `registerAuthRoutes` auto-registers five Koa routes for the Google flow. The client `signIn()` hook orchestrates One Tap → popup → redirect (Capacitor auto-detected). All changes are additive — existing `jwt` and `webauthn` modes are untouched.

**Tech Stack:** TypeScript, Koa (existing), `axios` (existing dep), `crypto` (Node built-in), Vitest, Google Identity Services SDK (dynamically loaded), `@capacitor/browser` + `@capacitor/app` (optional peer deps)

---

## File Map

**New files:**
| Path | Purpose |
|---|---|
| `src/common/auth/googleOAuthTypes.ts` | `GoogleOAuthAuthRecord`, `GoogleOAuthAuthStore`, `GoogleProfile` |
| `src/server/auth/googleOAuthAuthConfig.ts` | `GoogleOAuthAuthConfig` interface |
| `src/server/auth/googleOAuthState.ts` | HMAC sign/verify for OAuth `state` param |
| `src/server/auth/googleOAuthState.tests.ts` | Unit tests for state signing |
| `src/server/auth/googleTokenRefresh.ts` | `refreshGoogleToken` — reads record, refreshes if expired |
| `src/server/auth/googleTokenRefresh.tests.ts` | Unit tests for token refresh |
| `src/server/actions/googleConfigAction.ts` | Returns `{ clientId }` to client |
| `src/server/actions/googleStartAction.ts` | Builds Google auth URL and redirects |
| `src/server/actions/googleStartAction.tests.ts` | Unit tests |
| `src/server/actions/googleCallbackAction.ts` | Exchanges code, upserts user, sets cookie |
| `src/server/actions/googleCallbackAction.tests.ts` | Unit tests |
| `src/server/actions/googleOneTapAction.ts` | Verifies One Tap ID token, sets cookie |
| `src/server/actions/googleOneTapAction.tests.ts` | Unit tests |
| `src/server/actions/googleScopesAction.ts` | Checks/returns already-granted scopes |
| `src/server/actions/googleScopesAction.tests.ts` | Unit tests |
| `src/client/auth/googleSignIn.ts` | One Tap → popup → redirect → Capacitor chain |
| `src/client/auth/googleSignIn.tests.ts` | Unit tests (jsdom) |
| `src/client/auth/googleRequestScopes.ts` | Client `requestScopes` logic |
| `src/client/auth/googleRequestScopes.tests.ts` | Unit tests |

**Modified files:**
| Path | Change |
|---|---|
| `src/common/auth/authTypes.ts` | Export `GoogleOAuthAuthRecord`, `GoogleOAuthAuthStore`, `GoogleProfile` |
| `src/common/auth/index.ts` | Re-export new types |
| `src/common/internalActions.ts` | Add 5 new action definitions + request/response types |
| `src/server/auth/authConfig.ts` | Add `GoogleOAuthAuthConfig` to `AuthConfig` union |
| `src/server/auth/index.ts` | Export `GoogleOAuthAuthConfig` |
| `src/server/auth/registerAuthRoutes.ts` | Accept `name` param; register Google routes when mode is `google-oauth` |
| `src/server/auth/defineAuthentication.ts` | Add `GoogleOAuthConfigureOptions`; add `getGoogleToken` to `ServerUseAuthResult` |
| `src/server/providers/authentication/useAuthentication.ts` | Implement `getGoogleToken()` |
| `src/server/startServer.ts` | Pass `name` to `registerAuthRoutes` |
| `src/client/auth/useAuthentication.ts` | Add `requestScopes` to result; wire Google sign-in path |
| `src/client/auth/defineAuthentication.ts` | Add `requestScopes` to `ClientUseAuthResult` type |

---

## Task 1: Common types and internal action definitions

**Files:**
- Create: `src/common/auth/googleOAuthTypes.ts`
- Modify: `src/common/auth/authTypes.ts`
- Modify: `src/common/auth/index.ts`
- Modify: `src/common/internalActions.ts`

- [ ] **Step 1: Create Google OAuth common types**

Create `src/common/auth/googleOAuthTypes.ts`:

```ts
import type { SocketAPIAuthRecord, SocketAPIAuthStore } from './authTypes';

export interface GoogleOAuthAuthRecord extends SocketAPIAuthRecord {
  googleId: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiresAt: number; // unix ms
  grantedScopes: string[];
}

export interface GoogleOAuthAuthStore extends SocketAPIAuthStore<GoogleOAuthAuthRecord> {
  findByGoogleId(googleId: string): Promise<GoogleOAuthAuthRecord | undefined>;
}

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}
```

- [ ] **Step 2: Export from `src/common/auth/authTypes.ts`**

Add after the last export in `authTypes.ts`:

```ts
export type { GoogleOAuthAuthRecord, GoogleOAuthAuthStore, GoogleProfile } from './googleOAuthTypes';
```

- [ ] **Step 3: Re-export from `src/common/auth/index.ts`**

Add to `src/common/auth/index.ts`:

```ts
  GoogleOAuthAuthRecord,
  GoogleOAuthAuthStore,
  GoogleProfile,
```

so the full file becomes:

```ts
export type {
  SocketAPIDeviceDetails,
  SocketAPIAuthRecord,
  SocketAPIAuthStore,
  JwtAuthRecord,
  JwtAuthStore,
  WebAuthnAuthRecord,
  WebAuthnAuthStore,
  GoogleOAuthAuthRecord,
  GoogleOAuthAuthStore,
  GoogleProfile,
} from './authTypes';
```

- [ ] **Step 4: Add internal action definitions to `src/common/internalActions.ts`**

Add these interfaces and action constants at the bottom of the existing file (after the `webauthnReauthAction`):

```ts
export interface GoogleStartRequest {
  postAuthUrl: string;
  platform?: string;
  popup?: boolean;
  scopes?: string;       // comma-separated extra scopes
  redirectMode?: boolean;
}

export interface GoogleCallbackRequest {
  code?: string;
  state: string;
  error?: string;
}

export interface GoogleOneTapRequest {
  credential: string;   // Google ID token from GIS SDK
}

export interface GoogleScopesRequest {
  scopes: string[];
}

export interface GoogleScopesResponse {
  alreadyGranted: boolean;
  missingScopes?: string[];
}

export const googleOAuthConfigAction = defineAction<void, { clientId: string }>()(
  'googleOAuthConfig',
  { isPublic: true, transport: ['rest'], rest: { method: 'GET', url: '/{name}/socketAPI/google/config' } },
);

export const googleStartAction = defineAction<GoogleStartRequest, void>()(
  'googleStart',
  { isPublic: true, transport: ['rest'], rest: { method: 'GET', url: '/{name}/socketAPI/google/start' } },
);

export const googleCallbackAction = defineAction<GoogleCallbackRequest, void>()(
  'googleCallback',
  { isPublic: true, transport: ['rest'], rest: { method: 'GET', url: '/{name}/socketAPI/google/callback' } },
);

export const googleOneTapAction = defineAction<GoogleOneTapRequest, void>()(
  'googleOneTap',
  { isPublic: true, transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/google/onetap' } },
);

export const googleScopesAction = defineAction<GoogleScopesRequest, GoogleScopesResponse>()(
  'googleScopes',
  { transport: ['rest'], rest: { method: 'POST', url: '/{name}/socketAPI/google/scopes' } },
);
```

- [ ] **Step 5: Build to check types compile**

```bash
pnpm build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/common/auth/googleOAuthTypes.ts src/common/auth/authTypes.ts src/common/auth/index.ts src/common/internalActions.ts
git commit -m "feat(google-oauth): add common types and internal action definitions"
```

---

## Task 2: Server config types

**Files:**
- Create: `src/server/auth/googleOAuthAuthConfig.ts`
- Modify: `src/server/auth/authConfig.ts`
- Modify: `src/server/auth/index.ts`

- [ ] **Step 1: Create `src/server/auth/googleOAuthAuthConfig.ts`**

```ts
import type { SocketAPIUser } from '../../common';
import type { GoogleOAuthAuthStore, GoogleProfile } from '../../common/auth';

export interface GoogleOAuthAuthConfig {
  mode: 'google-oauth';
  clientId: string;
  clientSecret: string;
  /** Registered in Google Cloud Console. e.g. `https://myapp.com/api/socketAPI/google/callback` */
  redirectUri: string;
  baseScopes: string[];
  store: GoogleOAuthAuthStore;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  onCreateUser(profile: GoogleProfile): Promise<SocketAPIUser>;
  /** Registered as a redirect URI in Google Cloud Console. Required for Capacitor support. */
  capacitorCallbackUrl?: string;
  syncUserToClient: boolean;
}
```

- [ ] **Step 2: Update `src/server/auth/authConfig.ts`**

Add the import and extend the union:

```ts
import type { SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';

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
  onGetInviteDetails(userId: string, accountId?: string): Promise<InviteDetails>;
  onGetUser(userId: string): Promise<SocketAPIUser | undefined>;
  syncUserToClient: boolean;
}

export type AuthConfig = JwtAuthConfig | WebAuthnAuthConfig | GoogleOAuthAuthConfig;

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

- [ ] **Step 3: Export from `src/server/auth/index.ts`**

Add to the exports:

```ts
export type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
export type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';
export { setAuthConfig, getAuthConfig, clearAuthConfig } from './authConfig';
export { validateSessionCookie } from './validateSessionCookie';
export { registerAuthRoutes } from './registerAuthRoutes';
export { validateRestSession } from './validateRestSession';
```

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/googleOAuthAuthConfig.ts src/server/auth/authConfig.ts src/server/auth/index.ts
git commit -m "feat(google-oauth): add server config types"
```

---

## Task 3: State signing utility

**Files:**
- Create: `src/server/auth/googleOAuthState.ts`
- Create: `src/server/auth/googleOAuthState.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/googleOAuthState.tests.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeState, decodeState } from './googleOAuthState';
import type { GoogleOAuthStatePayload } from './googleOAuthState';

const SECRET = 'test-client-secret-abc123';

const payload: GoogleOAuthStatePayload = {
  nonce: 'abc123',
  postAuthUrl: 'https://myapp.com/dashboard',
  platform: 'web',
  popup: true,
};

describe('encodeState / decodeState', () => {
  it('round-trips a payload', () => {
    const encoded = encodeState(payload, SECRET);
    const decoded = decodeState(encoded, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('includes optional scopes when provided', () => {
    const withScopes = { ...payload, scopes: ['https://www.googleapis.com/auth/calendar'] };
    const decoded = decodeState(encodeState(withScopes, SECRET), SECRET);
    expect(decoded.scopes).toEqual(['https://www.googleapis.com/auth/calendar']);
  });

  it('throws on tampered payload', () => {
    const encoded = encodeState(payload, SECRET);
    const [data] = encoded.split('.');
    const tampered = `${data}.invalidsignature1234567890123456789012`;
    expect(() => decodeState(tampered, SECRET)).toThrow('State signature mismatch');
  });

  it('throws when state has no dot separator', () => {
    expect(() => decodeState('nodot', SECRET)).toThrow('Invalid state format');
  });

  it('throws when signed with a different secret', () => {
    const encoded = encodeState(payload, SECRET);
    expect(() => decodeState(encoded, 'wrong-secret')).toThrow('State signature mismatch');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleOAuthState
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/auth/googleOAuthState.ts`**

```ts
import crypto from 'crypto';

export interface GoogleOAuthStatePayload {
  nonce: string;
  postAuthUrl: string;
  platform: 'web' | 'capacitor';
  popup: boolean;
  scopes?: string[];
}

function sign(encoded: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}

export function encodeState(payload: GoogleOAuthStatePayload, clientSecret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(encoded, clientSecret);
  return `${encoded}.${sig}`;
}

export function decodeState(state: string, clientSecret: string): GoogleOAuthStatePayload {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');

  const encoded = state.slice(0, dotIdx);
  const receivedSig = state.slice(dotIdx + 1);
  const expectedSig = sign(encoded, clientSecret);

  // Pad to equal length before timing-safe compare (base64url HMAC-SHA256 is always 43 chars)
  const a = Buffer.from(receivedSig.padEnd(43, '='));
  const b = Buffer.from(expectedSig.padEnd(43, '='));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('State signature mismatch');
  }

  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as GoogleOAuthStatePayload;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test googleOAuthState
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/googleOAuthState.ts src/server/auth/googleOAuthState.tests.ts
git commit -m "feat(google-oauth): state HMAC sign/verify utility"
```

---

## Task 4: Google token refresh utility

**Files:**
- Create: `src/server/auth/googleTokenRefresh.ts`
- Create: `src/server/auth/googleTokenRefresh.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/auth/googleTokenRefresh.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import { refreshGoogleToken } from './googleTokenRefresh';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

function makeStore(record?: Partial<GoogleOAuthAuthRecord>): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => record as GoogleOAuthAuthRecord | undefined),
    findByDevice: vi.fn(async () => undefined),
    findByGoogleId: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

const freshRecord: GoogleOAuthAuthRecord = {
  requestId: 'r1',
  sessionToken: 'tok',
  userId: 'google-123',
  googleId: 'google-123',
  deviceId: 'd1',
  isEnabled: true,
  googleAccessToken: 'fresh-access',
  googleRefreshToken: 'refresh-tok',
  googleTokenExpiresAt: Date.now() + 3_600_000, // 1 hour from now
  grantedScopes: ['openid', 'email'],
};

const expiredRecord: GoogleOAuthAuthRecord = {
  ...freshRecord,
  googleAccessToken: 'expired-access',
  googleTokenExpiresAt: Date.now() - 1000, // already expired
};

describe('refreshGoogleToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns existing access token when not expired', async () => {
    const store = makeStore(freshRecord);
    const token = await refreshGoogleToken(store, CLIENT_ID, CLIENT_SECRET, 'tok');
    expect(token).toBe('fresh-access');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('calls Google token endpoint and updates store when token is expired', async () => {
    const store = makeStore(expiredRecord);
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'new-access', expires_in: 3600 } });

    const token = await refreshGoogleToken(store, CLIENT_ID, CLIENT_SECRET, 'tok');

    expect(token).toBe('new-access');
    expect(mockedPost).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.any(String),
      expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    );
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      googleAccessToken: 'new-access',
      googleTokenExpiresAt: expect.any(Number),
    }));
  });

  it('throws when no session record found', async () => {
    const store = makeStore(undefined);
    await expect(refreshGoogleToken(store, CLIENT_ID, CLIENT_SECRET, 'tok')).rejects.toThrow('No Google OAuth session found');
  });

  it('propagates axios error when Google token endpoint fails', async () => {
    const store = makeStore(expiredRecord);
    mockedPost.mockRejectedValueOnce(new Error('network error'));
    await expect(refreshGoogleToken(store, CLIENT_ID, CLIENT_SECRET, 'tok')).rejects.toThrow('network error');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleTokenRefresh
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/auth/googleTokenRefresh.ts`**

```ts
import axios from 'axios';
import type { GoogleOAuthAuthStore } from '../../common/auth';

export async function refreshGoogleToken(
  store: GoogleOAuthAuthStore,
  clientId: string,
  clientSecret: string,
  sessionToken: string,
): Promise<string> {
  const record = await store.findBySessionToken(sessionToken);
  if (!record) throw new Error('No Google OAuth session found');

  if (record.googleTokenExpiresAt > Date.now() + 30_000) {
    return record.googleAccessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: record.googleRefreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await axios.post<{ access_token: string; expires_in: number }>(
    'https://oauth2.googleapis.com/token',
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  const newAccessToken = resp.data.access_token;
  const newExpiresAt = Date.now() + resp.data.expires_in * 1000;

  await store.update(record.requestId, {
    googleAccessToken: newAccessToken,
    googleTokenExpiresAt: newExpiresAt,
  });

  return newAccessToken;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test googleTokenRefresh
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/googleTokenRefresh.ts src/server/auth/googleTokenRefresh.tests.ts
git commit -m "feat(google-oauth): token refresh utility"
```

---

## Task 5: Google config and start actions

**Files:**
- Create: `src/server/actions/googleConfigAction.ts`
- Create: `src/server/actions/googleStartAction.ts`
- Create: `src/server/actions/googleStartAction.tests.ts`

- [ ] **Step 1: Create `src/server/actions/googleConfigAction.ts`**

No logic to test here — just wires the config into a handler:

```ts
import { googleOAuthConfigAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';

export function createGoogleConfigAction(clientId: string): SocketAPIServerAction {
  return createServerActionHandler(
    googleOAuthConfigAction,
    async () => ({ clientId }),
    { isPublic: true },
  );
}
```

- [ ] **Step 2: Write failing tests for the start action handler**

Create `src/server/actions/googleStartAction.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleGoogleStart } from './googleStartAction';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { GoogleStartRequest } from '../../common/internalActions';
import { decodeState } from '../auth/googleOAuthState';

const config: GoogleOAuthAuthConfig = {
  mode: 'google-oauth',
  clientId: 'test-client-id',
  clientSecret: 'test-secret',
  redirectUri: 'https://myapp.com/api/socketAPI/google/callback',
  baseScopes: ['openid', 'email', 'profile'],
  store: {} as never,
  onGetUser: vi.fn(),
  onCreateUser: vi.fn(),
  syncUserToClient: true,
};

function makeRedirect() {
  const calls: string[] = [];
  return {
    redirect: (url: string) => { calls.push(url); return { type: Symbol('redirect'), url } as never; },
    calls,
  };
}

describe('handleGoogleStart', () => {
  it('redirects to Google authorization endpoint', async () => {
    const { redirect, calls } = makeRedirect();
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'web', popup: false };
    await handleGoogleStart(config, req, redirect);
    expect(calls[0]).toContain('accounts.google.com/o/oauth2/v2/auth');
  });

  it('includes base scopes in redirect URL', async () => {
    const { redirect, calls } = makeRedirect();
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'web', popup: false };
    await handleGoogleStart(config, req, redirect);
    expect(calls[0]).toContain('openid');
    expect(calls[0]).toContain('email');
    expect(calls[0]).toContain('profile');
  });

  it('appends extra scopes and include_granted_scopes when scopes param provided', async () => {
    const { redirect, calls } = makeRedirect();
    const req: GoogleStartRequest = {
      postAuthUrl: '/dashboard',
      platform: 'web',
      popup: false,
      scopes: 'https://www.googleapis.com/auth/calendar',
    };
    await handleGoogleStart(config, req, redirect);
    expect(calls[0]).toContain('calendar');
    expect(calls[0]).toContain('include_granted_scopes=true');
  });

  it('includes signed state param', async () => {
    const { redirect, calls } = makeRedirect();
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'web', popup: true };
    await handleGoogleStart(config, req, redirect);
    const url = new URL(calls[0]);
    const state = url.searchParams.get('state') ?? '';
    const decoded = decodeState(state, config.clientSecret);
    expect(decoded.postAuthUrl).toBe('/dashboard');
    expect(decoded.popup).toBe(true);
    expect(decoded.platform).toBe('web');
    expect(decoded.nonce).toBeTruthy();
  });

  it('sets platform to capacitor in state when platform param is capacitor', async () => {
    const { redirect, calls } = makeRedirect();
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'capacitor', popup: false };
    await handleGoogleStart(config, req, redirect);
    const url = new URL(calls[0]);
    const decoded = decodeState(url.searchParams.get('state') ?? '', config.clientSecret);
    expect(decoded.platform).toBe('capacitor');
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm test googleStartAction
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/server/actions/googleStartAction.ts`**

```ts
import crypto from 'crypto';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import { googleStartAction } from '../../common/internalActions';
import type { GoogleStartRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import { encodeState } from '../auth/googleOAuthState';
import type { RedirectResult } from '../handler/handlerUtils';

export async function handleGoogleStart(
  config: GoogleOAuthAuthConfig,
  req: GoogleStartRequest,
  redirect: (url: string) => RedirectResult,
): Promise<RedirectResult> {
  const { postAuthUrl = '/', platform = 'web', popup = false, scopes: extraScopes, redirectMode = false } = req;

  const extraScopeList = extraScopes
    ? extraScopes.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const allScopes = [...config.baseScopes, ...extraScopeList];

  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = encodeState(
    {
      nonce,
      postAuthUrl,
      platform: platform === 'capacitor' ? 'capacitor' : 'web',
      popup: popup === true,
      scopes: extraScopeList.length > 0 ? extraScopeList : undefined,
    },
    config.clientSecret,
  );

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: allScopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  if (extraScopeList.length > 0) params.set('include_granted_scopes', 'true');

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export function createGoogleStartAction(config: GoogleOAuthAuthConfig): SocketAPIServerAction {
  return createServerActionHandler(
    googleStartAction,
    async (req: GoogleStartRequest, utils) => handleGoogleStart(config, req, utils.redirect),
    { isPublic: true },
  );
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm test googleStartAction
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/actions/googleConfigAction.ts src/server/actions/googleStartAction.ts src/server/actions/googleStartAction.tests.ts
git commit -m "feat(google-oauth): config and start route handlers"
```

---

## Task 6: Google callback action

**Files:**
- Create: `src/server/actions/googleCallbackAction.ts`
- Create: `src/server/actions/googleCallbackAction.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/actions/googleCallbackAction.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { SocketAPIUser } from '../../common';
import { handleGoogleCallback } from './googleCallbackAction';
import { encodeState } from '../auth/googleOAuthState';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);
const mockedGet = vi.mocked(axios.get);

const SECRET = 'test-secret';
const REDIRECT_URI = 'https://myapp.com/api/socketAPI/google/callback';
const CAPACITOR_URL = 'com.myapp://google-oauth-callback';

function makeStore(record?: Partial<GoogleOAuthAuthRecord>): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByGoogleId: vi.fn(async () => record as GoogleOAuthAuthRecord | undefined),
    update: vi.fn(),
  };
}

const mockUser: SocketAPIUser = { id: 'google-uid-123', name: 'Alice' };

const baseConfig: GoogleOAuthAuthConfig = {
  mode: 'google-oauth',
  clientId: 'client-id',
  clientSecret: SECRET,
  redirectUri: REDIRECT_URI,
  baseScopes: ['openid', 'email'],
  store: {} as never,
  onGetUser: vi.fn(async () => mockUser),
  onCreateUser: vi.fn(async () => mockUser),
  capacitorCallbackUrl: CAPACITOR_URL,
  syncUserToClient: true,
};

function makeState(overrides: Partial<{ popup: boolean; platform: string; postAuthUrl: string }> = {}) {
  return encodeState(
    {
      nonce: 'nonce-abc',
      postAuthUrl: overrides.postAuthUrl ?? '/dashboard',
      platform: (overrides.platform ?? 'web') as 'web' | 'capacitor',
      popup: overrides.popup ?? false,
    },
    SECRET,
  );
}

function makeUtils() {
  const cookies: Record<string, string> = {};
  const redirects: string[] = [];
  const headers: Record<string, string> = {};
  return {
    setCookie: vi.fn((name: string, value: string) => { cookies[name] = value; }),
    redirect: vi.fn((url: string) => { redirects.push(url); return { type: Symbol(), url } as never; }),
    setHeaders: vi.fn((h: Record<string, string>) => Object.assign(headers, h)),
    cookies,
    redirects,
    headers,
  };
}

describe('handleGoogleCallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when error param is present in request', async () => {
    const utils = makeUtils();
    await expect(
      handleGoogleCallback(baseConfig, { code: undefined, state: makeState(), error: 'access_denied' }, utils),
    ).rejects.toThrow('Google OAuth error: access_denied');
  });

  it('throws when state signature is invalid', async () => {
    const utils = makeUtils();
    await expect(
      handleGoogleCallback(baseConfig, { code: 'code123', state: 'invalid.state' }, utils),
    ).rejects.toThrow();
  });

  it('sets session cookie after successful code exchange (existing user)', async () => {
    const existingRecord: GoogleOAuthAuthRecord = {
      requestId: 'r1', sessionToken: 'old', userId: 'google-uid-123', googleId: 'google-uid-123',
      deviceId: 'd1', isEnabled: true, googleAccessToken: 'old-at', googleRefreshToken: 'rt',
      googleTokenExpiresAt: Date.now() + 3600_000, grantedScopes: ['openid'],
    };
    const store = makeStore(existingRecord);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({
      data: { access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600, scope: 'openid email' },
    });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'google-uid-123', email: 'alice@example.com', name: 'Alice' } });

    const utils = makeUtils();
    await handleGoogleCallback(config, { code: 'code123', state: makeState() }, utils);

    expect(utils.setCookie).toHaveBeenCalledWith('socketapi_session', expect.any(String), expect.objectContaining({ httpOnly: true }));
  });

  it('calls onCreateUser when no existing record found', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email' },
    });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'new-uid', email: 'bob@example.com', name: 'Bob' } });

    const utils = makeUtils();
    await handleGoogleCallback(config, { code: 'code123', state: makeState() }, utils);

    expect(config.onCreateUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-uid', email: 'bob@example.com' }));
  });

  it('redirects to postAuthUrl in web redirect mode', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'uid', email: 'x@x.com', name: 'X' } });

    const utils = makeUtils();
    await handleGoogleCallback(config, { code: 'code123', state: makeState({ popup: false, postAuthUrl: '/home' }) }, utils);

    expect(utils.redirects[0]).toBe('/home');
  });

  it('returns popup HTML when popup flag is set in state', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'uid', email: 'x@x.com', name: 'X' } });

    const utils = makeUtils();
    const result = await handleGoogleCallback(config, { code: 'code123', state: makeState({ popup: true }) }, utils);

    expect(utils.setHeaders).toHaveBeenCalledWith({ 'Content-Type': 'text/html' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('google-oauth-complete');
  });

  it('redirects to capacitorCallbackUrl when platform is capacitor', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'uid', email: 'x@x.com', name: 'X' } });

    const utils = makeUtils();
    await handleGoogleCallback(config, { code: 'code123', state: makeState({ platform: 'capacitor' }) }, utils);

    expect(utils.redirects[0]).toBe(CAPACITOR_URL);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleCallbackAction
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/actions/googleCallbackAction.ts`**

```ts
import crypto from 'crypto';
import axios from 'axios';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleProfile } from '../../common/auth';
import { googleCallbackAction } from '../../common/internalActions';
import type { GoogleCallbackRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import { decodeState } from '../auth/googleOAuthState';
import type { RedirectResult } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'Strict' as const, path: '/' };

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface UserInfoResponse {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

async function exchangeCode(clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await axios.post<TokenResponse>(
    'https://oauth2.googleapis.com/token',
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return resp.data;
}

async function fetchGoogleProfile(accessToken: string): Promise<UserInfoResponse> {
  const resp = await axios.get<UserInfoResponse>(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return resp.data;
}

export async function handleGoogleCallback(
  config: GoogleOAuthAuthConfig,
  req: GoogleCallbackRequest,
  utils: {
    setCookie(name: string, value: string, options?: Record<string, unknown>): void;
    redirect(url: string): RedirectResult;
    setHeaders(headers: Record<string, string>): void;
  },
): Promise<RedirectResult | string> {
  if (req.error) throw new Error(`Google OAuth error: ${req.error}`);

  const statePayload = decodeState(req.state, config.clientSecret);
  const tokens = await exchangeCode(config.clientId, config.clientSecret, config.redirectUri, req.code!);
  const profile = await fetchGoogleProfile(tokens.access_token);

  const googleProfile: GoogleProfile = {
    id: profile.sub,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  };

  const grantedScopes = tokens.scope.split(' ').filter(Boolean);
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  const existingRecord = await config.store.findByGoogleId(profile.sub);
  let sessionToken: string;

  if (existingRecord) {
    sessionToken = crypto.randomBytes(32).toString('base64url');
    await config.store.update(existingRecord.requestId, {
      sessionToken,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleTokenExpiresAt: expiresAt,
      grantedScopes,
      isEnabled: true,
      lastConnectedAt: Date.now(),
    });
  } else {
    const user = await config.onCreateUser(googleProfile);
    sessionToken = crypto.randomBytes(32).toString('base64url');
    const newRecord: GoogleOAuthAuthRecord = {
      requestId: crypto.randomUUID(),
      sessionToken,
      userId: profile.sub,
      googleId: profile.sub,
      deviceId: crypto.randomUUID(),
      isEnabled: true,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleTokenExpiresAt: expiresAt,
      grantedScopes,
      lastConnectedAt: Date.now(),
    };
    void user; // user returned for consumer's side-effects; record uses googleId as userId
    await config.store.create(newRecord);
  }

  utils.setCookie(COOKIE_NAME, sessionToken, COOKIE_OPTIONS);

  if (statePayload.popup) {
    utils.setHeaders({ 'Content-Type': 'text/html' });
    return `<!DOCTYPE html><html><body><script>
      window.opener && window.opener.postMessage({ type: 'google-oauth-complete' }, window.location.origin);
      window.close();
    </script></body></html>`;
  }

  if (statePayload.platform === 'capacitor') {
    const callbackUrl = config.capacitorCallbackUrl;
    if (!callbackUrl) throw new Error('capacitorCallbackUrl is required in config for Capacitor OAuth');
    return utils.redirect(callbackUrl);
  }

  return utils.redirect(statePayload.postAuthUrl);
}

export function createGoogleCallbackAction(config: GoogleOAuthAuthConfig): SocketAPIServerAction {
  return createServerActionHandler(
    googleCallbackAction,
    async (req: GoogleCallbackRequest, utils) =>
      handleGoogleCallback(config, req, {
        setCookie: utils.setCookie,
        redirect: utils.redirect,
        setHeaders: utils.setHeaders,
      }),
    { isPublic: true },
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test googleCallbackAction
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/googleCallbackAction.ts src/server/actions/googleCallbackAction.tests.ts
git commit -m "feat(google-oauth): callback route — code exchange, user upsert, cookie"
```

---

## Task 7: Google One Tap action

**Files:**
- Create: `src/server/actions/googleOneTapAction.ts`
- Create: `src/server/actions/googleOneTapAction.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/actions/googleOneTapAction.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { SocketAPIUser } from '../../common';
import { handleGoogleOneTap } from './googleOneTapAction';

vi.mock('axios');
const mockedGet = vi.mocked(axios.get);

const mockUser: SocketAPIUser = { id: 'google-uid-abc', name: 'Alice' };

function makeStore(record?: Partial<GoogleOAuthAuthRecord>): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByGoogleId: vi.fn(async () => record as GoogleOAuthAuthRecord | undefined),
    update: vi.fn(),
  };
}

const baseConfig: GoogleOAuthAuthConfig = {
  mode: 'google-oauth',
  clientId: 'client-id',
  clientSecret: 'secret',
  redirectUri: 'https://myapp.com/callback',
  baseScopes: ['openid'],
  store: {} as never,
  onGetUser: vi.fn(async () => mockUser),
  onCreateUser: vi.fn(async () => mockUser),
  syncUserToClient: true,
};

const validTokenInfo = {
  sub: 'google-uid-abc',
  email: 'alice@example.com',
  name: 'Alice',
  aud: 'client-id',
};

describe('handleGoogleOneTap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when tokeninfo aud does not match clientId', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ...validTokenInfo, aud: 'wrong-client' } });
    const setCookie = vi.fn();
    await expect(handleGoogleOneTap(baseConfig, { credential: 'id-tok' }, setCookie)).rejects.toThrow('Invalid One Tap token audience');
  });

  it('sets session cookie on success with existing user', async () => {
    const existingRecord: GoogleOAuthAuthRecord = {
      requestId: 'r1', sessionToken: 'old', userId: 'google-uid-abc', googleId: 'google-uid-abc',
      deviceId: 'd1', isEnabled: true, googleAccessToken: 'at', googleRefreshToken: 'rt',
      googleTokenExpiresAt: Date.now() + 3600_000, grantedScopes: ['openid'],
    };
    const store = makeStore(existingRecord);
    const config = { ...baseConfig, store };
    mockedGet.mockResolvedValueOnce({ data: validTokenInfo });
    const setCookie = vi.fn();
    await handleGoogleOneTap(config, { credential: 'id-tok' }, setCookie);
    expect(setCookie).toHaveBeenCalledWith('socketapi_session', expect.any(String), expect.objectContaining({ httpOnly: true }));
  });

  it('calls onCreateUser and creates a new record when no existing record', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedGet.mockResolvedValueOnce({ data: validTokenInfo });
    const setCookie = vi.fn();
    await handleGoogleOneTap(config, { credential: 'id-tok' }, setCookie);
    expect(config.onCreateUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'google-uid-abc' }));
    expect(store.create).toHaveBeenCalled();
    expect(setCookie).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleOneTapAction
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/actions/googleOneTapAction.ts`**

```ts
import crypto from 'crypto';
import axios from 'axios';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { GoogleOAuthAuthRecord, GoogleProfile } from '../../common/auth';
import { googleOneTapAction } from '../../common/internalActions';
import type { GoogleOneTapRequest } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import type { CookieOptions } from '../handler/handlerUtils';

const COOKIE_NAME = 'socketapi_session';
const COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' };

interface TokenInfoResponse {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  aud: string;
}

async function verifyOneTapCredential(credential: string, clientId: string): Promise<GoogleProfile> {
  const resp = await axios.get<TokenInfoResponse>(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
  );
  if (resp.data.aud !== clientId) throw new Error('Invalid One Tap token audience');
  return { id: resp.data.sub, email: resp.data.email, name: resp.data.name, picture: resp.data.picture };
}

export async function handleGoogleOneTap(
  config: GoogleOAuthAuthConfig,
  req: GoogleOneTapRequest,
  setCookie: (name: string, value: string, options?: CookieOptions) => void,
): Promise<void> {
  const profile = await verifyOneTapCredential(req.credential, config.clientId);
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const existingRecord = await config.store.findByGoogleId(profile.id);

  if (existingRecord) {
    await config.store.update(existingRecord.requestId, {
      sessionToken,
      isEnabled: true,
      lastConnectedAt: Date.now(),
    });
  } else {
    await config.onCreateUser(profile);
    const newRecord: GoogleOAuthAuthRecord = {
      requestId: crypto.randomUUID(),
      sessionToken,
      userId: profile.id,
      googleId: profile.id,
      deviceId: crypto.randomUUID(),
      isEnabled: true,
      googleAccessToken: '',
      googleRefreshToken: '',
      googleTokenExpiresAt: 0,
      grantedScopes: [],
      lastConnectedAt: Date.now(),
    };
    await config.store.create(newRecord);
  }

  setCookie(COOKIE_NAME, sessionToken, COOKIE_OPTIONS);
}

export function createGoogleOneTapAction(config: GoogleOAuthAuthConfig): SocketAPIServerAction {
  return createServerActionHandler(
    googleOneTapAction,
    async (req: GoogleOneTapRequest, { setCookie }) => handleGoogleOneTap(config, req, setCookie),
    { isPublic: true },
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test googleOneTapAction
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/googleOneTapAction.ts src/server/actions/googleOneTapAction.tests.ts
git commit -m "feat(google-oauth): One Tap action — ID token verification and session creation"
```

---

## Task 8: Google scopes action

**Files:**
- Create: `src/server/actions/googleScopesAction.ts`
- Create: `src/server/actions/googleScopesAction.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/actions/googleScopesAction.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import { handleGoogleScopes } from './googleScopesAction';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);

function makeStore(record?: Partial<GoogleOAuthAuthRecord>): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => record as GoogleOAuthAuthRecord | undefined),
    findByDevice: vi.fn(async () => undefined),
    findByGoogleId: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

const baseRecord: GoogleOAuthAuthRecord = {
  requestId: 'r1',
  sessionToken: 'tok',
  userId: 'g-uid',
  googleId: 'g-uid',
  deviceId: 'd1',
  isEnabled: true,
  googleAccessToken: 'at',
  googleRefreshToken: 'rt',
  googleTokenExpiresAt: Date.now() + 3_600_000,
  grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
};

describe('handleGoogleScopes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns alreadyGranted true when all requested scopes are present and token is fresh', async () => {
    const store = makeStore(baseRecord);
    const result = await handleGoogleScopes(store, 'c-id', 'c-sec', 'tok', ['openid', 'email']);
    expect(result.alreadyGranted).toBe(true);
    expect(result.missingScopes).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('refreshes token when all scopes granted but token is expired', async () => {
    const expiredRecord = { ...baseRecord, googleTokenExpiresAt: Date.now() - 1000 };
    const store = makeStore(expiredRecord);
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'new-at', expires_in: 3600 } });
    const result = await handleGoogleScopes(store, 'c-id', 'c-sec', 'tok', ['openid']);
    expect(result.alreadyGranted).toBe(true);
    expect(mockedPost).toHaveBeenCalled();
  });

  it('returns alreadyGranted false with missingScopes when a scope is not granted', async () => {
    const store = makeStore(baseRecord);
    const result = await handleGoogleScopes(store, 'c-id', 'c-sec', 'tok', ['openid', 'https://www.googleapis.com/auth/drive']);
    expect(result.alreadyGranted).toBe(false);
    expect(result.missingScopes).toEqual(['https://www.googleapis.com/auth/drive']);
  });

  it('throws when session token not found in store', async () => {
    const store = makeStore(undefined);
    await expect(handleGoogleScopes(store, 'c-id', 'c-sec', 'tok', ['openid'])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleScopesAction
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/actions/googleScopesAction.ts`**

```ts
import type { GoogleOAuthAuthStore } from '../../common/auth';
import type { GoogleScopesRequest, GoogleScopesResponse } from '../../common/internalActions';
import { googleScopesAction } from '../../common/internalActions';
import { createServerActionHandler } from './createServerActionHandler';
import type { SocketAPIServerAction } from './createServerActionHandler';
import { refreshGoogleToken } from '../auth/googleTokenRefresh';
import { useAuthData } from '../async-context/socketApiContext';

export async function handleGoogleScopes(
  store: GoogleOAuthAuthStore,
  clientId: string,
  clientSecret: string,
  sessionToken: string,
  requestedScopes: string[],
): Promise<GoogleScopesResponse> {
  const record = await store.findBySessionToken(sessionToken);
  if (!record) throw new Error('No Google OAuth session found');

  const missingScopes = requestedScopes.filter(s => !record.grantedScopes.includes(s));

  if (missingScopes.length > 0) {
    return { alreadyGranted: false, missingScopes };
  }

  // All scopes already granted — refresh token if expired (no-op if still fresh)
  await refreshGoogleToken(store, clientId, clientSecret, sessionToken);
  return { alreadyGranted: true };
}

export function createGoogleScopesAction(
  store: GoogleOAuthAuthStore,
  clientId: string,
  clientSecret: string,
): SocketAPIServerAction {
  return createServerActionHandler(
    googleScopesAction,
    async (req: GoogleScopesRequest) => {
      const sessionToken = useAuthData()?.token ?? '';
      return handleGoogleScopes(store, clientId, clientSecret, sessionToken, req.scopes);
    },
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test googleScopesAction
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/googleScopesAction.ts src/server/actions/googleScopesAction.tests.ts
git commit -m "feat(google-oauth): scopes check action"
```

---

## Task 9: Register routes and update server auth exports

**Files:**
- Modify: `src/server/auth/registerAuthRoutes.ts`
- Modify: `src/server/auth/defineAuthentication.ts`
- Modify: `src/server/providers/authentication/useAuthentication.ts`
- Modify: `src/server/startServer.ts`

- [ ] **Step 1: Update `registerAuthRoutes` to accept `name` and register Google routes**

Replace the entire content of `src/server/auth/registerAuthRoutes.ts`:

```ts
import type { SocketAPIServerAction } from '../actions/createServerActionHandler';
import type { AuthConfig } from './authConfig';
import { createSigninAction } from '../actions/signinAction';
import { createSignoutAction } from '../actions/signoutAction';
import { createWebauthnInviteAction } from '../actions/webauthnInviteAction';
import { createWebauthnRegisterAction } from '../actions/webauthnRegisterAction';
import { createWebauthnReauthAction } from '../actions/webauthnReauthAction';
import { createGoogleConfigAction } from '../actions/googleConfigAction';
import { createGoogleStartAction } from '../actions/googleStartAction';
import { createGoogleCallbackAction } from '../actions/googleCallbackAction';
import { createGoogleOneTapAction } from '../actions/googleOneTapAction';
import { createGoogleScopesAction } from '../actions/googleScopesAction';

export function registerAuthRoutes(config: AuthConfig): SocketAPIServerAction[] {
  const actions: SocketAPIServerAction[] = [];

  if (config.mode === 'jwt') {
    actions.push(createSigninAction(config.store, config.onAuthenticate));
  }

  if (config.mode === 'webauthn') {
    actions.push(createWebauthnInviteAction(config.store, config.onGetInviteDetails));
    actions.push(createWebauthnRegisterAction(config.store));
    actions.push(createWebauthnReauthAction(config.store));
  }

  if (config.mode === 'google-oauth') {
    actions.push(createGoogleConfigAction(config.clientId));
    actions.push(createGoogleStartAction(config));
    actions.push(createGoogleCallbackAction(config));
    actions.push(createGoogleOneTapAction(config));
    actions.push(createGoogleScopesAction(config.store, config.clientId, config.clientSecret));
  }

  actions.push(createSignoutAction(config.store));
  return actions;
}
```

- [ ] **Step 2: Add `getGoogleToken` to server `useAuthentication`**

In `src/server/providers/authentication/useAuthentication.ts`, add the import and function. Add after the `createInvite` function and before the return statement:

```ts
import { refreshGoogleToken } from '../../auth/googleTokenRefresh';
```

Add this function inside `useAuthentication`:

```ts
  async function getGoogleToken(): Promise<string> {
    const authConfig = getAuthConfig();
    if (!authConfig || authConfig.mode !== 'google-oauth') {
      throw new Error('getGoogleToken is only available in google-oauth mode');
    }
    const sessionToken = useAuthData()?.token;
    if (!sessionToken) throw new Error('No active session');
    return refreshGoogleToken(authConfig.store, authConfig.clientId, authConfig.clientSecret, sessionToken);
  }
```

Add `getGoogleToken` to the return object:

```ts
  return {
    get user() { return getUser(); },
    get account() { return getAccount(); },
    setUser,
    setAccount,
    signOut,
    impersonateUser,
    createInvite,
    getGoogleToken,
  };
```

- [ ] **Step 3: Update `defineAuthentication.ts` (server) to expose `getGoogleToken` and `GoogleOAuthConfigureOptions`**

Replace the content of `src/server/auth/defineAuthentication.ts`:

```ts
import type { SocketAPIAccount, SocketAPIUser } from '../../common';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';
import type { GoogleOAuthAuthStore, GoogleProfile } from '../../common/auth';
import type { InviteDetails } from '../../common/internalActions';
import type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';
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
  onGetInviteDetails(userId: string, accountId?: string): Promise<InviteDetails>;
  onGetUser(userId: string): Promise<U | undefined>;
  syncUserToClient?: boolean;
}

export interface GoogleOAuthConfigureOptions<U extends SocketAPIUser> {
  mode: 'google-oauth';
  clientId: string;
  clientSecret: string;
  /** Full callback URL registered in Google Cloud Console. e.g. `https://myapp.com/api/socketAPI/google/callback` */
  redirectUri: string;
  baseScopes: string[];
  store: GoogleOAuthAuthStore;
  /** Called on every socket connect (userId = Google ID) and during scope checks. */
  onGetUser(userId: string): Promise<U | undefined>;
  /** Called on first sign-in when no record exists for the Google ID. */
  onCreateUser(profile: GoogleProfile): Promise<U>;
  /** Required for Capacitor support. Must be registered in Google Cloud Console. */
  capacitorCallbackUrl?: string;
  syncUserToClient?: boolean;
}

export interface CreateInviteOptions {
  userId: string;
  baseUrl: string;
  accountId?: string;
}

export interface ServerUseAuthResult<U extends SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount> {
  readonly user: U | undefined;
  readonly account: A | undefined;
  setUser(user: U | undefined): Promise<void>;
  setAccount(account: A | undefined): Promise<void>;
  signOut(): Promise<void>;
  impersonateUser<T>(user: U, handler: () => T): MakePromise<T>;
  createInvite(options: CreateInviteOptions): Promise<string>;
  /** Google OAuth mode only. Returns a fresh access token, auto-refreshing if expired. */
  getGoogleToken(): Promise<string>;
}

export function defineAuthentication<U extends SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount, C = void>() {
  function configureAuthentication(
    options: JwtConfigureOptions<U, C> | WebAuthnConfigureOptions<U> | GoogleOAuthConfigureOptions<U>,
  ): AuthConfig {
    if (options.mode === 'webauthn') {
      const config: WebAuthnAuthConfig = {
        mode: 'webauthn',
        store: options.store,
        onGetInviteDetails: (userId, accountId) => options.onGetInviteDetails(userId, accountId),
        onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
        syncUserToClient: options.syncUserToClient ?? true,
      };
      return config;
    }
    if (options.mode === 'google-oauth') {
      const config: GoogleOAuthAuthConfig = {
        mode: 'google-oauth',
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: options.redirectUri,
        baseScopes: options.baseScopes,
        store: options.store,
        onGetUser: options.onGetUser as (userId: string) => Promise<SocketAPIUser | undefined>,
        onCreateUser: options.onCreateUser as (profile: GoogleProfile) => Promise<SocketAPIUser>,
        capacitorCallbackUrl: options.capacitorCallbackUrl,
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

  function useAuth(): ServerUseAuthResult<U, A> {
    return useAuthentication<U, A>();
  }

  return {
    configureAuthentication,
    useAuthentication: useAuth,
  };
}
```

- [ ] **Step 4: Build to verify types**

```bash
pnpm build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Run all unit tests**

```bash
pnpm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/auth/registerAuthRoutes.ts src/server/auth/defineAuthentication.ts src/server/providers/authentication/useAuthentication.ts
git commit -m "feat(google-oauth): register server routes and expose getGoogleToken"
```

---

## Task 10: Client `performGoogleSignIn`

**Files:**
- Create: `src/client/auth/googleSignIn.ts`
- Create: `src/client/auth/googleSignIn.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `src/client/auth/googleSignIn.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performGoogleSignIn } from './googleSignIn';

// Minimal GIS SDK mock
function makeGoogleMock(oneTapResult: 'success' | 'suppressed') {
  return {
    accounts: {
      id: {
        initialize: vi.fn(({ callback }: { callback: (cred: { credential: string }) => void }) => {
          if (oneTapResult === 'success') setTimeout(() => callback({ credential: 'id-tok' }), 0);
        }),
        prompt: vi.fn((notify?: (n: { isNotDisplayed(): boolean }) => void) => {
          if (oneTapResult === 'suppressed' && notify) notify({ isNotDisplayed: () => true });
        }),
        cancel: vi.fn(),
      },
    },
  };
}

describe('performGoogleSignIn', () => {
  let originalWindow: typeof window;

  beforeEach(() => {
    originalWindow = global.window as typeof window;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('calls onOneTap with credential when One Tap succeeds', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock('success');
    (global as Record<string, unknown>).window = { Capacitor: undefined, open: vi.fn(() => null), location: { href: '/' } };

    const onOneTap = vi.fn(async () => { /* noop */ });
    const onComplete = vi.fn();

    await performGoogleSignIn({
      clientId: 'cid',
      startUrl: '/api/socketAPI/google/start',
      onOneTap,
      onComplete,
    });

    expect(onOneTap).toHaveBeenCalledWith('id-tok');
    expect(onComplete).toHaveBeenCalled();
  });

  it('opens popup when One Tap is suppressed', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock('suppressed');
    const mockPopup = { closed: false };
    const openMock = vi.fn(() => mockPopup);
    (global as Record<string, unknown>).window = {
      Capacitor: undefined,
      open: openMock,
      location: { href: '/' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const onOneTap = vi.fn(async () => { /* noop */ });
    const onComplete = vi.fn();

    // Don't await — popup flow is async and we just verify open was called
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/api/socketAPI/google/start', onOneTap, onComplete });
    expect(openMock).toHaveBeenCalledWith(expect.stringContaining('google/start'), '_blank', expect.any(String));
    // Resolve by simulating message
    promise.catch(() => { /* expected — popup listener won't fire in test */ });
  });

  it('falls back to redirect when popup returns null (blocked)', async () => {
    (global as Record<string, unknown>).google = makeGoogleMock('suppressed');
    const locationRef = { href: '/' };
    (global as Record<string, unknown>).window = {
      Capacitor: undefined,
      open: vi.fn(() => null),
      location: locationRef,
      sessionStorage: { setItem: vi.fn() },
      addEventListener: vi.fn(),
    };

    const onOneTap = vi.fn(async () => { /* noop */ });

    await performGoogleSignIn({ clientId: 'cid', startUrl: '/api/socketAPI/google/start', onOneTap, onComplete: vi.fn() });

    expect(locationRef.href).toContain('google/start');
  });

  it('uses Capacitor browser when window.Capacitor is present', async () => {
    const openUrl = vi.fn();
    const addListener = vi.fn();
    (global as Record<string, unknown>).window = {
      Capacitor: { isNativePlatform: () => true },
      location: { href: '/' },
    };
    // Mock dynamic import for @capacitor/browser and @capacitor/app
    vi.doMock('@capacitor/browser', () => ({ Browser: { open: openUrl, close: vi.fn() } }));
    vi.doMock('@capacitor/app', () => ({ App: { addListener } }));

    const onOneTap = vi.fn(async () => { /* noop */ });
    const promise = performGoogleSignIn({ clientId: 'cid', startUrl: '/api/socketAPI/google/start', onOneTap, onComplete: vi.fn() });
    // Browser.open should have been called
    expect(openUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('google/start') }));
    promise.catch(() => { /* expected */ });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleSignIn
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/client/auth/googleSignIn.ts`**

```ts
export interface GoogleSignInOptions {
  clientId: string;
  startUrl: string;
  onOneTap(credential: string): Promise<void>;
  onComplete(): void;
  /** When true, skips One Tap and goes straight to popup → redirect. Used for incremental scope requests. */
  skipOneTap?: boolean;
}

declare const google: {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback(cred: { credential: string }): void }): void;
      prompt(notify?: (n: { isNotDisplayed(): boolean }) => void): void;
      cancel(): void;
    };
  };
} | undefined;

function loadGisSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined') { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load GIS SDK'));
    document.head.appendChild(script);
  });
}

async function tryOneTap(clientId: string, onOneTap: (cred: string) => Promise<void>): Promise<boolean> {
  try {
    await loadGisSdk();
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    google!.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }) => {
        try {
          await onOneTap(credential);
          resolve(true);
        } catch {
          resolve(false);
        }
      },
    });
    google!.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) resolve(false);
    });
  });
}

async function tryPopup(startUrl: string, onComplete: () => void): Promise<boolean> {
  const popup = window.open(
    `${startUrl}?popup=true&postAuthUrl=${encodeURIComponent(window.location.href)}`,
    '_blank',
    'width=500,height=600,toolbar=0,menubar=0',
  );
  if (!popup) return false;

  return new Promise<boolean>((resolve) => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if ((event.data as Record<string, unknown>)?.type === 'google-oauth-complete') {
        window.removeEventListener('message', onMessage);
        onComplete();
        resolve(true);
      }
    }
    window.addEventListener('message', onMessage);
  });
}

function doRedirect(startUrl: string): void {
  const redirectUrl = `${startUrl}?redirectMode=true&postAuthUrl=${encodeURIComponent(window.location.href)}`;
  window.sessionStorage?.setItem('google-oauth-return-url', window.location.href);
  window.location.href = redirectUrl;
}

async function tryCapacitor(startUrl: string, onComplete: () => void): Promise<void> {
  const [{ Browser }, { App }] = await Promise.all([
    import('@capacitor/browser'),
    import('@capacitor/app'),
  ]);

  const url = `${startUrl}?platform=capacitor&postAuthUrl=capacitor`;
  await Browser.open({ url });

  await new Promise<void>((resolve) => {
    App.addListener('appUrlOpen', async () => {
      await Browser.close();
      onComplete();
      resolve();
    });
  });
}

export async function performGoogleSignIn(opts: GoogleSignInOptions): Promise<void> {
  const { clientId, startUrl, onOneTap, onComplete, skipOneTap = false } = opts;

  // Capacitor: skip One Tap and popup entirely
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).Capacitor != null) {
    await tryCapacitor(startUrl, onComplete);
    return;
  }

  // 1. One Tap (skipped for incremental scope requests)
  if (!skipOneTap) {
    const oneTapSucceeded = await tryOneTap(clientId, onOneTap);
    if (oneTapSucceeded) { onComplete(); return; }
  }

  // 2. Popup
  const popupSucceeded = await tryPopup(startUrl, onComplete);
  if (popupSucceeded) return;

  // 3. Redirect fallback
  doRedirect(startUrl);
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test googleSignIn
```

Expected: passing tests (some may be environment-limited — popup/Capacitor tests are best-effort in jsdom).

- [ ] **Step 5: Commit**

```bash
git add src/client/auth/googleSignIn.ts src/client/auth/googleSignIn.tests.ts
git commit -m "feat(google-oauth): client sign-in — One Tap, popup, redirect, Capacitor"
```

---

## Task 11: Client `requestScopes` and wire client hooks

**Files:**
- Create: `src/client/auth/googleRequestScopes.ts`
- Create: `src/client/auth/googleRequestScopes.tests.ts`
- Modify: `src/client/auth/useAuthentication.ts`
- Modify: `src/client/auth/defineAuthentication.ts`

- [ ] **Step 1: Write failing tests for `requestScopes`**

Create `src/client/auth/googleRequestScopes.tests.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestScopes } from './googleRequestScopes';

describe('requestScopes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns immediately when server says all scopes already granted', async () => {
    const callScopes = vi.fn(async () => ({ alreadyGranted: true }));
    const openOAuth = vi.fn();
    await requestScopes(['openid'], callScopes, openOAuth);
    expect(callScopes).toHaveBeenCalledWith({ scopes: ['openid'] });
    expect(openOAuth).not.toHaveBeenCalled();
  });

  it('calls openOAuth with missing scopes when not all granted', async () => {
    const callScopes = vi.fn(async () => ({
      alreadyGranted: false,
      missingScopes: ['https://www.googleapis.com/auth/calendar'],
    }));
    const openOAuth = vi.fn(async () => { /* noop */ });
    await requestScopes(
      ['openid', 'https://www.googleapis.com/auth/calendar'],
      callScopes,
      openOAuth,
    );
    expect(openOAuth).toHaveBeenCalledWith(['https://www.googleapis.com/auth/calendar']);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test googleRequestScopes
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/client/auth/googleRequestScopes.ts`**

```ts
import type { GoogleScopesResponse } from '../../common/internalActions';

export async function requestScopes(
  scopes: string[],
  callScopes: (req: { scopes: string[] }) => Promise<GoogleScopesResponse>,
  openOAuth: (missingScopes: string[]) => Promise<void>,
): Promise<void> {
  const result = await callScopes({ scopes });
  if (result.alreadyGranted) return;
  await openOAuth(result.missingScopes ?? scopes);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test googleRequestScopes
```

Expected: both tests pass.

- [ ] **Step 5: Update `src/client/auth/useAuthentication.ts` to wire Google sign-in and `requestScopes`**

Add the new imports at the top of the file (alongside existing imports):

```ts
import { googleOAuthConfigAction, googleOneTapAction, googleScopesAction } from '../../common/internalActions';
import { performGoogleSignIn } from './googleSignIn';
import { requestScopes as doRequestScopes } from './googleRequestScopes';
```

Extend the existing `const { reconnect } = useContext(SocketContext)` to also destructure `name`:

```ts
  const { reconnect, name } = useContext(SocketContext);
```

Add `useAction` calls for the new actions inside the hook, after the existing `useAction` calls:

```ts
  const { googleOAuthConfig } = useAction(googleOAuthConfigAction);
  const { googleOneTap } = useAction(googleOneTapAction);
  const { googleScopes } = useAction(googleScopesAction);
```

Replace the `signIn` function body with a version that handles `google-oauth` mode. The key addition is the Google check before falling through to WebAuthn:

```ts
  const signIn = useBound(async (credentials?: C) => {
    if (credentials == null) {
      if (activeWebAuthnPromise != null) return activeWebAuthnPromise;
      const hasInvite = new URLSearchParams(window.location.search).has('requestId');
      const maybeReconnect = () => { if (userRef.current == null) reconnect(); };

      // Detect Google OAuth mode: fetch config endpoint. Returns clientId if server is in
      // google-oauth mode, throws 404 otherwise. Cached per-render via useAction.
      let googleClientId: string | undefined;
      try {
        const cfg = await googleOAuthConfig();
        googleClientId = cfg.clientId;
      } catch {
        // Not google-oauth mode — fall through to WebAuthn
      }

      if (googleClientId != null) {
        const startUrl = `/${name}/socketAPI/google/start`;
        await performGoogleSignIn({
          clientId: googleClientId,
          startUrl,
          onOneTap: async (credential) => { await googleOneTap({ credential }); },
          onComplete: maybeReconnect,
        });
        return;
      }

      const promise = hasInvite
        ? performWebAuthnRegistration(webauthnInvite, webauthnRegister, maybeReconnect, onPrf)
        : performWebAuthnReauth(callReauth, maybeReconnect, onPrf);
      activeWebAuthnPromise = promise;
      promise.then(() => { activeWebAuthnPromise = undefined; }, () => { activeWebAuthnPromise = undefined; });
      await promise;
    } else {
      await performJwtSignIn(callSignIn, credentials, reconnect);
    }
  });
```

Add `requestScopes` to the hook. The `openOAuth` callback builds the start URL with the missing scopes as a query param, and sets `skipOneTap: true` since One Tap is not applicable for incremental auth:

```ts
  const requestScopesFn = useBound(async (scopes: string[]) => {
    const startUrl = `/${name}/socketAPI/google/start`;
    await doRequestScopes(
      scopes,
      googleScopes,
      async (missingScopes) => {
        const cfg = await googleOAuthConfig();
        await performGoogleSignIn({
          clientId: cfg.clientId,
          startUrl: `${startUrl}?scopes=${encodeURIComponent(missingScopes.join(','))}`,
          onOneTap: async () => { /* not used for incremental auth */ },
          onComplete: reconnect,
          skipOneTap: true,
        });
      },
    );
  });
```

Add `requestScopes: requestScopesFn` to the return object.

- [ ] **Step 6: Update `ClientUseAuthResult` in `src/client/auth/useAuthentication.ts`**

Add `requestScopes` to the `ClientUseAuthResult` interface:

```ts
export interface ClientUseAuthResult<U, A, C> {
  readonly isAuthenticated: boolean;
  readonly user: U | undefined;
  readonly account: A | undefined;
  signIn(credentials?: C): Promise<void>;
  signOut(): Promise<void>;
  requestScopes(scopes: string[]): Promise<void>;
}
```

- [ ] **Step 7: Update `src/client/auth/defineAuthentication.ts`**

The `ClientUseAuthResult` type already comes from `useAuthentication.ts` — no changes needed here since the type is derived automatically.

- [ ] **Step 8: Build to verify types**

```bash
pnpm build
```

Expected: no TypeScript errors.

- [ ] **Step 9: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/client/auth/googleRequestScopes.ts src/client/auth/googleRequestScopes.tests.ts src/client/auth/useAuthentication.ts src/client/auth/defineAuthentication.ts
git commit -m "feat(google-oauth): client requestScopes and wire Google sign-in into useAuthentication"
```

---

## Task 12: Final build and verification

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Build the library**

```bash
pnpm build
```

Expected: dist files generated with no errors.

- [ ] **Step 3: Check bundle sizes are within limits**

```bash
pnpm exec size-limit
```

Expected: all three bundles (server, client, common) within their defined limits.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(google-oauth): complete implementation — routes, client flow, token lifecycle"
```
