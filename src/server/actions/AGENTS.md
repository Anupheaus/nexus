# server/actions — Action Handlers

Register typed request/response handlers that clients can call via socket or REST.

## Files

| File | Purpose |
|------|---------|
| `createServerActionHandler.ts` | Creates a typed action handler — the main API for registering actions |
| `useAction.ts` | Hook to call other actions from within a handler (server-to-server) |
| `registerRestActions.ts` | Registers Koa REST endpoints for actions passed in from `startServer` — catch-all and explicit routes |
| `internalActions.ts` | Framework-internal handlers (e.g. token authentication handshake) |
| `signinAction.ts` | JWT sign-in handler — validates credentials, creates session record, sets the session cookie via injected `setCookie` |
| `signoutAction.ts` | Sign-out handler — disables the session record and clears the session cookie via injected `removeCookie` |
| `webauthnRegisterAction.ts` | WebAuthn register handler — validates registrationToken, stores keyHash, sets session cookie via injected `setCookie` |
| `webauthnReauthAction.ts` | WebAuthn re-authentication handler — looks up record by keyHash, issues a fresh session cookie via injected `setCookie` |
| `webauthnInviteAction.ts` | WebAuthn invite handler — validates invite record, generates registrationToken, returns inviteDetails |
| `biometricSetupAction.ts` | Biometric setup handler — validates the caller's active session, then stores a new keyHash for Capacitor biometric re-auth; idempotent if the keyHash already exists |
| `googleConfigAction.ts` | Google OAuth config handler — returns `clientId` for the client to initialise the GIS SDK |
| `googleStartAction.ts` | Google OAuth start handler — builds the Google authorization URL with scopes and a signed state param, returns it to the client |
| `googleCallbackAction.ts` | Google OAuth callback handler — exchanges authorization code for tokens, creates/updates auth record, sets session cookie |
| `googleOneTapAction.ts` | Google One Tap handler — verifies the GIS SDK ID token via `tokeninfo`, creates/updates auth record, sets session cookie |
| `googleScopesAction.ts` | Google OAuth scopes check — verifies whether all requested scopes are already granted; refreshes the access token if expired |

## Usage

```ts
import { createServerActionHandler } from '@anupheaus/nexus/server';
import { getUserAction } from '../shared/contracts';

const handleGetUser = createServerActionHandler(getUserAction, async ({ id }) => {
  return await db.users.findById(id);
});

// Pass to startServer:
await startServer({ actions: [handleGetUser], ... });
```

## Options

```ts
createServerActionHandler(action, handler, {
  isPublic: true,  // allow unauthenticated clients (default: false)
});
```

### Concurrency & queuing

Configure on the action definition itself:

```ts
export const slowAction = defineAction<void, Result>()('slowAction', {
  server: {
    concurrent: { max: 3 },          // at most 3 in-flight at once
    queue: { max: 10, timeout: 5000 } // queue up to 10 waiters, timeout after 5s
  }
});
```

### REST fallback

```ts
export const getUserAction = defineAction<{ id: string }, User>()('getUser', {
  rest: { method: 'GET', url: '/users/:id' },
});
```

Actions with a `rest` config are automatically reachable via HTTP in addition to socket.

### Transport restriction

Use `transport` to constrain which transports an action accepts. Enforcement happens at runtime on both socket and REST paths — callers receive an error if they use the wrong transport.

```ts
// REST-only — e.g. cookie-setting auth actions that need Set-Cookie response headers
export const signInAction = defineAction<SignInRequest, void>()('signIn', {
  transport: ['rest'],
});

// Socket-only — e.g. real-time push that cannot be replicated via REST
export const liveAction = defineAction<void, void>()('live', {
  transport: ['socket'],
});
```

Default (no `transport`): action is callable on both transports. Socket is preferred when connected; REST is used as fallback.
