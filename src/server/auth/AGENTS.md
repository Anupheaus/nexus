# server/auth — Authentication (JWT, WebAuthn & Google OAuth)

Full authentication support with session cookies, device verification, and sign-in/sign-out actions for JWT, WebAuthn passkey, and Google OAuth flows. Wire in via `defineAuthentication` and pass the result to `startServer`.

## Files

| File | Purpose |
|------|---------|
| `defineAuthentication.ts` | Factory that returns `configureAuthentication(options)` and `useAuthentication()` hook scoped to your user/credential types |
| `authConfig.ts` | `AuthConfig` and `JwtAuthConfig` type definitions |
| `registerAuthRoutes.ts` | Registers auth actions (`createSigninAction`, `createSignoutAction`, etc.) into the global action registry |
| `validateSessionCookie.ts` | Middleware that reads the JWT cookie on socket connect and restores the user session |
| `validateRestSession.ts` | Middleware that validates JWT on REST requests |
| `storedKeyHash.ts` | `toStoredKeyHash` / `findDeviceByKeyHash`: the store holds a `sha256:`-prefixed digest of a device's key hash, never the value a client sends; a device is only ever looked up by that digest (sc-613). See WebAuthn → Key hashes at rest |
| `postAuthUrl.ts` | `resolvePostAuthUrl(url, config)`: where a web Google sign-in may return afterwards — a path on this site, or an http(s) URL on the callback's origin or an `allowedPostAuthOrigins` origin. Refused at the start (`ValidationError`) and replaced by `/` at the callback, so the flow is no open redirect |
| `googleOAuthAuthConfig.ts` | `GoogleOAuthAuthConfig` interface — Google OAuth provider config passed to `startServer` |
| `googleOAuthState.ts` | HMAC-SHA256 sign/verify utility for the OAuth `state` parameter (CSRF protection) |
| `googleTokenRefresh.ts` | `refreshGoogleToken` — returns a valid Google access token for a session, refreshing via Google's token endpoint if expired or within 30 s of expiry |

## Per-connection pre-auth hook

All three modes accept an optional `onResolveConnection?(socket): Promise<void>` in `configureAuthentication({ ... })`. It runs once per socket connection, inside the same per-connection scope as authentication, AFTER the client is set but BEFORE the auth store is queried (see `../socketAuthMiddleware.ts`). Optional; a no-op when omitted. Intended for consumers that need to resolve per-connection context (e.g. tenant/database routing) ahead of authentication.

## Per-request pre-auth hook (REST)

REST counterpart: `onResolveRestConnection?(req: IncomingMessage): Promise<void>`, also on `configureAuthentication({ ... })` for all three modes. It runs once per REST request, inside the existing per-request wrap in `src/server/actions/registerRestActions.ts` (see `../actions/restAuthMiddleware.ts`'s `runRestAuth`), BEFORE the auth store is queried. Unlike the session lookup, it runs even for `isPublic` actions (e.g. webauthn invite/register/reauth) since those still query the auth store directly inside their own handlers — device-onboarding flows need per-connection context resolved before any store access. Optional; a no-op when omitted.

## Setup

```ts
// auth.ts
import { defineAuthentication } from '@anupheaus/nexus/server';

interface MyUser { id: string; email: string; }
interface MyCredentials { email: string; password: string; }

export const { configureAuthentication, useAuthentication } =
  defineAuthentication<MyUser, MyCredentials>();
```

```ts
// server.ts
import { configureAuthentication } from './auth';
import { jwtStore } from './jwtStore'; // your JwtAuthStore implementation

await startServer({
  auth: configureAuthentication({
    mode: 'jwt',
    store: jwtStore,
    async onAuthenticate({ email, password }) {
      return await db.users.findByCredentials(email, password);
    },
    async onGetUser(id) {
      return await db.users.findById(id);
    },
  }),
  ...
});
```

## Using auth in handlers

```ts
import { useAuthentication } from './auth';

const handleDeleteAccount = createServerActionHandler(deleteAccountAction, async () => {
  const { user, signOut } = useAuthentication();
  await db.users.delete(user!.id);
  await signOut();
});
```

## Impersonation

```ts
const { impersonateUser } = useAuthentication();

// Run code as a different user without changing the session:
await impersonateUser(otherUser, async () => {
  await handleSomeAction();
});
```

## WebAuthn

WebAuthn authentication uses the PRF extension to derive a deterministic `keyHash` from the user's passkey. There are two flows.

### Registration (first-time device, via invite link)

1. Server calls `createInvite(userId, baseUrl)` → returns `${baseUrl}?requestId=<uuid>`
2. User visits the invite URL; client calls `GET /webauthn/invite?requestId=xxx` → gets `{ registrationToken, userDetails }`
3. Browser runs `navigator.credentials.create()` with PRF extension (salt: `'Nexus-auth'`)
4. Client posts `{ registrationToken, keyHash, deviceDetails }` to `POST /webauthn/register`
5. Server sets session cookie; client removes `?requestId` from the URL and reconnects

### Re-authentication (returning device, expired cookie)

1. Client calls `navigator.credentials.get()` with no `allowCredentials` — browser surfaces the passkey automatically
2. Same PRF salt produces the same `keyHash` as at registration
3. Client posts `{ keyHash, deviceDetails }` to `POST /webauthn/reauth`
4. Server looks up the record by `keyHash` (through its digest, below), issues a fresh session cookie; client reconnects

### Key hashes at rest (sc-613)

The server never verifies a WebAuthn assertion: it signs in whichever device holds the `keyHash` the client sends, so a
`keyHash` is a **bearer credential**. What protects it:
- **The store holds only a digest.** `toStoredKeyHash` gives `sha256:<hex>`, and register, re-auth and biometric
  setup all go through it. A copy of the store (a database read, a backup, a logged record) cannot be replayed: re-auth
  hashes what the client sends, and nothing is ever looked up raw. A store must migrate devices registered before
  digests itself (mxdb does, on first opening each database); one that has not no longer signs them in.
- **One key hash, one device.** Register refuses a key hash another device holds ("Passkey already registered").
- **Keys are strings** (`isAuthKey`, sc-620), so no store query can be widened.
- **Only the passkey's relying party can derive it.** An app sets `<Nexus rpId>` to a parent domain only in a native
  app (sc-507): on the web every page under that domain could run the ceremony.

The complete fix is to verify a real assertion on re-auth: a server-issued, single-use challenge, and the signature
checked against the credential's public key stored at registration. That was judged too large for the alpha: Vision
sc-627.

## Google OAuth

Google OAuth uses the Authorization Code flow with PKCE-style CSRF protection via a signed `state` parameter.

```ts
await startServer({
  auth: configureAuthentication({
    mode: 'google-oauth',
    store: googleStore,          // GoogleOAuthAuthStore — userId IS the Google sub
    clientId: '...apps.googleusercontent.com',
    clientSecret: '...',
    redirectUri: 'https://myapp.com/api/socketAPI/google/callback',
    baseScopes: ['openid', 'email', 'profile'],
    async onCreateUser({ id, email, name }) {
      await db.users.create({ id, email, name });
    },
    async onGetUser(id) {
      return await db.users.findById(id);
    },
  }),
});
```

- `userId` in `GoogleOAuthAuthRecord` is the Google subject ID (`sub`) — no separate `googleId` field.
- `GoogleOAuthAuthStore` extends the base store with `findByUserId(userId)` to look up an existing record on sign-in.
- `googleTokenRefresh.ts` keeps access tokens fresh; call `refreshGoogleToken` from action handlers that need a valid token.
