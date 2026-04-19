# Authentication Redesign — JWT & WebAuthn Support

**Date:** 2026-04-19
**Status:** Approved for implementation

---

## Overview

Redesign the authentication system in `@anupheaus/socket-api` to support both JWT (credentials-based) and WebAuthn (passkey-based) authentication as first-class, configurable modes. The new system replaces the existing ad-hoc JWT fields on `ServerConfig` with a typed, composable `defineAuthentication` API modelled on the existing `defineAction` pattern.

Key goals:
- Single `defineAuthentication<UserType, CredentialsType>()` call defines all types end-to-end
- Same import path (`@anupheaus/socket-api`) resolves to server or client types automatically via `package.json` export conditions
- Authentication exclusively via HTTP REST endpoints (HttpOnly cookies); socket used only for pushing user state to client
- One session per device per user; fresh session token on every sign-in
- Pluggable server-side storage via a typed store interface

---

## 1. Core API — `defineAuthentication`

`defineAuthentication` lives in common and is re-exported from all entry points.

```ts
const { useAuthentication, configureAuthentication } =
  defineAuthentication<MyUser, { email: string; password: string }>();
```

`defineAuthentication<UserType, CredentialsType>()` returns exactly two things:

- **`configureAuthentication(options)`** — server-only; produces the value passed to `startServer({ auth: ... })`
- **`useAuthentication()`** — works in both environments; TypeScript resolves different return types via `package.json` `node`/`browser` export conditions

The object returned by `defineAuthentication` is a typed brand token (no runtime overhead) — it carries the generic types through to both hooks.

---

## 2. Package Entry Points

The root `.` export in `package.json` is extended with `node`/`browser` conditions so consumers use a single import path:

```json
{
  "exports": {
    ".": {
      "node":    { "types": "./dist/server/index.d.ts", "default": "./dist/server/index.js" },
      "browser": { "types": "./dist/client/index.d.ts", "default": "./dist/client/index.js" }
    },
    "./server":  { "types": "./dist/server/index.d.ts",  "default": "./dist/server/index.js" },
    "./client":  { "types": "./dist/client/index.d.ts",  "default": "./dist/client/index.js" },
    "./common":  { "types": "./dist/common/index.d.ts",  "default": "./dist/common/index.js" }
  }
}
```

Bundlers (Vite, webpack) set the `browser` condition automatically. Node.js uses `node`. The existing sub-path exports remain for backward compatibility.

```ts
// Both server and client files use the same import — TypeScript resolves correctly:
import { useAuthentication } from '@anupheaus/socket-api';
```

---

## 3. `useAuthentication` Return Shapes

### Server (`node` condition)

```ts
const { user, setUser, impersonateUser, signOut, createInvite } = useAuthentication();

// user: UserType | undefined — current user from async local storage (request context)
// setUser(user): Promise<void> — manually set user (no-auth / custom auth scenarios)
// impersonateUser<T>(user, handler): MakePromise<T> — server-side only
// signOut(): Promise<void> — clear user from context, invalidate store record
// createInvite(userId, domain): Promise<string> — WebAuthn mode only; returns invite URL
```

`createInvite` is present on the server return type only when the auth definition was configured with `mode: 'webauthn'`. TypeScript enforces this via the generic brand on the auth definition.

### Client (`browser` condition)

```ts
const { user, signIn, signOut } = useAuthentication();

// user: UserType | undefined — reactive (see Section 4)
// signIn(credentials): Promise<void> — JWT mode; typed from CredentialsType
// signIn(): Promise<void>           — WebAuthn mode; browser handles passkey ceremony
// signOut(): Promise<void>
```

---

## 4. Client Reactivity — Accessed-Flag Pattern

`user` on the client is reactive only if accessed (destructured). The hook uses a `useRef` as an accessed flag:

```ts
function useAuthentication() {
  const [, forceUpdate] = useReducer(x => x + 1, 0);
  const currentUserRef = useRef<UserType | undefined>(getCurrentUser());
  const isUserAccessedRef = useRef(false);

  onUserChanged((newUser) => {
    if (!isUserAccessedRef.current) return; // user not destructured — skip re-render
    if (newUser === currentUserRef.current) return;
    currentUserRef.current = newUser;
    forceUpdate();
  });

  return {
    get user() {
      isUserAccessedRef.current = true; // set flag on first access
      return currentUserRef.current;
    },
    signIn,
    signOut,
  };
}
```

- `const { signIn, signOut } = useAuthentication()` — flag never set, zero re-renders
- `const { user, signIn, signOut } = useAuthentication()` — flag set on first render, fully reactive

The getter is safe with destructuring because React calls `useAuthentication()` on every render, so `user` gets the latest ref value each time the component re-renders.

---

## 5. `configureAuthentication` Options

### JWT Mode

```ts
configureAuthentication({
  mode: 'jwt',
  store: myJwtStore,
  onAuthenticate: async (credentials: CredentialsType) => MyUser | undefined,
  onGetUser: async (userId: string) => MyUser | undefined,
  syncUserToClient?: false, // default: true
})
```

- `onAuthenticate` — called on sign-in to validate credentials and return the user
- `onGetUser` — called on every socket connect (cookie present) to retrieve fresh user data

### WebAuthn Mode

```ts
configureAuthentication({
  mode: 'webauthn',
  store: myWebAuthnStore,
  onGetUserDetails: async (userId: string) => { name: string; displayName?: string },
  onGetUser: async (userId: string) => MyUser | undefined,
  syncUserToClient?: false, // default: true
})
```

- `onGetUserDetails` — called during invite fetch to populate the browser passkey prompt
- `onGetUser` — called on every socket connect (cookie present) to retrieve fresh user data

### `syncUserToClient`

When `true` (default), the library emits a `socketAPIUserChanged` internal event to the client whenever the server calls `setUser()` or the user is resolved on socket connect. The client's reactive `user` updates automatically. Set to `false` to suppress this.

---

## 6. Device Details

Collected client-side by the library on sign-in. Used to compute the `deviceId` hash and stored for audit/display.

```ts
interface SocketAPIDeviceDetails {
  // Navigator
  userAgent: string;
  platform: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory?: number;    // Chrome/Edge only
  maxTouchPoints: number;
  vendor: string;
  // Screen
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  colorDepth: number;
  pixelRatio: number;
  // Environment
  timezone: string;
}
```

**`deviceId` hash** is computed from the stable subset: `userAgent`, `platform`, `hardwareConcurrency`, `screenWidth`, `screenHeight`, `colorDepth`, `pixelRatio`, `timezone`. Fields that change frequently (`viewportWidth`, `viewportHeight`, `language`) are excluded from the hash but retained in `deviceDetails` for display.

IP address is deliberately excluded — it is PII under GDPR and similar legislation and too unstable to be useful as a device identifier.

---

## 7. Auth Store Interfaces

### Base Record and Store

```ts
interface SocketAPIAuthRecord {
  requestId: string;        // ULID — device/session primary key
  sessionToken: string;     // 256-bit cryptographically random — cookie value, never in URLs
  userId: string;
  deviceId: string;         // SHA-256 hash of stable device fingerprint fields
  isEnabled: boolean;
  deviceDetails?: SocketAPIDeviceDetails;
  lastConnectedAt?: number; // ms timestamp
}

interface SocketAPIAuthStore<TRecord extends SocketAPIAuthRecord = SocketAPIAuthRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}
```

### JWT Store

No additional methods — the base store is sufficient:

```ts
interface JwtAuthRecord extends SocketAPIAuthRecord {}
interface JwtAuthStore extends SocketAPIAuthStore<JwtAuthRecord> {}
```

### WebAuthn Store

Adds registration-specific lookup:

```ts
interface WebAuthnAuthRecord extends SocketAPIAuthRecord {
  registrationToken?: string; // short-lived single-use token during registration handshake
  keyHash?: string;           // SHA-256 hex of WebAuthn PRF-derived key — device identity anchor
}

interface WebAuthnAuthStore extends SocketAPIAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
}
```

---

## 8. Session Token Security

- **Value:** `crypto.randomBytes(32).toString('base64url')` — 256 bits of cryptographic randomness
- **Separate from `requestId`:** The `requestId` appears in invite URLs (`?requestId=xxx`) and could be logged. The `sessionToken` is never exposed in URLs, logs, or referrer headers.
- **Rotated on every sign-in:** A fresh `sessionToken` is generated on every successful sign-in, even for a returning device (session fixation prevention per OWASP).
- **Cookie flags:** `HttpOnly`, `Secure`, `SameSite=Strict`
- **One session per device per user:** `store.findByDevice(userId, deviceId)` — update existing record if found, create new record if not.

---

## 9. HTTP REST Endpoints

All endpoints are registered automatically by the library under `/{name}/socketAPI/`:

### JWT Mode

```
POST /{name}/socketAPI/signin
  Body: { ...CredentialsType }
  → onAuthenticate(credentials) → user | undefined
  → store.findByDevice(userId, deviceId)
      found:     store.update(requestId, { sessionToken: fresh, isEnabled: true, deviceDetails, lastConnectedAt })
      not found: store.create({ requestId: ULID(), sessionToken: fresh, userId, deviceId, deviceDetails, isEnabled: true })
  → Set-Cookie: sessionToken (HttpOnly, Secure, SameSite=Strict)
  → Returns 200 on success, 401 on invalid credentials

POST /{name}/socketAPI/signout  ← shared between JWT and WebAuthn
  → Read sessionToken from cookie
  → store.findBySessionToken(sessionToken) → record
  → store.update(record.requestId, { isEnabled: false })
  → Set-Cookie: sessionToken=; Max-Age=0  ← clears cookie
  → Returns 200
```

### WebAuthn Mode

```
GET /{name}/socketAPI/webauthn/invite?requestId=xxx
  → store.findById(requestId) — validates invite record exists and isEnabled: false (not yet registered)
  → Generate registrationToken (ULID), store.update(requestId, { registrationToken })
  → onGetUserDetails(userId) → { name, displayName }
  → Returns { registrationToken, userDetails: { name, displayName } }

POST /{name}/socketAPI/webauthn/register
  Body: { registrationToken, keyHash, deviceDetails }
  → store.findByRegistrationToken(registrationToken) — validates token
  → sessionToken = crypto.randomBytes(32).toString('base64url')
  → store.update(requestId, { keyHash, deviceDetails, sessionToken, isEnabled: true, registrationToken: undefined })
  → Set-Cookie: sessionToken (HttpOnly, Secure, SameSite=Strict)
  → Returns 200
```

**Invite creation (server-side only):**

```ts
// Via useAuthentication() on server — WebAuthn mode only
const { createInvite } = useAuthentication();
const url = await createInvite(userId, 'https://myapp.com');
// → store.create({ requestId: ULID(), userId, isEnabled: false, sessionToken: '', deviceId: '' })
// → returns 'https://myapp.com?requestId=<ULID>'
```

---

## 10. Socket Connect Flow (Both Modes)

On every socket connection the library runs:

```
Cookie present?
  No  → unauthenticated socket (can only reach sign-in endpoints via HTTP)
  Yes → extract sessionToken
      → store.findBySessionToken(sessionToken)
      → record not found OR isEnabled: false → disconnect socket
      → onGetUser(userId) → fresh UserType | undefined
      → setUser(user)
      → if syncUserToClient: emit socketAPIUserChanged to client
      → store.update(requestId, { lastConnectedAt: Date.now() })
```

---

## 11. Client Socket Lifecycle on Auth State Change

The library's client-side `signIn` and `signOut` manage the socket disconnect/reconnect internally. From the consumer's perspective it is a single async call:

**Sign in:**
1. `signIn(credentials)` — calls `POST /{name}/socketAPI/signin`
2. On success: `socket.disconnect()` then `socket.connect()`
3. Cookie is automatically included in the reconnect upgrade headers
4. Socket connect flow (Section 10) runs → user resolved → `socketAPIUserChanged` emitted
5. `user` reactive state updates on client

**Sign out:**
1. `signOut()` — calls `POST /{name}/socketAPI/signout`
2. On success: `socket.disconnect()` then `socket.connect()`
3. No cookie in reconnect headers
4. Socket connects unauthenticated

---

## 12. Internal Socket Events/Actions

All prefixed `socketAPI` to avoid clashing with consumer-defined actions:

| Name | Direction | Purpose |
|------|-----------|---------|
| `socketAPIUserChanged` | server → client | Push updated user to client (`syncUserToClient`) |

No socket actions are used for sign-in or sign-out — those are REST-only. The socket is used exclusively for pushing user state after the connection is established.

---

## 13. `startServer` Changes

Legacy auth fields are removed from `ServerConfig`:
- `privateKey` ✗
- `disableJwtAuth` ✗
- `onSavePrivateKey` ✗
- `onLoadPrivateKey` ✗

Replaced by a single `auth` key:

```ts
interface ServerConfig {
  name: string;
  server: AnyHttpServer;
  auth?: ReturnType<typeof configureAuthentication>; // optional — omit for manual setUser() only
  actions?: SocketAPIServerAction[];
  subscriptions?: SocketAPIServerSubscription[];
  // ... other existing fields unchanged
}
```

When `auth` is omitted, `setUser()` still works server-side and `syncUserToClient` still applies (defaults to `true` at the `startServer` level as well).

---

## 14. Backward Compatibility

- Existing `/server`, `/client`, `/common` sub-path imports continue to work unchanged
- The legacy auth fields are removed — **breaking change**; mxdb-sync will need updating to use the new `defineAuthentication` API
- The `disableTokenReconnect` prop on `AuthenticationProvider` is removed; the new cookie-based flow handles reconnect automatically

---

## 15. What Is Not In Scope

- Device management UI (list/enable/disable devices) — consumers query their own store directly
- WebAuthn re-authentication after cookie expiry (new invite link is the recovery path)
- Native app support (Electron, React Native) — cookie-based auth is browser-only; a future iteration could add socket-based token storage for native targets
- Multi-session-per-user — one session per device per user is the only supported mode
