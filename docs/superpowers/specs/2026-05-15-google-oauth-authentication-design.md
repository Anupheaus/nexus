# Google OAuth Authentication — Design Spec

**Date:** 2026-05-15
**Status:** Approved

---

## Overview

Add `google-oauth` as a third authentication mode alongside `jwt` and `webauthn`. The library auto-registers all required server routes and handles the full client-side sign-in flow (Google One Tap → popup → redirect fallback, plus Capacitor native browser). The consumer API is identical in shape to the existing modes.

---

## Architecture

The feature is entirely additive — no changes to `startServer`, `validateSessionCookie`, `useAuthentication` hook shape, or any existing auth mode.

**New server pieces:**
- `GoogleOAuthAuthConfig` — new config shape added to the `AuthConfig` union
- `GoogleOAuthAuthRecord` / `GoogleOAuthAuthStore` — extends the base store with Google token fields
- Four new server route handlers auto-registered by `registerAuthRoutes`
- `getGoogleToken()` added to `ServerUseAuthResult`

**New client pieces:**
- `performGoogleSignIn` — orchestrates the One Tap → popup → redirect → Capacitor flow
- `requestScopes` added to `ClientUseAuthResult`

---

## Store Interface & Token Lifecycle

```ts
interface GoogleOAuthAuthRecord extends SocketAPIAuthRecord {
  googleId: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiresAt: number;   // unix ms
  grantedScopes: string[];
}

interface GoogleOAuthAuthStore extends SocketAPIAuthStore<GoogleOAuthAuthRecord> {
  findByGoogleId(googleId: string): Promise<GoogleOAuthAuthRecord | undefined>;
}
```

`GoogleOAuthAuthRecord` inherits `deviceId`, `deviceDetails`, and `lastConnectedAt` from `SocketAPIAuthRecord`. The existing one-session-per-device enforcement via `findByDevice(userId, deviceId)` applies identically to this mode.

**`getGoogleToken()` behaviour (server-side):**
1. Reads the record from the store
2. If `googleTokenExpiresAt` is still in the future — returns `googleAccessToken` as-is
3. If expired — calls Google's token refresh endpoint with `googleRefreshToken`, updates the record (`googleAccessToken`, `googleTokenExpiresAt`), returns the new token

The app never handles raw tokens; the library manages the full refresh lifecycle.

---

## Server Routes

All four routes are auto-registered by `registerAuthRoutes` when `mode: 'google-oauth'` is configured. No consumer wiring required.

### `GET /{name}/socketAPI/google/start`

Query params:
- `scopes` (optional, comma-separated) — additional scopes for incremental requests
- `state` — signed payload containing: device details, CSRF nonce, post-auth redirect URL, platform (`web` | `capacitor`)

Behaviour:
- Merges `baseScopes` (from config) with any `?scopes` param
- Appends `include_granted_scopes=true` when `?scopes` is present (incremental auth)
- HMAC-signs the `state` payload using `clientSecret` as the key (available in config, no extra secret needed)
- Redirects to Google's authorization endpoint

### `GET /{name}/socketAPI/google/callback`

Behaviour:
- Verifies `state` HMAC signature and CSRF nonce; rejects on mismatch
- Exchanges `code` for `accessToken`, `refreshToken`, `expiresIn`, `scope`
- Calls `onGetGoogleUser(googleId)`:
  - If found: updates `googleAccessToken`, `googleRefreshToken`, `googleTokenExpiresAt`, `grantedScopes` on the existing record
  - If not found: calls `onCreateUser(profile)`, creates a new auth record
- The resulting app user's internal `id` is stored as `userId` in the session record, so `validateSessionCookie` can call `onGetUser(userId)` identically to JWT/WebAuthn
- Recovers device details from `state`, creates session record, sets `socketapi_session` HttpOnly cookie
- Responds:
  - Web popup mode: returns an inline HTML response (`<script>window.opener.postMessage(...); window.close()</script>`) — no separate route needed
  - Web redirect mode: redirects to the post-auth URL from `state`
  - Capacitor: redirects to `capacitorCallbackUrl` from config (e.g. `com.myapp://google-oauth-callback`)

### `POST /{name}/socketAPI/google/onetap`

Used by the One Tap flow only (no redirect required).

Behaviour:
- Receives Google ID token from the GIS SDK credential callback
- Verifies the ID token via Google's `tokeninfo` endpoint or public keys
- Calls `onGetGoogleUser(googleId)` / `onCreateUser(profile)` as above; stores internal `userId` in session record
- Creates session record, sets `socketapi_session` HttpOnly cookie
- Returns `{ ok: true }` — no redirect

### `POST /{name}/socketAPI/google/scopes`

Used by `requestScopes` client-side to check before triggering an OAuth flow.

Behaviour:
- Reads the current session's `grantedScopes` from the store
- If all requested scopes are present: refreshes the access token if expired (calls `getGoogleToken()` internally), returns `{ alreadyGranted: true }`
- If any scope is missing: returns `{ alreadyGranted: false, missingScopes: string[] }`

---

## Client Sign-In Flow

`performGoogleSignIn(clientId, startUrl, onComplete)` runs the following chain in order:

### 1. Google One Tap (Chrome with active Google session)

- Dynamically loads the GIS SDK (`https://accounts.google.com/gsi/client`) if `window.google` not already present
- Calls `google.accounts.id.initialize` with `clientId` and a credential callback
- Prompts One Tap — shows a small in-page chip if the user has an active Chrome/Google session
- On credential: POSTs the ID token to `/{name}/socketAPI/google/onetap`; on success, calls `onComplete`
- If One Tap is suppressed (dismissed, FedCM blocked, unsupported): falls through to step 2

### 2. Popup

- Opens `/{name}/socketAPI/google/start` in a small popup window (`width=500, height=600`)
- Listens for `window.message` events from the popup origin
- On `{ type: 'google-oauth-complete' }` message: calls `onComplete`
- If `window.open` returns `null` (popup blocked): falls through to step 3

### 3. Redirect fallback

- Stores the current URL in `sessionStorage` so the app can restore state on return
- Navigates to `/{name}/socketAPI/google/start?redirectMode=true`
- Callback sets the cookie then redirects back; socket reconnects on page load

### Capacitor (auto-detected via `window.Capacitor != null`)

- Skips One Tap, popup, and redirect entirely
- Opens `/{name}/socketAPI/google/start?platform=capacitor` via `@capacitor/browser` (`Browser.open`)
- Registers a one-time listener on the Capacitor `App` plugin (`App.addListener('appUrlOpen', ...)`)
- Callback route redirects to the app's registered deep-link scheme; the App plugin fires `appUrlOpen`, `Browser.close()` is called, `onComplete` is called

Device details are collected client-side before the flow starts and embedded in the `state` parameter sent to `/{name}/socketAPI/google/start`, so they survive the redirect round-trip.

---

## `requestScopes(scopes)` — Client

```ts
await requestScopes(['https://www.googleapis.com/auth/calendar']);
```

Behaviour:
1. POSTs to `/{name}/socketAPI/google/scopes` with the requested scopes
2. If `{ alreadyGranted: true }` — returns immediately (token was refreshed server-side if needed)
3. If `{ alreadyGranted: false }` — runs the popup → redirect chain (skips One Tap; not applicable for incremental auth) with `?scopes=<missingScopes>` appended to the start URL
4. On completion, server updates `grantedScopes` and tokens in the store

---

## Consumer API

### Shared (common)

```ts
export const { configureAuthentication, useAuthentication } =
  defineAuthentication<MyUser, MyAccount, void>();
// Signature unchanged — no new type parameters needed
```

### Server config

```ts
configureAuthentication({
  mode: 'google-oauth',
  clientId: 'xxx.apps.googleusercontent.com',
  clientSecret: '...',
  baseScopes: ['openid', 'email', 'profile'],
  store: myGoogleStore,
  onGetGoogleUser: async (googleId) => db.findUserByGoogleId(googleId),   // find existing user by Google ID
  onGetUser: async (userId) => db.findUserById(userId),
  onCreateUser: async (profile) => db.createUser({ googleId: profile.id, name: profile.name }),
  capacitorCallbackUrl: 'com.myapp://google-oauth-callback', // optional; register in Google Cloud Console
  syncUserToClient: true,   // default true
})
```

`onGetUser` is called first. If it returns `undefined`, `onCreateUser` is called. Both paths proceed to session creation.

### Server handler (inside actions/subscriptions)

```ts
const { user, account, getGoogleToken } = useAuthentication<MyUser>();
const token = await getGoogleToken();
const events = await googleCalendarClient(token).listEvents();
```

### Client

```ts
const { user, signIn, signOut, requestScopes } = useAuthentication<MyUser>();

// Sign in — One Tap → popup → redirect, Capacitor auto-detected
await signIn();

// Request an extra scope only when the feature needs it
await requestScopes(['https://www.googleapis.com/auth/calendar']);
```

`SocketAPI` component props are unchanged. No `platform` prop required.

---

## `defineAuthentication` Changes

```ts
export interface GoogleOAuthConfigureOptions<U extends SocketAPIUser> {
  mode: 'google-oauth';
  clientId: string;
  clientSecret: string;
  baseScopes: string[];
  store: GoogleOAuthAuthStore;
  /** Called during OAuth callback to find an existing user by their Google ID. */
  onGetGoogleUser(googleId: string): Promise<U | undefined>;
  /** Called by validateSessionCookie on every socket connect — receives the internal app userId. */
  onGetUser(userId: string): Promise<U | undefined>;
  /** Called when onGetGoogleUser returns undefined (first sign-in). */
  onCreateUser(profile: GoogleProfile): Promise<U>;
  /** Required when Capacitor support is needed. Must be registered as a redirect URI in Google Cloud Console. */
  capacitorCallbackUrl?: string;
  syncUserToClient?: boolean;
}

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}
```

`configureAuthentication` accepts `GoogleOAuthConfigureOptions` in addition to `JwtConfigureOptions` and `WebAuthnConfigureOptions`. `AuthConfig` union gains `GoogleOAuthAuthConfig`.

`ServerUseAuthResult` gains:
```ts
getGoogleToken(): Promise<string>;
```

`ClientUseAuthResult` gains:
```ts
requestScopes(scopes: string[]): Promise<void>;
```

---

## Security Properties

| Property | Detail |
|---|---|
| Cookie flags | `HttpOnly; Secure; SameSite=Strict; Path=/` — identical to JWT/WebAuthn |
| CSRF protection | `state` parameter signed with server `privateKey`; nonce verified on callback |
| One Tap token | ID token verified via Google public keys before trusting |
| Refresh tokens | Stored server-side only; never sent to the client |
| Access tokens | Never exposed to the browser; only accessible server-side via `getGoogleToken()` |
| Session fixation | Fresh `sessionToken` generated on every sign-in |
| Device identity | Device details embedded in signed `state`; recovered on callback |

---

## Testing

### Unit tests
- `googleStartAction`: URL construction (base scopes, incremental scopes, `include_granted_scopes`), state signing, Capacitor vs web platform param
- `googleCallbackAction`: code exchange (mocked), `onGetUser` found path, `onGetUser` not found → `onCreateUser` path, CSRF nonce rejection, Capacitor vs web redirect
- `googleOneTapAction`: ID token verification (mocked), user upsert paths, cookie setting
- `googleScopesAction`: already-granted short-circuit (with and without token refresh), missing-scope response
- `getGoogleToken`: fresh token passthrough, expired → refresh → updated record, refresh failure propagation
- `performGoogleSignIn` (client, jsdom): One Tap success path, One Tap suppressed → popup, popup blocked → redirect, Capacitor path (mocked `window.Capacitor` and `App` plugin)
- `requestScopes` (client): already-granted returns immediately, missing triggers OAuth flow

### E2E tests
- Extend the existing harness with a mocked Google token endpoint registered via `onRegisterRoutes`
- Full sign-in flow: One Tap mock → session cookie set → socket reconnects → `user` populated
- Incremental scope flow: first call already-granted, second call triggers flow, `grantedScopes` updated

---

## Capacitor Peer Dependencies

`@capacitor/browser` and `@capacitor/app` are **optional** peer dependencies. The library dynamically imports them at runtime only when `window.Capacitor != null`. If they are not installed and Capacitor is detected, the library falls back to the popup → redirect chain and logs a warning. Consumers targeting Capacitor must install both packages themselves.

---

## New Files

| Path | Purpose |
|---|---|
| `src/common/auth/googleOAuthTypes.ts` | `GoogleOAuthAuthRecord`, `GoogleOAuthAuthStore`, `GoogleProfile` |
| `src/server/auth/googleOAuthAuthConfig.ts` | `GoogleOAuthAuthConfig` interface |
| `src/server/actions/googleStartAction.ts` | Start route handler |
| `src/server/actions/googleCallbackAction.ts` | Callback route handler |
| `src/server/actions/googleOneTapAction.ts` | One Tap POST handler |
| `src/server/actions/googleScopesAction.ts` | Scope check POST handler |
| `src/client/auth/googleSignIn.ts` | `performGoogleSignIn` — One Tap → popup → redirect → Capacitor |
| `src/client/auth/googleRequestScopes.ts` | `requestScopes` client logic |

### Modified files

| Path | Change |
|---|---|
| `src/common/auth/authTypes.ts` | Add `GoogleOAuthAuthRecord`, `GoogleOAuthAuthStore`, `GoogleProfile` exports |
| `src/server/auth/authConfig.ts` | Add `GoogleOAuthAuthConfig` to `AuthConfig` union |
| `src/server/auth/defineAuthentication.ts` | Add `GoogleOAuthConfigureOptions`, `getGoogleToken` on `ServerUseAuthResult` |
| `src/server/auth/registerAuthRoutes.ts` | Register four new Google routes when `mode === 'google-oauth'` |
| `src/client/auth/useAuthentication.ts` | Add `requestScopes` to `ClientUseAuthResult`, wire `performGoogleSignIn` into `signIn()` |
| `src/client/auth/defineAuthentication.ts` | Add `requestScopes` to client result type |
| `src/server/startServer.ts` | No change — already handles `auth.store` and `auth.onGetUser` generically via `AuthConfig` union; `GoogleOAuthAuthConfig` must expose these at the same keys |
