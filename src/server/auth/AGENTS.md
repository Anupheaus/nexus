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
| `googleOAuthAuthConfig.ts` | `GoogleOAuthAuthConfig` interface — Google OAuth provider config passed to `startServer` |
| `googleOAuthState.ts` | HMAC-SHA256 sign/verify utility for the OAuth `state` parameter (CSRF protection) |
| `googleTokenRefresh.ts` | `refreshGoogleToken` — returns a valid Google access token for a session, refreshing via Google's token endpoint if expired or within 30 s of expiry |

## Setup

```ts
// auth.ts
import { defineAuthentication } from '@anupheaus/socket-api/server';

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
3. Browser runs `navigator.credentials.create()` with PRF extension (salt: `'socket-api-auth'`)
4. Client posts `{ registrationToken, keyHash, deviceDetails }` to `POST /webauthn/register`
5. Server sets session cookie; client removes `?requestId` from the URL and reconnects

### Re-authentication (returning device, expired cookie)

1. Client calls `navigator.credentials.get()` with no `allowCredentials` — browser surfaces the passkey automatically
2. Same PRF salt produces the same `keyHash` as at registration
3. Client posts `{ keyHash, deviceDetails }` to `POST /webauthn/reauth`
4. Server looks up the record by `keyHash`, issues a fresh session cookie; client reconnects

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
