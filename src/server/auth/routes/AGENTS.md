# server/auth/routes — HTTP Auth Endpoints

Koa route handlers for the REST sign-in and sign-out flows. Registered automatically by `defineAuthentication` — you do not add these manually.

## Files

| File | Purpose |
|------|---------|
| `signoutRoute.ts` | `POST /{name}/auth/signout` — clears the session cookie |
| `webauthnInviteRoute.ts` | `GET /{name}/socketAPI/webauthn/invite?requestId=xxx` — validates invite record, generates registrationToken, returns userDetails |
| `webauthnRegisterRoute.ts` | `POST /{name}/socketAPI/webauthn/register` — validates registrationToken, stores keyHash, sets session cookie |
| `webauthnReauthRoute.ts` | `POST /{name}/socketAPI/webauthn/reauth` — looks up record by keyHash, issues fresh session cookie |

## Cookie behaviour

On successful sign-in a `HttpOnly; Secure; SameSite=Strict` cookie is set containing the JWT. The cookie is automatically sent on every subsequent socket and REST request, so the client never needs to manage the token manually.
