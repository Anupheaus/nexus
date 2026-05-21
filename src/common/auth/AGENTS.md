# common/auth — Shared Auth Type Definitions

Shared authentication interfaces and records used by both the client and server auth modules.

## Files

| File | Purpose |
|------|---------|
| `authTypes.ts` | Defines the base `NexusAuthStore` interface plus JWT, WebAuthn, and Google OAuth store/record specialisations |
| `googleOAuthTypes.ts` | `GoogleOAuthAuthRecord`, `GoogleOAuthAuthStore`, and `GoogleProfile` — Google OAuth-specific store/record interfaces |

## Base interfaces

```ts
interface NexusAuthRecord {
  requestId: string;
  sessionToken: string;
  userId: string;
  deviceId: string;
  isEnabled: boolean;
  deviceDetails?: NexusDeviceDetails;
  lastConnectedAt?: number;
}

interface NexusAuthStore<TRecord> {
  create(record: TRecord): Promise<void>;
  findById(requestId: string): Promise<TRecord | undefined>;
  findBySessionToken(token: string): Promise<TRecord | undefined>;
  findByDevice(userId: string, deviceId: string): Promise<TRecord | undefined>;
  update(requestId: string, patch: Partial<TRecord>): Promise<void>;
}
```

## JWT

`JwtAuthRecord` and `JwtAuthStore` extend the base types directly — no extra fields or methods are required.

## WebAuthn

```ts
interface WebAuthnAuthRecord extends NexusAuthRecord {
  registrationToken?: string; // set by invite route; cleared after registration
  keyHash?: string;           // SHA-256 hex of PRF-derived key; set at registration
}

interface WebAuthnAuthStore extends NexusAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  findByKeyHash(keyHash: string): Promise<WebAuthnAuthRecord | undefined>;
}
```

`keyHash` is the deterministic output of the WebAuthn PRF extension using salt `'Nexus-auth'`. It is the same on every re-authentication from the same device passkey, enabling passwordless re-auth without storing a credential ID.

Pass a `WebAuthnAuthStore` implementation to `defineAuthentication({ mode: 'webauthn', store: ... })` on the server.

## Google OAuth

```ts
interface GoogleOAuthAuthRecord extends NexusAuthRecord {
  // userId IS the Google subject ID (sub) — no separate googleId field needed.
  googleAccessToken: string;
  googleRefreshToken: string;
  googleTokenExpiresAt: number; // unix ms
  grantedScopes: string[];
}

interface GoogleOAuthAuthStore extends NexusAuthStore<GoogleOAuthAuthRecord> {
  findByUserId(userId: string): Promise<GoogleOAuthAuthRecord | undefined>;
}

interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}
```

Pass a `GoogleOAuthAuthStore` implementation to `defineAuthentication({ mode: 'googleOAuth', store: ... })` on the server.
