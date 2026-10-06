# common/auth — Shared Auth Type Definitions

Shared authentication interfaces and records used by both the client and server auth modules.

## Files

| File | Purpose |
|------|---------|
| `authTypes.ts` | Defines the base `NexusAuthStore` interface plus JWT, WebAuthn, and Google OAuth store/record specialisations |
| `googleOAuthTypes.ts` | `GoogleOAuthAuthRecord`, `GoogleOAuthAuthStore`, and `GoogleProfile` — Google OAuth-specific store/record interfaces |
| `pendingInvite.ts` | `isPendingWebAuthnInvite(record)`: never registered (not enabled; no key hash, device details or connection). A registered device keeps its invite's `requestId`, so `isEnabled` alone cannot tell (Vision sc-605) |
| `isAuthKey.ts` | `isAuthKey(value)`: a non-empty string and nothing else. Every nexus auth handler checks its keys with it before any store lookup, and stores (mxdb) use it too: keys arrive as parsed JSON, and an object like `{ "$ne": null }` is a MongoDB operator (Vision sc-620) |

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
  keyHash?: string;           // written before sc-627 only; no longer a credential
  credentialId?: string;      // the passkey's credential id (base64url), which sign-ins name
  credentialPublicKey?: string; // COSE public key (base64url) sign-ins are verified against
  credentialCounter?: number; // signature counter at the last sign-in
  lastChallengeIssuedAt?: number; // issue time of the last accepted sign-in challenge (replay guard)
  installationId?: string;    // the app installation this device is (sc-645); a synced passkey has one device per installation
  originNonceHash?: string;   // SHA-256 hex of the controller origin cookie (same-browser email bind)
}

interface WebAuthnAuthStore extends NexusAuthStore<WebAuthnAuthRecord> {
  findByRegistrationToken(token: string): Promise<WebAuthnAuthRecord | undefined>;
  findByCredentialId(credentialId: string): Promise<WebAuthnAuthRecord | undefined>;
  findAllByCredentialId(credentialId: string): Promise<WebAuthnAuthRecord[]>; // every installation's device (sc-645)
  findByKeyHash?(keyHash: string): Promise<WebAuthnAuthRecord | undefined>; // no longer called
}
```

The PRF extension (salt `'nexus-auth'`) still yields a deterministic secret per passkey, but it stays on the device and only derives the local database key. Sign-in is by the passkey's signature, verified against `credentialPublicKey` (sc-627). `webauthnCredentialJson.ts` holds the JSON shapes the client sends for registration and sign-in.

A store should hold a unique index on (`credentialId`, `installationId`): it is what stops two identical sign-ins from
one new installation both registering it (see `server/auth/AGENTS.md` → One device per installation).

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
