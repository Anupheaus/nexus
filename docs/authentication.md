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
    store: myJwtStore,         // implements SocketAPIAuthStore
    onAuthenticate: async ({ email, password }) => findUser(email, password),
    onGetUser: async (userId) => getUserById(userId),
    syncUserToClient: true,    // default — pushes user state on every connect
  }),
});
```

The library automatically registers two routes:

- `POST /{name}/socketAPI/signin` — validates credentials, sets `socketapi_session` HttpOnly cookie
- `POST /{name}/socketAPI/signout` — clears the cookie and disables the session record

On every socket connect the library reads the session cookie, validates it against the store, and calls `setUser(user)` in async context.

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

Provide an implementation of `SocketAPIAuthStore` (from `@anupheaus/nexus/common`):

```ts
interface SocketAPIAuthStore<TRecord extends SocketAPIAuthRecord = SocketAPIAuthRecord> {
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
- [Client guide](./client-guide.md) — `SocketAPI` props
- [Async context](./async-context.md) — connection-scoped state after auth
