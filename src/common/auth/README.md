# common/auth — Shared Auth Type Definitions

Shared authentication interfaces used by both the client and server auth modules.

## Files

| File | Purpose |
|------|---------|
| `authTypes.ts` | Defines `JwtAuthStore` — the interface a consumer implements to persist and retrieve JWT tokens (e.g. to a database). |

## Key interface

```ts
interface JwtAuthStore {
  saveToken(userId: string, token: string, privateKey: string): Promise<void>;
  loadToken(userId: string): Promise<{ token: string; privateKey: string } | undefined>;
}
```

Implement `JwtAuthStore` and pass it to `defineAuthentication({ mode: 'jwt', store: ... })` on the server.
