# client/auth — Client-Side Authentication

Sets up the client auth flow including login, logout, device fingerprinting, and user state.

## Files

| File | Purpose |
|------|---------|
| `AuthenticationProvider.tsx` | React provider — syncs auth state from the socket connection and makes user available via context |
| `defineAuthentication.ts` | Factory that returns `useAuthentication()` hook scoped to your credential and user types |
| `useAuthentication.ts` | React hook providing current user, `signIn`, `signOut`, and `requestScopes`. Routes to Google OAuth, JWT, or WebAuthn depending on server mode and call context |
| `collectDeviceDetails.ts` | Collects browser/device metadata sent with auth requests |
| `webauthnUtils.ts` | Pure WebAuthn helpers: `computeKeyHash` (SHA-256 hex), `getPrfResult` (normalise PRF output to ArrayBuffer), `getRpId` (the `<Nexus rpId>` the app configured, else the page host) |
| `webauthnRegistration.ts` | `performWebAuthnRegistration` — orchestrates the full passkey registration flow (invite → ceremony → register); exports `InviteCaller` and `RegisterCaller` type aliases |
| `webauthnReauth.ts` | `performWebAuthnReauth` — fetches a signed challenge, runs the WebAuthn get-credential ceremony over it, POSTs the signed response (`toAssertionJson`) to the reauth endpoint, then reconnects; the PRF output stays on the device and derives the local key (sc-627) |
| `jwtAuth.ts` | `performJwtSignIn` — POSTs credentials + device fingerprint to the signin endpoint and triggers socket reconnect |
| `googleSignIn.ts` | `performGoogleSignIn` — orchestrates Google sign-in: tries One Tap → popup → redirect fallback; handles Capacitor in-app browser as a separate flow |
| `googleRequestScopes.ts` | `requestScopes` — checks whether all requested Google OAuth scopes are already granted; triggers the OAuth flow for any that are missing |
| `biometricAuth.ts` | Capacitor-native biometrics — `storeBiometricKey` caches the passkey's PRF output behind biometrics, `performBiometricUnlock` releases it to `onPrf` while the session is valid, `hasBiometricCredential` checks for one. Biometrics never sign in on their own (sc-627). The PRF output is the local database's key, so it lives in OS secure storage (`@aparajita/capacitor-secure-storage`, a required peer on native): Android — AES-GCM with a key generated in the Android Keystore (the key never leaves it; a backup or dump of the app's data holds ciphertext only); iOS — the Keychain, this device only, never iCloud-synced. An entry an earlier version left in plain `@capacitor/preferences` is moved across on first read and deleted (sc-644) |
| `AuthContext.ts` | React context holding reactive user and account state, `signOut`, and optional PRF callback |
| `AuthenticatedOnly.tsx` | Component that renders `children` when a user is authenticated, otherwise renders `fallback` |
| `AuthenticatedOnly.tests.tsx` | Unit tests for `AuthenticatedOnly` |
| `AuthenticationProvider.tests.tsx` | Unit tests for `AuthenticationProvider` — covers user-state sync from socket connection |
| `useAuthentication.tests.ts` | Unit tests for `useAuthentication` — covers JWT sign-in, WebAuthn registration and re-auth, signOut, and deduplication of concurrent ceremonies |
| `biometricAuth.tests.ts` | Unit tests for `performBiometricUnlock`, `storeBiometricKey` and the move out of preferences |
| `collectDeviceDetails.tests.ts` | Unit tests for `collectDeviceDetails` |
| `googleRequestScopes.tests.ts` | Unit tests for `requestScopes` |
| `googleSignIn.tests.ts` | Unit tests for `performGoogleSignIn` — covers One Tap, popup, redirect, and Capacitor flows |
| `jwtAuth.tests.ts` | Unit tests for `performJwtSignIn` |
| `webauthnReauth.tests.ts` | Unit tests for `performWebAuthnReauth` |
| `webauthnRegistration.tests.ts` | Unit tests for `performWebAuthnRegistration` |
| `webauthnUtils.tests.ts` | Unit tests for `computeKeyHash`, `getPrfResult` and `getRpId` |

## Usage

```ts
// auth.ts — define once, export the hook
import { defineAuthentication } from '@anupheaus/nexus/client/auth';

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
