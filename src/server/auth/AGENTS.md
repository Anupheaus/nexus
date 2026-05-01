# server/auth — Authentication (JWT & WebAuthn)

Full JWT-based authentication with session cookies, device verification, and REST sign-in/sign-out endpoints. Wire in via `defineAuthentication` and pass the result to `startServer`.

## Files

| File | Purpose |
|------|---------|
| `defineAuthentication.ts` | Factory that returns `configureAuthentication(options)` and `useAuthentication()` hook scoped to your user/credential types |
| `authConfig.ts` | `AuthConfig` and `JwtAuthConfig` type definitions |
| `registerAuthRoutes.ts` | Registers the sign-in/sign-out Koa routes |
| `validateSessionCookie.ts` | Middleware that reads the JWT cookie on socket connect and restores the user session |
| `validateRestSession.ts` | Middleware that validates JWT on REST requests |

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
