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
| `passkeyVerification.ts` | `verifyPasskeyRegistration` / `verifyPasskeySignIn` (sc-627), on @simplewebauthn/server. See WebAuthn → Passkey verification |
| `webauthnChallenge.ts` | `createChallengeSigner(secret)`: stateless, HMAC-signed sign-in challenges that live two minutes (sc-627) |
| `softwarePasskey.testing.ts` | Test only: a software passkey producing genuine registrations and signed sign-ins |
| `storedKeyHash.ts` | `toStoredKeyHash`: nexus's digest of a key hash, kept exported for stores migrating records from before sc-613. Key hashes no longer sign anyone in (sc-627) |
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
4. Client posts `{ registrationToken, credential, deviceDetails }` to `POST /webauthn/register`, where `credential` is the
   passkey's registration (`toRegistrationJson`). The server verifies it (`verifyPasskeyRegistration`: the challenge is the
   registration token, the origin is allowed, the relying party is one of `rpIds`, the user was verified) and stores its
   `credentialId`, `credentialPublicKey` and `credentialCounter`. A passkey another device holds is refused.
5. Server sets session cookie; client removes `?requestId` from the URL and reconnects

### Re-authentication (returning device, expired cookie)

1. Client calls `GET /webauthn/challenge` for a fresh, signed challenge (`webauthnChallenge.ts`)
2. Client calls `navigator.credentials.get()` with that challenge; the browser surfaces the passkey
3. Client posts `{ credential, deviceDetails }` to `POST /webauthn/reauth` (`toAssertionJson`)
4. Server finds the device by `credentialId` and verifies the signature against its stored public key
   (`verifyPasskeySignIn`), then issues a fresh session cookie; client reconnects

The PRF output (and a key hash of it) never leaves the device: it only derives the local database key.

### Passkey verification (sc-627)

- **Nothing a client knows signs it in; only a passkey's signature does.** The server checks the signature over its own
  challenge with the public key stored at registration.
- **Challenges are stateless and short-lived.** `<issuedAt>.<nonce>.<hmac>`, HMAC-SHA256 with `challengeSecret`,
  accepted for two minutes. Every server of an app must share the secret (a challenge issued by one verifies on another),
  so production must configure it; without one a random secret per process is used, for development.
- **No replay, even with a counter that stays 0** (Google Password Manager's does): a sign-in must answer a challenge
  issued after the one its device last answered (`lastChallengeIssuedAt`). A counter that does count must also increase.
- **Origins and relying parties are exact.** `isAllowedOrigin` matches exact values or patterns, never substrings; an
  Android app signs in as `android:apk-key-hash:<hash of its signing certificate>`. `rpIds` lists the relying parties.
- **User verification is required** on registration and sign-in.
- **Biometrics** (Capacitor native) only unlock the stored PRF output while the session is valid (`performBiometricUnlock`);
  without a session the passkey signs in. The old biometric sign-in (a key hash) and `biometric/setup` are gone.
- **Credential ids and public keys are never logged at info.**
- `softwarePasskey.testing.ts` is a software authenticator for tests: real registrations and signatures, not mocks.

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
