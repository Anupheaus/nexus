# Authentication

The library ships a typed `defineAuthentication` factory that wires up session management, REST sign-in/sign-out routes, and reactive client state — all via **HttpOnly cookies** (no localStorage, no JWT exposure to JavaScript).

## Quick start

### Shared (common)

```ts
import { defineAuthentication } from '@anupheaus/nexus';

export const { configureAuthentication, useAuthentication } =
  defineAuthentication<MyUser, { email: string; password: string }>();
```

### Server

```ts
import { startServer } from '@anupheaus/nexus/server';
import { configureAuthentication } from './auth';

await startServer({
  name: 'api',
  server,
  auth: configureAuthentication({
    mode: 'jwt',
    store: myJwtStore,         // implements NexusAuthStore
    onAuthenticate: async ({ email, password }) => findUser(email, password),
    onGetUser: async (userId) => getUserById(userId),
    syncUserToClient: true,    // default — pushes user state on every connect
  }),
});
```

The library automatically registers two routes:

- `POST /{name}/socketAPI/signin` — validates credentials, sets `nexus_session` HttpOnly cookie
- `POST /{name}/socketAPI/signout` — clears the cookie and disables the session record

Every REST response sends each cookie it sets as its own `Set-Cookie` header. A request on a connection the server does not know yet also gets the `nexus-conn` cookie, and a handler's cookies (the session cookie on sign-in, invite redemption, passkey sign-in, Google sign-in and sign-out, or any `setCookie` / `removeCookie` / `setHeaders({ 'Set-Cookie': … })` of an app's own) go out beside it rather than replacing it.

On every socket connect the library reads the session cookie, validates it against the store, and calls `setUser(user)` in async context.

A refused session never leaves the socket signed in. The user is kept per browser (the `nexus-conn` cookie), not per socket, so when a session is refused the library clears the user and account an earlier socket of that browser signed in. A disabled device's connection is refused outright: the client's `connect_error` carries `data: { reason: 'device-disabled' }`, and the client acts on it as it does on the device-disabled event: `Nexus`'s `onDeviceDisabled` is called (so an open page is shut out when it next reconnects, and a reloaded one at once), the biometric key is forgotten, and a token kept in `tokenStorage` (Capacitor) is removed. Any other refused session (stale, unknown user, malformed) connects signed out, and a stale `auth.sessionToken` also gets `nexus:sessionInvalid` so the app can forget it. No session at all is an ordinary signed-out connection.

### Client

```tsx
function LoginForm() {
  const { user, signIn, signOut } = useAuthentication<MyUser, MyCredentials>();

  if (user) return <button onClick={signOut}>Sign out ({user.name})</button>;
  return (
    <button onClick={() => signIn({ email: 'alice@example.com', password: 's3cr3t' })}>
      Sign in
    </button>
  );
}
```

`user` is reactive — accessing it inside `useAuthentication()` subscribes the component to updates. If you only need `signIn`/`signOut`, destructuring those without `user` causes **zero re-renders**.

### Server-side (inside handlers)

```ts
const { user, setUser, signOut, impersonateUser } = useAuthentication<MyUser>();
```

`setUser` stores the user in async context and (when `syncUserToClient: true`) emits `socketAPIUserChanged` to the connected client.

## Store interface

Provide an implementation of `NexusAuthStore` (from `@anupheaus/nexus/common`):

```ts
interface NexusAuthStore<TRecord extends NexusAuthRecord = NexusAuthRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}
```

One session per device per user is enforced via `findByDevice`. A fresh `sessionToken` (256-bit random) is generated on every sign-in to prevent session fixation.

## Security properties

| Property | Detail |
|---|---|
| Cookie flags | `HttpOnly; Secure; SameSite=Strict; Path=/` |
| Session token | `crypto.randomBytes(32).toString('base64url')` — 256-bit CSPRNG |
| Session fixation | Token rotated on every sign-in |
| Device identity | SHA-256 of stable browser fingerprint fields (no IP address) |
| One session per device | Existing device record is updated rather than duplicated |

## Related

- [README](../README.md) — full quick-start example
- [Server guide](./server-guide.md) — `startServer` options
- [Client guide](./client-guide.md) — `Nexus` props
- [Async context](./async-context.md) — connection-scoped state after auth
