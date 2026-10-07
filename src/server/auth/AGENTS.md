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
| `passkeyInstallations.ts` | `isInstallationId`, `findInstallationDevice`, `planNewInstallation`: one device per installation of a synced passkey (sc-645). See WebAuthn → One device per installation |
| `webauthnChallenge.ts` | `createChallengeSigner(secret)`: stateless, HMAC-signed sign-in challenges that live two minutes (sc-627) |
| `softwarePasskey.testing.ts` | Test only: a software passkey producing genuine registrations and signed sign-ins |
| `storedKeyHash.ts` | `toStoredKeyHash`: nexus's digest of a key hash, kept exported for stores migrating records from before sc-613. Key hashes no longer sign anyone in (sc-627) |
| `postAuthUrl.ts` | `resolvePostAuthUrl(url, config)`: where a web Google sign-in may return afterwards — a path on this site, or an http(s) URL on the callback's origin or an `allowedPostAuthOrigins` origin. Refused at the start (`ValidationError`) and replaced by `/` at the callback, so the flow is no open redirect |
| `googleOAuthAuthConfig.ts` | `GoogleOAuthAuthConfig` interface — Google OAuth provider config passed to `startServer` |
| `googleOAuthState.ts` | HMAC-SHA256 sign/verify utility for the OAuth `state` parameter (CSRF protection) |
| `googleTokenRefresh.ts` | `refreshGoogleToken` — returns a valid Google access token for a session, refreshing via Google's token endpoint if expired or within 30 s of expiry |
| `authEventLog.ts` | `logAuthSuccess` / `logAuthFailure` / `logAuthStep`: the one `[Auth]` event helper every sign-in, sign-out and session check uses (sc-378) |
| `authEventModels.ts` | The `[Auth]` vocabulary: `AuthEvent`, `AuthOutcome`, `AuthMethod`, `AuthFailureReason` |
| `verificationFailureCollector.ts` | Keeps the first reason code a passkey ceremony was refused, so the action logs one failure with it |

## Auth event log (sc-378)

Every authentication outcome is one entry from `authEventLog.ts`, through a `Nexus Auth` sub-logger, with the message
`[Auth] <event> succeeded|failed|step` and the meta `event`, `outcome`, `method`, `reason` (failures), `userId` (once
known), `ip` and `userAgent` (a REST request's origin, set in `registerRestActions.ts`; otherwise the socket's handshake, its `ip` resolved from `X-Forwarded-For` with the same trusted proxy hops as REST, so it is the client and not the Fly proxy).

| Level | When | Examples |
|-------|------|----------|
| info | it succeeded | `sign-in` (method `passkey`, `invite`, `google`, `google-one-tap`, `credentials`); `sign-out` (`isSessionRevoked`). Registering a passkey on an invite is one `sign-in` entry with method `invite` and `isPasskeyRegistered` / `isInviteRedeemed` |
| warn | it failed | `sign-in` with `unknown-credential`, `bad-signature`, `challenge-rejected` (expired or replayed), `counter-regression`, `replay`, `device-disabled`, `invite-used`, `oauth-state-mismatch`…; `session` (socket cookie or REST) with `stale-session`, `device-disabled`, `unknown-user`; `token-refresh` with `refresh-failed`; `invite` with `invite-not-found` / `invite-used` |
| debug | a ceremony step | `challenge-issued`, `registration-token-issued`, `oauth-started`, `session-restored`, `session-validated`, `access-token-refreshed` |

- **Failures a safeguard blocked** (see `SECURITY_BLOCK_REASONS`) go through `securityWarn` with `securityEvent: 'auth-blocked'` as well.
- **A connection or request with no session at all logs nothing**: that is the sign-in screen, not a rejection.
- **Never logged:** tokens, cookies, challenges, credential public keys, signatures, PRF output, OAuth codes, email
  addresses, and error text from a ceremony (it can quote the challenge). Failures carry a reason code instead. A new
  failure needs a new `AuthFailureReason`, never a free-text reason.
- Outside a request (a handler called directly) there is no logger, and the helper logs nothing rather than throw.
- `authEventLog.flows.tests.ts` runs the real handlers against a registered listener, including a check that no secret reaches it.

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
4. Client posts `{ registrationToken, credential, deviceDetails, installationId }` to `POST /webauthn/register`, where `credential` is the
   passkey's registration (`toRegistrationJson`). The server verifies it (`verifyPasskeyRegistration`: the challenge is the
   registration token, the origin is allowed, the relying party is one of `rpIds`, the user was verified) and stores its
   `credentialId`, `credentialPublicKey` and `credentialCounter`. A passkey another device holds is refused.
5. Server sets session cookie; client removes `?requestId` from the URL and reconnects

### Re-authentication (returning device, expired cookie)

1. Client calls `GET /webauthn/challenge` for a fresh, signed challenge (`webauthnChallenge.ts`)
2. Client calls `navigator.credentials.get()` with that challenge; the browser surfaces the passkey
3. Client posts `{ credential, deviceDetails, installationId }` to `POST /webauthn/reauth` (`toAssertionJson`)
4. Server finds the device by `credentialId` and the client's `installationId`, and verifies the signature against its
   stored public key (`verifyPasskeySignIn`), then issues a fresh session cookie; client reconnects

### One device per installation (sc-645)

Google Password Manager and iCloud Keychain **sync** passkeys, so one credential (same id, same key) signs in on a phone
and a laptop. A device is therefore an **installation** (a browser profile or an installed app), not a credential:

- **The client keeps an installation id** (`client/auth/installationId.ts`: a random UUID in `localStorage`, for as long
  as the app stays installed) and sends it with registration and every sign-in. A browser that clears site data or
  blocks storage (Safari's 7-day eviction, private windows) is therefore a new device each time; apps that count devices
  should say so to whoever manages them.
- **Registration stores it** on the device it registers (`installationId`).
- **A sign-in finds this installation's device** among the passkey's devices (`findAllByCredentialId`,
  `passkeyInstallations.ts` `findInstallationDevice`). A device registered before installation ids is adopted by the first
  installation to sign in.
- **An installation the passkey has not signed in on before is registered as a new device**: a new record with its own
  `requestId`, `deviceId`, session and `deviceDetails`, copying the person, account and passkey. The passkey's other
  devices keep their sessions. Apps that count devices (Vision's licence seats count auth records) count it as another.
- **The rules hold for the passkey, not per device**, because one key answers for every device it is synced to. The
  store enforces them atomically (`claimPasskeySignIn`, `isPasskeyRevoked`):
  1. **A signed sign-in is single-use across the passkey.** After verifying it, every sign-in (an existing device's or a
     new one's) claims its challenge for the passkey in one atomic write; a challenge already claimed is refused. So a
     sign-in used on the laptop cannot be replayed with the phone's installation id (which would sign the phone out).
     The challenge itself is the key, not "newer than the last": two siblings signing in at once with their own
     challenges both succeed.
  2. **One sign-in creates at most one device.** The new-device path claims before it creates, so of the same sign-in
     sent at once with several installation ids, one claim wins and one device is created. The unique
     (`credentialId`, `installationId`) index still stops one installation being registered twice.
  3. **A revoke is recorded for the passkey and survives the device.** The store marks the passkey revoked whenever it
     writes `isEnabled: false` to, or deletes, a device with a passkey: nexus's sign-out, an admin disable or delete, any
     caller. The mark is never cleared, so neither deleting the disabled device nor re-enabling it lifts it. A revoked
     passkey's enabled devices still sign in; it registers no new installations (the claim refuses `isNewDevice`), so
     the person needs a fresh invite. `planNewInstallation` also refuses while a sibling is disabled (an early check).
     A revoke landing between the claim and the create is caught after the create: the new device is disabled and the
     sign-in refused.
  - We chose a sticky passkey-level mark over forbidding the delete of a disabled device: admins must be able to tidy the
    device list, and the mark also covers a delete of an enabled device and devices disabled by any caller.
- Logged at info (with the new `requestId`) when a new installation registers, and at warn (reason only) when one is refused.

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
  Android app signs in as `android:apk-key-hash:<hash of its signing certificate>`. `rpIds` is a list, or chosen per
  ceremony from its origin (`(origin) => string[]`): a web page's passkeys belong to its own host, a native app's to
  its parent domain. No relying party for an origin refuses the ceremony.
- **The replay check and the write are one step** when the store has `recordSignIn` (mxdb does): of two identical
  sign-ins sent together only one is recorded and gets a session. Stores without it fall back to a plain update.
- **Challenges are signed under the label `nexus-webauthn-signin:v1.`**; `challengeSecret` must be used for nothing else.
- **Why a ceremony failed is logged on the server** as an `[Auth]` reason code (see Auth event log), never returned to the client.
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
