# server/auth/routes — HTTP Auth Endpoints

Koa route handlers for the REST sign-in and sign-out flows. Registered automatically by `defineAuthentication` — you do not add these manually.

## Files

| File | Purpose |
|------|---------|
| `signinRoute.ts` | `POST /{name}/auth/signin` — validates credentials, issues a JWT, sets the session cookie |
| `signoutRoute.ts` | `POST /{name}/auth/signout` — clears the session cookie |
| `webauthnInviteRoute.ts` | `GET /{name}/socketAPI/webauthn/invite` — validates a pending WebAuthn registration request and returns a one-time `registrationToken` and user details |
| `webauthnRegisterRoute.ts` | `POST /{name}/socketAPI/webauthn/register` — completes WebAuthn registration by storing the key hash, issuing a session token, and setting the session cookie |
| `webauthnReauthRoute.ts` | `POST /{name}/socketAPI/webauthn/reauth` — accepts a PRF-derived `keyHash`, looks up the device record, rotates the session token, and sets a fresh session cookie |

## Cookie behaviour

On successful sign-in a `HttpOnly; Secure; SameSite=Strict` cookie is set containing the JWT. The cookie is automatically sent on every subsequent socket and REST request, so the client never needs to manage the token manually.
