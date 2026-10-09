# Authentication

> How defineAuthentication wires sessions: server config, the sign-in and sign-out routes, client state and the store.
>
> Status: accepted · Version 2

`defineAuthentication<User, Credentials>()` in `@anupheaus/nexus` returns `configureAuthentication` for the server and `useAuthentication` for the client. Sessions live in HttpOnly cookies — no localStorage, no token exposed to JavaScript.

Server: pass `configureAuthentication({ mode, store, onAuthenticate, onGetUser, syncUserToClient })` into `startServer`. The library registers `POST /{name}/socketAPI/signin` and `POST /{name}/socketAPI/signout`, and on every socket connect it reads the session cookie, validates it against the store, and calls `setUser(user)` in async context.

Client: `const { user, signIn, signOut } = useAuthentication()`. Reading `user` subscribes the component to updates; destructuring only `signIn`/`signOut` causes no re-renders. Server handlers use `useAuthentication()` for `user`, `setUser`, `signOut` and `impersonateUser`.

Store: implement `NexusAuthStore` (`create`, `findById`, `findBySessionToken`, `findByDevice`, `update`). One session per device per user, and a fresh 256-bit `sessionToken` on every sign-in, so session fixation fails.

| Property | Detail |
|---|---|
| Cookie flags | `HttpOnly; Secure; SameSite=Strict; Path=/` |
| Session token | `crypto.randomBytes(32).toString('base64url')` |
| Device identity | SHA-256 of stable fingerprint fields (never the IP) |
