# client/auth — Client-Side Authentication

Sets up the client auth flow including login, logout, device fingerprinting, and user state.

## Files

| File | Purpose |
|------|---------|
| `defineAuthentication.ts` | Factory that returns `useAuthentication()` hook scoped to your credential and user types |
| `computeDeviceId.ts` | Generates a stable device ID from browser characteristics for device-based security |
| `collectDeviceDetails.ts` | Collects browser/device metadata sent with auth requests |
| `webauthnUtils.ts` | Pure WebAuthn helpers: `computeKeyHash` (SHA-256 hex), `getPrfResult` (normalise PRF output to ArrayBuffer) |

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

The hook exposes: `user`, `signIn(credentials)`, `signOut()`.
