# client/auth — Client-Side Authentication

Sets up the client auth flow including login, logout, device fingerprinting, and user state.

## Files

| File | Purpose |
|------|---------|
| `AuthenticationProvider.tsx` | React provider — syncs auth state from the socket connection and makes user available via context |
| `defineAuthentication.ts` | Factory that returns `useAuthentication()` hook scoped to your credential and user types |
| `useAuthentication.ts` | React hook providing current user, `signIn`, `signOut`, and `requestScopes`. Routes to Google OAuth, JWT, or WebAuthn depending on server mode and call context |
| `collectDeviceDetails.ts` | Collects browser/device metadata sent with auth requests |
| `webauthnUtils.ts` | Pure WebAuthn helpers: `computeKeyHash` (SHA-256 hex), `getPrfResult` (normalise PRF output to ArrayBuffer) |
| `webauthnRegistration.ts` | `performWebAuthnRegistration` — orchestrates the full passkey registration flow (invite → ceremony → register); exports `InviteCaller` and `RegisterCaller` type aliases |
| `webauthnReauth.ts` | `performWebAuthnReauth` — runs a WebAuthn get-credential ceremony, derives a key hash from the PRF output, POSTs to the reauth endpoint, and triggers socket reconnect |
| `jwtAuth.ts` | `performJwtSignIn` — POSTs credentials + device fingerprint to the signin endpoint and triggers socket reconnect |
| `googleSignIn.ts` | `performGoogleSignIn` — orchestrates Google sign-in: tries One Tap → popup → redirect fallback; handles Capacitor in-app browser as a separate flow |
| `googleRequestScopes.ts` | `requestScopes` — checks whether all requested Google OAuth scopes are already granted; triggers the OAuth flow for any that are missing |
| `AuthContext.ts` | React context holding reactive user and account state, `signOut`, and optional PRF callback |
| `AuthenticatedOnly.tsx` | Component that renders `children` when a user is authenticated, otherwise renders `fallback` |
| `AuthenticatedOnly.tests.tsx` | Unit tests for `AuthenticatedOnly` |
| `AuthenticationProvider.tests.tsx` | Unit tests for `AuthenticationProvider` — covers user-state sync from socket connection |
| `useAuthentication.tests.ts` | Unit tests for `useAuthentication` — covers JWT sign-in, WebAuthn registration and re-auth, signOut, and deduplication of concurrent ceremonies |

## Usage

```ts
// auth.ts — define once, export the hook
import { defineAuthentication } from '@anupheaus/socket-api/client/auth';

interface MyCredentials { email: string; password: string; }
interface MyUser { id: string; name: string; }

export const { useAuthentication } = defineAuthentication<MyUser, MyCredentials>();
```

```tsx
// LoginForm.tsx
const { signIn, signOut, user } = useAuthentication();

await signIn({ email, password });
```

The hook exposes: `user`, `isAuthenticated`, `signIn(credentials?)`, `signOut()`, `requestScopes(scopes)`.

`requestScopes` is for Google OAuth mode only — it checks which scopes are already granted and opens the OAuth flow only for missing ones.
