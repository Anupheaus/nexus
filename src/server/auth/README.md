# server/auth — JWT Authentication

Full JWT-based authentication with session cookies, device verification, and REST sign-in/sign-out endpoints. Wire in via `defineAuthentication` and pass the result to `startServer`.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [routes/](routes/README.md) | HTTP handlers for `POST /signin` and `POST /signout` |

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
