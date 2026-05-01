# Auth Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all client-side authentication code into `src/client/auth/` and decompose `useAuthentication.ts` into focused single-responsibility files.

**Architecture:** Everything auth-related currently split across `src/client/hooks/`, `src/client/providers/user/`, and `src/client/auth/` moves into `src/client/auth/`. The large `useAuthentication.ts` is broken into four helper modules (webauthn utilities, webauthn registration flow, webauthn re-auth flow, JWT sign-in flow) plus a lean hook file that only orchestrates them. No behaviour changes — pure restructuring.

**Tech Stack:** TypeScript, React hooks, Vitest, `@anupheaus/react-ui`, `@anupheaus/common`

---

## Target file structure

```
src/client/auth/
  AGENTS.md                          ← update (new files + moved files)
  index.ts                           ← update (export all public symbols)
  defineAuthentication.ts            ← update import path
  collectDeviceDetails.ts            ← unchanged
  collectDeviceDetails.tests.ts      ← unchanged
  computeDeviceId.ts                 ← unchanged
  computeDeviceId.tests.ts           ← unchanged
  webauthnUtils.ts                   ← NEW  (computeKeyHash, getPrfResult)
  jwtAuth.ts                         ← NEW  (performJwtSignIn)
  webauthnRegistration.ts            ← NEW  (performWebAuthnRegistration + caller types)
  webauthnReauth.ts                  ← NEW  (performWebAuthnReauth)
  useAuthentication.ts               ← MOVED from hooks/, now lean (imports from above 4)
  useAuthentication.tests.ts         ← MOVED from hooks/, update mock paths + error strings
  UserContext.ts                     ← MOVED from providers/user/
  useUser.ts                         ← MOVED from providers/user/
  AuthenticationProvider.tsx         ← MOVED from providers/user/
  AuthenticatedOnly.tsx              ← MOVED from providers/user/
  AuthenticatedOnly.tests.tsx        ← MOVED from providers/user/
  AuthenticationProvider.tests.tsx   ← MOVED from providers/user/

src/client/hooks/
  useAuthentication.ts               ← DELETE (moved to auth/)
  useAuthentication.tests.ts         ← DELETE (moved to auth/)

src/client/providers/user/           ← DELETE entire folder (all files moved to auth/)

src/client/providers/index.ts        ← remove `export * from './user'`
src/client/index.ts                  ← update exports to point at auth/
src/client/SocketAPI.tsx             ← update AuthenticationProvider import
src/client/auth/AGENTS.md            ← update
src/client/hooks/AGENTS.md           ← remove useAuthentication entry
src/client/providers/AGENTS.md       ← remove user/ sub-folder entry
```

---

## Task 1: Extract `webauthnUtils.ts`

**Files:**
- Create: `src/client/auth/webauthnUtils.ts`
- Modify: `src/client/hooks/useAuthentication.ts` (remove extracted code, add import)

- [ ] **Step 1: Create the utilities file**

```typescript
// src/client/auth/webauthnUtils.ts

export async function computeKeyHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getPrfResult(credential: PublicKeyCredential): ArrayBuffer | undefined {
  const result = (credential.getClientExtensionResults() as any).prf?.results?.first;
  if (result == null) return undefined;
  if (result instanceof ArrayBuffer) return result;
  if (ArrayBuffer.isView(result)) return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  // Chrome now returns a plain Array of numbers
  if (Array.isArray(result)) return new Uint8Array(result).buffer;
  return undefined;
}
```

- [ ] **Step 2: Remove the two functions from `useAuthentication.ts` and add the import**

At the top of `src/client/hooks/useAuthentication.ts`, add:
```typescript
import { computeKeyHash, getPrfResult } from '../auth/webauthnUtils';
```

Delete the two function bodies (`computeKeyHash` and `getPrfResult`) from `useAuthentication.ts`.

- [ ] **Step 3: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same pass/fail counts as before this task (2 pre-existing failures in SubscriptionProvider, nothing new).

- [ ] **Step 4: Commit**

```bash
git add src/client/auth/webauthnUtils.ts src/client/hooks/useAuthentication.ts
git commit -m "refactor(auth): extract webauthn utilities into auth/webauthnUtils.ts"
```

---

## Task 2: Extract `jwtAuth.ts`

**Files:**
- Create: `src/client/auth/jwtAuth.ts`
- Modify: `src/client/hooks/useAuthentication.ts`

- [ ] **Step 1: Create `jwtAuth.ts`**

```typescript
// src/client/auth/jwtAuth.ts
import { collectDeviceDetails } from './collectDeviceDetails';
import { computeDeviceId } from './computeDeviceId';

export async function performJwtSignIn<C>(name: string, credentials: C, reconnect: () => void): Promise<void> {
  const details = collectDeviceDetails();
  const deviceId = await computeDeviceId(details);
  const res = await fetch(`/${name}/socketAPI/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...(credentials as any), deviceId, deviceDetails: details }),
  });
  if (!res.ok) throw new Error(`Sign in failed: ${res.status}`);
  reconnect();
}
```

- [ ] **Step 2: Remove `performJwtSignIn` from `useAuthentication.ts` and add the import**

At the top of `src/client/hooks/useAuthentication.ts`, add:
```typescript
import { performJwtSignIn } from '../auth/jwtAuth';
```

Delete the `performJwtSignIn` function body from `useAuthentication.ts` (also remove its imports for `collectDeviceDetails` and `computeDeviceId` if they're no longer used there — check before removing).

- [ ] **Step 3: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts as before.

- [ ] **Step 4: Commit**

```bash
git add src/client/auth/jwtAuth.ts src/client/hooks/useAuthentication.ts
git commit -m "refactor(auth): extract performJwtSignIn into auth/jwtAuth.ts"
```

---

## Task 3: Extract `webauthnRegistration.ts`

**Files:**
- Create: `src/client/auth/webauthnRegistration.ts`
- Modify: `src/client/hooks/useAuthentication.ts`

- [ ] **Step 1: Create `webauthnRegistration.ts`**

```typescript
// src/client/auth/webauthnRegistration.ts
import { collectDeviceDetails } from './collectDeviceDetails';
import { computeKeyHash, getPrfResult } from './webauthnUtils';

export type InviteCaller = (req: { requestId: string }) => Promise<{ registrationToken: string; userDetails: { name: string; displayName?: string } }>;
export type RegisterCaller = (req: { registrationToken: string; keyHash: string; deviceDetails: ReturnType<typeof collectDeviceDetails> }) => Promise<{ userId: string }>;

export async function performWebAuthnRegistration(
  callInvite: InviteCaller,
  callRegister: RegisterCaller,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer) => void | Promise<void>) | undefined,
): Promise<void> {
  const requestId = new URLSearchParams(window.location.search).get('requestId');
  if (!requestId) throw new Error('WebAuthn registration requires a ?requestId= query parameter (from invite URL)');

  const { registrationToken, userDetails } = await callInvite({ requestId });

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: new TextEncoder().encode(registrationToken),
      rp: { id: window.location.hostname, name: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userDetails.name),
        name: userDetails.name,
        displayName: userDetails.displayName ?? userDetails.name,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: { userVerification: 'required' },
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('socket-api-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey creation cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const details = collectDeviceDetails();

  const { userId } = await callRegister({ registrationToken, keyHash, deviceDetails: details });

  const url = new URL(window.location.href);
  url.searchParams.delete('requestId');
  window.history.replaceState({}, '', url.toString());

  if (onPrf) onPrf(userId, prfResult);
  reconnect();
}
```

- [ ] **Step 2: Remove from `useAuthentication.ts` and add the import**

Add to imports in `useAuthentication.ts`:
```typescript
import type { InviteCaller, RegisterCaller } from '../auth/webauthnRegistration';
import { performWebAuthnRegistration } from '../auth/webauthnRegistration';
```

Delete `type InviteCaller`, `type RegisterCaller`, and `async function performWebAuthnRegistration(...)` from `useAuthentication.ts`.

- [ ] **Step 3: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts as before.

- [ ] **Step 4: Commit**

```bash
git add src/client/auth/webauthnRegistration.ts src/client/hooks/useAuthentication.ts
git commit -m "refactor(auth): extract performWebAuthnRegistration into auth/webauthnRegistration.ts"
```

---

## Task 4: Extract `webauthnReauth.ts`

**Files:**
- Create: `src/client/auth/webauthnReauth.ts`
- Modify: `src/client/hooks/useAuthentication.ts`

- [ ] **Step 1: Create `webauthnReauth.ts`**

```typescript
// src/client/auth/webauthnReauth.ts
import { collectDeviceDetails } from './collectDeviceDetails';
import { computeKeyHash, getPrfResult } from './webauthnUtils';

export async function performWebAuthnReauth(
  name: string,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer) => void | Promise<void>) | undefined,
): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: new TextEncoder().encode('socket-api-auth') } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey authentication cancelled or failed');

  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');

  const keyHash = await computeKeyHash(prfResult);
  const details = collectDeviceDetails();

  const res = await fetch(`/${name}/socketAPI/webauthn/reauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ keyHash, deviceDetails: details }),
  });
  if (!res.ok) throw new Error(`WebAuthn re-authentication failed: ${res.status}`);
  const { userId } = await res.json() as { userId: string };

  if (onPrf) await onPrf(userId, prfResult);
  reconnect();
}
```

- [ ] **Step 2: Remove from `useAuthentication.ts` and add the import**

Add to imports:
```typescript
import { performWebAuthnReauth } from '../auth/webauthnReauth';
```

Delete `async function performWebAuthnReauth(...)` from `useAuthentication.ts`.

- [ ] **Step 3: Verify `useAuthentication.ts` now only contains the hook**

After Tasks 1–4, `src/client/hooks/useAuthentication.ts` should contain only:
- Imports
- `let activeWebAuthnPromise`
- `export interface ClientUseAuthResult<U, C>`
- `export function useAuthentication<U, C>()`

- [ ] **Step 4: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts as before.

- [ ] **Step 5: Commit**

```bash
git add src/client/auth/webauthnReauth.ts src/client/hooks/useAuthentication.ts
git commit -m "refactor(auth): extract performWebAuthnReauth into auth/webauthnReauth.ts"
```

---

## Task 5: Move `useAuthentication.ts` from `hooks/` to `auth/`

**Files:**
- Create: `src/client/auth/useAuthentication.ts` (copy of leaned-down hooks version)
- Delete: `src/client/hooks/useAuthentication.ts`
- Modify: `src/client/auth/defineAuthentication.ts`
- Modify: `src/client/index.ts`

- [ ] **Step 1: Create `src/client/auth/useAuthentication.ts`**

This is the hook file from `hooks/useAuthentication.ts` with relative imports updated.
**Important:** `UserContext` hasn't been moved to `auth/` yet (that's Task 6), so use the old path
temporarily. Task 6 will update this import.

```typescript
// src/client/auth/useAuthentication.ts
import { useReducer, useRef, useContext, useCallback, useEffect } from 'react';
import { useDistributedState } from '@anupheaus/react-ui';
import type { SocketAPIUser } from '../../common';
import { webauthnInviteAction, webauthnRegisterAction } from '../../common/internalActions';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { UserContext } from '../providers/user/UserContext';  // updated to ./UserContext in Task 6
import { useAction } from '../hooks/useAction';
import { performWebAuthnRegistration } from './webauthnRegistration';
import { performWebAuthnReauth } from './webauthnReauth';
import { performJwtSignIn } from './jwtAuth';

// Module-level: deduplicate concurrent WebAuthn signIn calls across hook instances.
// DeviceAuthGate fires its effect before the socket delivers the user, then MXDBSyncInner
// fires once the user arrives — both call signIn() within milliseconds. Only one WebAuthn
// ceremony must run; the second call joins the in-flight promise instead of starting a new one.
let activeWebAuthnPromise: Promise<void> | undefined;

export interface ClientUseAuthResult<U, C> {
  readonly user: U | undefined;
  signIn(credentials: C): Promise<void>;
  signOut(): Promise<void>;
}

export function useAuthentication<U extends SocketAPIUser = SocketAPIUser, C = void>(): ClientUseAuthResult<U, C> {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const { name, reconnect, on, off } = useContext(SocketContext);
  const { onPrf, userState } = useContext(UserContext);
  // Initialize from current state so we don't miss events fired before this hook instance
  // mounted (e.g. DeviceAuthGate remounting after MXDBSyncInner sets the encryption key).
  const { get: getCurrentUser } = useDistributedState<U | undefined>(userState);
  const userRef = useRef<U | undefined>(getCurrentUser());
  const isUserAccessedRef = useRef(false);

  const hookId = useRef(`useAuthentication-${Math.random()}`).current;
  const eventName = `${eventPrefix}.${socketAPIUserChanged.name}`;
  on(hookId, eventName, (payload: { user: U | undefined }) => {
    userRef.current = payload.user;
    if (isUserAccessedRef.current) forceUpdate();
  });

  useEffect(() => {
    return () => off(hookId, eventName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the latest action callers in a ref so the signIn callback doesn't need them in its
  // dependency array (they are recreated every render by useAction, but are always current).
  const { webauthnInvite } = useAction(webauthnInviteAction);
  const { webauthnRegister } = useAction(webauthnRegisterAction);
  const webauthnActionsRef = useRef({ invite: webauthnInvite, register: webauthnRegister });
  webauthnActionsRef.current = { invite: webauthnInvite, register: webauthnRegister };

  const signIn = useCallback(async (credentials?: C) => {
    if (credentials == null) {
      // Deduplicate: if a WebAuthn ceremony is already in flight (e.g. DeviceAuthGate started
      // one before the socket delivered the user, then MXDBSyncInner also fires), join the
      // existing promise instead of launching a second ceremony.
      if (activeWebAuthnPromise != null) return activeWebAuthnPromise;

      const hasInvite = new URLSearchParams(window.location.search).has('requestId');
      // Evaluate lazily at call time (after ceremony + onPrf): by then the socket has had seconds
      // to deliver the user from the existing session cookie, so we can skip reconnect if it did.
      // Reconnect is only needed on first sign-in when no session cookie exists yet.
      const maybeReconnect = () => { if (userRef.current == null) reconnect(); };
      const promise = hasInvite
        ? performWebAuthnRegistration(webauthnActionsRef.current.invite, webauthnActionsRef.current.register, maybeReconnect, onPrf)
        : performWebAuthnReauth(name, maybeReconnect, onPrf);
      activeWebAuthnPromise = promise;
      // Clear on both resolve and reject without creating an unhandled rejection.
      // promise.finally(cb) mirrors the original rejection on its own returned promise,
      // which would be unhandled if we don't consume it. Using then(cb, cb) resolves instead.
      promise.then(() => { activeWebAuthnPromise = undefined; }, () => { activeWebAuthnPromise = undefined; });
      await promise;
    } else {
      await performJwtSignIn(name, credentials, reconnect);
    }
  }, [name, reconnect, onPrf]) as (credentials: C) => Promise<void>;

  const signOut = useCallback(async () => {
    await fetch(`/${name}/socketAPI/signout`, { method: 'POST', credentials: 'include' });
    userRef.current = undefined;
    if (isUserAccessedRef.current) forceUpdate();
    reconnect();
  }, [name, reconnect]);

  return {
    get user(): U | undefined {
      isUserAccessedRef.current = true;
      return userRef.current;
    },
    signIn,
    signOut,
  };
}
```

Note the import changes from the `hooks/` version:
- `import { UserContext } from './UserContext'` (was `'../providers/user/UserContext'`)
- `import { useAction } from '../hooks/useAction'` (was `'./useAction'`)
- `import { performWebAuthnRegistration } from './webauthnRegistration'` (was `'../auth/webauthnRegistration'`)
- `import { performWebAuthnReauth } from './webauthnReauth'` (was `'../auth/webauthnReauth'`)
- `import { performJwtSignIn } from './jwtAuth'` (was `'../auth/jwtAuth'`)

- [ ] **Step 2: Delete `src/client/hooks/useAuthentication.ts`**

```bash
rm src/client/hooks/useAuthentication.ts
```

- [ ] **Step 3: Update `src/client/auth/defineAuthentication.ts`**

Change the import:
```typescript
// src/client/auth/defineAuthentication.ts
import type { SocketAPIUser } from '../../common';
import { useAuthentication } from './useAuthentication';
import type { ClientUseAuthResult } from './useAuthentication';

export function defineAuthentication<U extends SocketAPIUser, C = void>() {
  return {
    configureAuthentication: null as never,
    useAuthentication(): ClientUseAuthResult<U, C> {
      return useAuthentication<U, C>();
    },
  };
}
```

- [ ] **Step 4: Update `src/client/index.ts`**

Replace the two auth-hook exports:
```typescript
// was:
export { useAuthentication } from './hooks/useAuthentication';
export type { ClientUseAuthResult } from './hooks/useAuthentication';
// becomes:
export { useAuthentication } from './auth/useAuthentication';
export type { ClientUseAuthResult } from './auth/useAuthentication';
```

- [ ] **Step 5: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts as before (the test file still lives at `hooks/useAuthentication.tests.ts` so it resolves fine until we move it in Task 10).

- [ ] **Step 6: Commit**

```bash
git add src/client/auth/useAuthentication.ts src/client/auth/defineAuthentication.ts src/client/index.ts
git rm src/client/hooks/useAuthentication.ts
git commit -m "refactor(auth): move useAuthentication hook to auth/ folder"
```

---

## Task 6: Move `UserContext.ts` to `auth/`

**Files:**
- Create: `src/client/auth/UserContext.ts`
- Delete: `src/client/providers/user/UserContext.ts`
- Modify: `src/client/providers/user/AuthenticationProvider.tsx` (still in providers/user, will be moved in Task 8)
- Modify: `src/client/providers/user/useUser.ts` (still in providers/user, will be moved in Task 7)
- Modify: `src/client/providers/user/AuthenticatedOnly.tsx` (still in providers/user, will be moved in Task 9)

- [ ] **Step 1: Create `src/client/auth/UserContext.ts`**

```typescript
// src/client/auth/UserContext.ts
import { createContext } from 'react';
import type { SocketAPIUser } from '../../common';
import type { DistributedState } from '@anupheaus/react-ui';

export interface UserContextType {
  isValid: boolean;
  userState: DistributedState<SocketAPIUser | undefined>;
  signOut(): Promise<void>;
  onPrf?: (userId: string, prfOutput: ArrayBuffer) => void | Promise<void>;
}

export const UserContext = createContext<UserContextType>({
  isValid: false,
  userState: undefined as unknown as DistributedState<SocketAPIUser | undefined>,
  signOut: () => Promise.resolve(),
});
```

- [ ] **Step 2: Update `src/client/auth/useAuthentication.ts` to use the new location**

Change the temporary import (added in Task 5):
```typescript
// was (temporary):
import { UserContext } from '../providers/user/UserContext';
// becomes:
import { UserContext } from './UserContext';
```

- [ ] **Step 3: Update `src/client/providers/user/AuthenticationProvider.tsx` to import from new location**

Change:
```typescript
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';
```
To:
```typescript
import type { UserContextType } from '../../auth/UserContext';
import { UserContext } from '../../auth/UserContext';
```

- [ ] **Step 4: Update `src/client/providers/user/useUser.ts`**

Change:
```typescript
import { UserContext } from './UserContext';
```
To:
```typescript
import { UserContext } from '../../auth/UserContext';
```

- [ ] **Step 5: Update `src/client/providers/user/AuthenticatedOnly.tsx`**

No direct UserContext import in this file (uses `useUser` which imports it). No change needed here.

- [ ] **Step 6: Delete `src/client/providers/user/UserContext.ts`**

```bash
rm src/client/providers/user/UserContext.ts
```

- [ ] **Step 7: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts.

- [ ] **Step 8: Commit**

```bash
git add src/client/auth/UserContext.ts src/client/auth/useAuthentication.ts src/client/providers/user/AuthenticationProvider.tsx src/client/providers/user/useUser.ts
git rm src/client/providers/user/UserContext.ts
git commit -m "refactor(auth): move UserContext to auth/ folder"
```

---

## Task 7: Move `useUser.ts` and `AuthenticatedOnly.tsx` to `auth/`

**Files:**
- Create: `src/client/auth/useUser.ts`
- Create: `src/client/auth/AuthenticatedOnly.tsx`
- Delete: `src/client/providers/user/useUser.ts`
- Delete: `src/client/providers/user/AuthenticatedOnly.tsx`
- Modify: `src/client/providers/user/index.ts`
- Modify: `src/client/index.ts`

- [ ] **Step 1: Create `src/client/auth/useUser.ts`**

```typescript
// src/client/auth/useUser.ts
import { useContext } from 'react';
import { UserContext } from './UserContext';
import type { SocketAPIUser } from '../../common';
import { useDistributedState } from '@anupheaus/react-ui';

export function useUser<UserType extends SocketAPIUser>() {
  const { isValid, userState, signOut } = useContext(UserContext);
  const { getAndObserve, get: getUser } = useDistributedState<UserType | undefined>(userState);

  if (!isValid) throw new Error('useUser cannot be used at this location as the context is not available.');
  return {
    get user() { return getAndObserve(); },
    getUser,
    signOut,
  };
}
```

- [ ] **Step 2: Create `src/client/auth/AuthenticatedOnly.tsx`**

```typescript
// src/client/auth/AuthenticatedOnly.tsx
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useUser } from './useUser';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export const AuthenticatedOnly = createComponent('AuthenticatedOnly', ({ children, fallback = null }: Props) => {
  const { user } = useUser();
  return user ? <>{children}</> : <>{fallback}</>;
});
```

- [ ] **Step 3: Delete old files**

```bash
rm src/client/providers/user/useUser.ts
rm src/client/providers/user/AuthenticatedOnly.tsx
```

- [ ] **Step 4: Update `src/client/providers/user/index.ts`**

```typescript
// src/client/providers/user/index.ts
// Re-export from auth/ so that internal references to providers/user continue to resolve
// during the migration (these will be removed when the whole folder is cleaned up in Task 9).
export { useUser } from '../../auth/useUser';
export { AuthenticatedOnly } from '../../auth/AuthenticatedOnly';
```

- [ ] **Step 5: Update `src/client/index.ts`**

Change:
```typescript
export { useUser, useSocket as useSocketAPI } from './providers';
export { AuthenticatedOnly } from './providers/user/AuthenticatedOnly';
```
To:
```typescript
export { useSocket as useSocketAPI } from './providers';
export { useUser, AuthenticatedOnly } from './auth';
```

(The `auth/index.ts` will export these after Task 8.)

- [ ] **Step 6: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts.

- [ ] **Step 7: Commit**

```bash
git add src/client/auth/useUser.ts src/client/auth/AuthenticatedOnly.tsx src/client/providers/user/index.ts src/client/index.ts
git rm src/client/providers/user/useUser.ts src/client/providers/user/AuthenticatedOnly.tsx
git commit -m "refactor(auth): move useUser and AuthenticatedOnly to auth/ folder"
```

---

## Task 8: Move `AuthenticationProvider.tsx` to `auth/`

**Files:**
- Create: `src/client/auth/AuthenticationProvider.tsx`
- Delete: `src/client/providers/user/AuthenticationProvider.tsx`
- Modify: `src/client/SocketAPI.tsx`

- [ ] **Step 1: Create `src/client/auth/AuthenticationProvider.tsx`**

```typescript
// src/client/auth/AuthenticationProvider.tsx
import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useEffect, useRef, useContext, type ReactNode } from 'react';
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';
import type { SocketAPIUser } from '../../common';
import { socketAPIUserChanged, socketAPIDeviceDisabled } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';

interface Props {
  onDeviceDisabled?: () => void;
  onSignedIn?: (user: SocketAPIUser) => void;
  onSignedOut?: () => void;
  onPrf?: (userId: string, prfOutput: ArrayBuffer) => void | Promise<void>;
  children: ReactNode;
}

const userChangedEventName = `${eventPrefix}.${socketAPIUserChanged.name}`;
const deviceDisabledEventName = `${eventPrefix}.${socketAPIDeviceDisabled.name}`;

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({
  children,
  onDeviceDisabled,
  onSignedIn,
  onSignedOut,
  onPrf,
}: Props) => {
  const { on, off, name, reconnect } = useContext(SocketContext);
  const { state: userState, set: setUser } = useDistributedState<SocketAPIUser | undefined>(() => undefined);
  const hookId = useRef('AuthenticationProvider').current;
  const previousUserRef = useRef<SocketAPIUser | undefined>(undefined);

  on(hookId, userChangedEventName, (payload: { user?: SocketAPIUser }) => {
    const prev = previousUserRef.current;
    previousUserRef.current = payload.user;
    setUser(payload.user);
    if (payload.user != null && prev == null) onSignedIn?.(payload.user);
    if (payload.user == null && prev != null) onSignedOut?.();
  });

  on(hookId, deviceDisabledEventName, () => {
    onDeviceDisabled?.();
  });

  useEffect(() => {
    return () => {
      off(hookId, userChangedEventName);
      off(hookId, deviceDisabledEventName);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useBound(async () => {
    await fetch(`/${name}/socketAPI/signout`, { method: 'POST', credentials: 'include' });
    setUser(undefined);
    reconnect();
  });

  const context = useMemo<UserContextType>(() => ({
    isValid: true,
    userState,
    signOut,
    onPrf,
  }), [onPrf]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <UserContext.Provider value={context}>
      {children}
    </UserContext.Provider>
  );
});
```

Note: the only import that changes from the original is `UserContext` (now `'./UserContext'` instead of `'./UserContext'` — same relative reference, already updated in Task 6 to point to `../../auth/UserContext`; now that this file lives in `auth/` it becomes `'./UserContext'`).

- [ ] **Step 2: Delete old file**

```bash
rm src/client/providers/user/AuthenticationProvider.tsx
```

- [ ] **Step 3: Update `src/client/SocketAPI.tsx`**

Change:
```typescript
import { AuthenticationProvider } from './providers/user/AuthenticationProvider';
```
To:
```typescript
import { AuthenticationProvider } from './auth/AuthenticationProvider';
```

- [ ] **Step 4: Remove the now-empty `providers/user/` folder**

After this step `providers/user/` only contains `index.ts`. Leave the cleanup of that for Task 9.

- [ ] **Step 5: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts.

- [ ] **Step 6: Commit**

```bash
git add src/client/auth/AuthenticationProvider.tsx src/client/SocketAPI.tsx
git rm src/client/providers/user/AuthenticationProvider.tsx
git commit -m "refactor(auth): move AuthenticationProvider to auth/ folder"
```

---

## Task 9: Remove `providers/user/` folder

The `providers/user/` folder now only contains `index.ts` (a re-export shim from Task 7) plus test files that will be moved. No source files remain.

**Files:**
- Delete: `src/client/providers/user/index.ts`
- Modify: `src/client/providers/index.ts`

- [ ] **Step 1: Delete `src/client/providers/user/index.ts`**

```bash
rm src/client/providers/user/index.ts
rmdir src/client/providers/user
```

- [ ] **Step 2: Update `src/client/providers/index.ts`**

Remove the `user` export:

```typescript
// src/client/providers/index.ts
export * from './socket';
export * from './subscription';
```

- [ ] **Step 3: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts.

- [ ] **Step 4: Commit**

```bash
git add src/client/providers/index.ts
git rm src/client/providers/user/index.ts
git commit -m "refactor(auth): remove empty providers/user/ folder"
```

---

## Task 10: Update `src/client/auth/index.ts`

**Files:**
- Modify: `src/client/auth/index.ts`

- [ ] **Step 1: Update the barrel to export all public auth symbols**

```typescript
// src/client/auth/index.ts
export { collectDeviceDetails } from './collectDeviceDetails';
export { computeDeviceId } from './computeDeviceId';
export { defineAuthentication } from './defineAuthentication';
export { useAuthentication } from './useAuthentication';
export type { ClientUseAuthResult } from './useAuthentication';
export { useUser } from './useUser';
export { AuthenticatedOnly } from './AuthenticatedOnly';
export { AuthenticationProvider } from './AuthenticationProvider';
export { UserContext } from './UserContext';
export type { UserContextType } from './UserContext';
```

- [ ] **Step 2: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts.

- [ ] **Step 3: Commit**

```bash
git add src/client/auth/index.ts
git commit -m "refactor(auth): update auth/index.ts barrel to export all consolidated auth symbols"
```

---

## Task 11: Move and update test files

**Files:**
- Move+update: `src/client/hooks/useAuthentication.tests.ts` → `src/client/auth/useAuthentication.tests.ts`
- Move+update: `src/client/providers/user/AuthenticatedOnly.tests.tsx` → `src/client/auth/AuthenticatedOnly.tests.tsx`
- Move+update: `src/client/providers/user/AuthenticationProvider.tests.tsx` → `src/client/auth/AuthenticationProvider.tests.tsx`

### 11a — `useAuthentication.tests.ts`

- [ ] **Step 1: Create `src/client/auth/useAuthentication.tests.ts`**

Copy from `src/client/hooks/useAuthentication.tests.ts` and apply these changes:

1. Change the hook import:
   ```typescript
   // was:
   import { useAuthentication } from './useAuthentication';
   // becomes:
   import { useAuthentication } from './useAuthentication';
   // (same — the test is now a sibling of the hook)
   ```

2. Change the SocketContext mock path (hook is now two levels deeper relative to providers):
   ```typescript
   // was:
   vi.mock('../providers/socket/SocketContext', ...);
   // becomes:
   vi.mock('../providers/socket/SocketContext', ...);
   // (same — auth/ is at same depth as hooks/ relative to providers/)
   ```

3. Change the collectDeviceDetails and computeDeviceId mock paths:
   ```typescript
   // was:
   vi.mock('../auth/collectDeviceDetails', ...);
   vi.mock('../auth/computeDeviceId', ...);
   // becomes:
   vi.mock('./collectDeviceDetails', ...);
   vi.mock('./computeDeviceId', ...);
   ```

4. The invite/register branch tests currently check that `mockFetch` was called with
   `'/socketAPI/webauthn/invite?requestId=...'` and `'/socketAPI/webauthn/register'`. Since the
   previous session converted those to actions that call `callRest`, which in turn still calls
   `fetch` with the same URLs, these assertions remain valid — but the error-response mocks need
   a `json` method (because `callRest` calls `res.json()` before checking `res.ok`).

   Update the "throws when the invite fetch fails" test:
   ```typescript
   it('throws when the invite fetch fails', async () => {
     mockFetch.mockResolvedValueOnce({
       ok: false,
       status: 404,
       json: () => Promise.resolve({}),
     });
     const { result } = renderHook(() => useAuthentication());
     await expect(
       act(async () => { await (result.current.signIn as any)(); }),
     ).rejects.toThrow('REST action failed: 404');
   });
   ```

   The error message changes from `'Invite fetch failed: 404'` to `'REST action failed: 404'` because
   `callRest` in `useAction.ts` throws that generic message when `!res.ok`.

The rest of the test file is identical. Write the full file with these three targeted changes applied.

- [ ] **Step 2: Delete the old test file**

```bash
rm src/client/hooks/useAuthentication.tests.ts
```

### 11b — `AuthenticatedOnly.tests.tsx`

The `vi.mock('./useUser', ...)` path is still correct after moving (both files are now siblings in
`auth/`). No changes to the test logic — create an identical copy.

- [ ] **Step 1: Create `src/client/auth/AuthenticatedOnly.tests.tsx`**

```typescript
// src/client/auth/AuthenticatedOnly.tests.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const { mockUseUser } = vi.hoisted(() => {
  return {
    mockUseUser: vi.fn(),
  };
});

vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
  };
});

vi.mock('./useUser', () => ({ useUser: mockUseUser }));

import { AuthenticatedOnly } from './AuthenticatedOnly';

describe('AuthenticatedOnly', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders children when user is authenticated', () => {
    mockUseUser.mockReturnValue({ user: { id: '1', name: 'Alice' }, getUser: vi.fn(), signOut: vi.fn() });
    render(<AuthenticatedOnly><span>protected content</span></AuthenticatedOnly>);
    expect(screen.queryByText('protected content')).not.toBeNull();
  });

  it('renders null when user is unauthenticated and no fallback provided', () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    const { container } = render(<AuthenticatedOnly><span>protected content</span></AuthenticatedOnly>);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('renders fallback when user is unauthenticated', () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('please sign in')).not.toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('switches from fallback to children when user becomes authenticated', () => {
    mockUseUser.mockReturnValue({ user: undefined, getUser: vi.fn(), signOut: vi.fn() });
    const { rerender } = render(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    mockUseUser.mockReturnValue({ user: { id: '1', name: 'Alice' }, getUser: vi.fn(), signOut: vi.fn() });
    rerender(
      <AuthenticatedOnly fallback={<span>please sign in</span>}>
        <span>protected content</span>
      </AuthenticatedOnly>
    );
    expect(screen.queryByText('protected content')).not.toBeNull();
    expect(screen.queryByText('please sign in')).toBeNull();
  });
});
```

- [ ] **Step 2: Delete `src/client/providers/user/AuthenticatedOnly.tests.tsx`**

```bash
rm src/client/providers/user/AuthenticatedOnly.tests.tsx
```

### 11c — `AuthenticationProvider.tests.tsx`

The only change: `import type { SocketAPIUser } from '../../../common'` becomes
`import type { SocketAPIUser } from '../../common'` (`auth/` is one level shallower than
`providers/user/`).

- [ ] **Step 1: Create `src/client/auth/AuthenticationProvider.tests.tsx`**

```typescript
// src/client/auth/AuthenticationProvider.tests.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { SocketAPIUser } from '../../common';   // was '../../../common'

const { mockOn, mockOff, mockReconnect, mockSetUser } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockOff: vi.fn(),
  mockReconnect: vi.fn(),
  mockSetUser: vi.fn(),
}));

vi.mock('@anupheaus/react-ui', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    createComponent: (_name: string, fn: unknown) => fn,
    useBound: (fn: unknown) => fn,
    useDistributedState: () => ({ state: {} as any, set: mockSetUser }),
  };
});

vi.mock('react', async importOriginal => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    useContext: () => ({ on: mockOn, off: mockOff, name: 'test', reconnect: mockReconnect }),
  };
});

import { AuthenticationProvider } from './AuthenticationProvider';

function getHandler(eventName: string): (...args: any[]) => void {
  const call = mockOn.mock.calls.find(([, name]) => name === eventName);
  if (!call) throw new Error(`No handler registered for ${eventName}`);
  return call[2];
}

describe('AuthenticationProvider', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('calls onDeviceDisabled when socketAPIDeviceDisabled event fires', () => {
    const onDeviceDisabled = vi.fn();
    render(<AuthenticationProvider onDeviceDisabled={onDeviceDisabled}><span /></AuthenticationProvider>);
    act(() => getHandler('socket-api.events.socketAPIDeviceDisabled')());
    expect(onDeviceDisabled).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onDeviceDisabled is not provided', () => {
    render(<AuthenticationProvider><span /></AuthenticationProvider>);
    expect(() => act(() => getHandler('socket-api.events.socketAPIDeviceDisabled')())).not.toThrow();
  });

  it('calls onSignedIn(user) when user transitions undefined → defined', () => {
    const onSignedIn = vi.fn();
    render(<AuthenticationProvider onSignedIn={onSignedIn}><span /></AuthenticationProvider>);
    const user: SocketAPIUser = { id: 'u1' };
    act(() => getHandler('socket-api.events.socketAPIUserChanged')({ user }));
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(onSignedIn).toHaveBeenCalledWith(user);
  });

  it('does not re-fire onSignedIn on user update (already signed in)', () => {
    const onSignedIn = vi.fn();
    render(<AuthenticationProvider onSignedIn={onSignedIn}><span /></AuthenticationProvider>);
    const handler = getHandler('socket-api.events.socketAPIUserChanged');
    act(() => handler({ user: { id: 'u1' } }));
    act(() => handler({ user: { id: 'u1-updated' } }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('calls onSignedOut when user transitions defined → undefined', () => {
    const onSignedOut = vi.fn();
    render(<AuthenticationProvider onSignedOut={onSignedOut}><span /></AuthenticationProvider>);
    const handler = getHandler('socket-api.events.socketAPIUserChanged');
    act(() => handler({ user: { id: 'u1' } }));
    act(() => handler({ user: undefined }));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('does not call onSignedOut when there was no prior user', () => {
    const onSignedOut = vi.fn();
    render(<AuthenticationProvider onSignedOut={onSignedOut}><span /></AuthenticationProvider>);
    act(() => getHandler('socket-api.events.socketAPIUserChanged')({ user: undefined }));
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Delete `src/client/providers/user/AuthenticationProvider.tests.tsx`**

```bash
rm src/client/providers/user/AuthenticationProvider.tests.tsx
```

- [ ] **Step 5: Run tests**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | grep -E "(PASS|FAIL|Tests)"
```

Expected: same counts as before (the moved tests should resolve with the updated imports).

- [ ] **Step 6: Commit**

```bash
git add src/client/auth/useAuthentication.tests.ts src/client/auth/AuthenticatedOnly.tests.tsx src/client/auth/AuthenticationProvider.tests.tsx
git rm src/client/hooks/useAuthentication.tests.ts src/client/providers/user/AuthenticatedOnly.tests.tsx src/client/providers/user/AuthenticationProvider.tests.tsx
git commit -m "refactor(auth): move auth test files to auth/ folder and update mock paths"
```

---

## Task 12: Update AGENTS.md files

**Files:**
- Modify: `src/client/auth/AGENTS.md`
- Modify: `src/client/hooks/AGENTS.md`
- Modify: `src/client/providers/AGENTS.md`
- Modify: `src/client/AGENTS.md`

- [ ] **Step 1: Update `src/client/auth/AGENTS.md`**

```markdown
# client/auth — Client-Side Authentication

All authentication logic, context, hooks, and components for the client.

## Files

| File | Purpose |
|------|---------|
| `defineAuthentication.ts` | Factory that returns `useAuthentication()` hook typed to your user/credentials |
| `useAuthentication.ts` | Hook providing reactive `user`, `signIn`, and `signOut` |
| `AuthenticationProvider.tsx` | React provider — syncs auth state from the socket and exposes `UserContext` |
| `UserContext.ts` | React context holding user state and `signOut`/`onPrf` callbacks |
| `useUser.ts` | Hook to access the current user; throws if not inside `AuthenticationProvider` |
| `AuthenticatedOnly.tsx` | Renders children only when authenticated; shows `fallback` otherwise |
| `webauthnUtils.ts` | Shared WebAuthn helpers: `computeKeyHash`, `getPrfResult` |
| `webauthnRegistration.ts` | Full WebAuthn registration ceremony (invite → passkey → register) |
| `webauthnReauth.ts` | WebAuthn re-authentication (PRF key derivation for existing devices) |
| `jwtAuth.ts` | JWT sign-in via username/password credentials |
| `collectDeviceDetails.ts` | Collects browser/device metadata sent with auth requests |
| `computeDeviceId.ts` | Generates a stable device ID from browser characteristics |

## Usage

```ts
// auth.ts — define once, export the typed hook
import { defineAuthentication } from '@anupheaus/socket-api/client';

export const { useAuthentication } = defineAuthentication<MyUser, MyCredentials>();
```

```tsx
// Protect a route:
import { AuthenticatedOnly } from '@anupheaus/socket-api/client';

<AuthenticatedOnly fallback={<LoginPage />}>
  <Dashboard />
</AuthenticatedOnly>
```

```tsx
// Access current user:
import { useUser } from '@anupheaus/socket-api/client';

const { user } = useUser();
```
```

- [ ] **Step 2: Update `src/client/hooks/AGENTS.md`**

Remove the `useAuthentication.ts` row from the file table and update the description (it is now in `auth/`):

```markdown
# client/hooks — React Hooks

Hooks for invoking actions, listening to events, and managing subscriptions. All hooks require a `SocketProvider` ancestor.

## Files

| File | Purpose |
|------|---------|
| `useAction.ts` | Call server actions and track loading/error state |
| `useEvent.ts` | Listen for server-emitted events with auto-cleanup |
| `useSubscription.ts` | Subscribe to live server data streams |
| `useServerActionHandler.ts` | Register a handler for server-initiated actions (advanced use) |
```

(Remove the `useAuthentication.ts` row; it lives in `auth/` now.)

- [ ] **Step 3: Update `src/client/providers/AGENTS.md`**

Remove the `user/` sub-folder row:

```markdown
# client/providers — React Context Providers

React providers that establish the socket connection and share state across the component tree.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [socket/](socket/AGENTS.md) | `SocketProvider` — establishes and manages the WebSocket connection |
| [subscription/](subscription/AGENTS.md) | Routes incoming subscription updates to the correct hook instances |
```

- [ ] **Step 4: Update `src/client/AGENTS.md`**

Update the sub-folders table to reflect that `auth/` now contains hooks, components, and utilities:

```markdown
| [auth/](auth/AGENTS.md) | Authentication hooks, providers, components, and utilities |
```

- [ ] **Step 5: Run tests one final time**

```bash
cd c:/code/personal/socket-api && pnpm test 2>&1 | tail -10
```

Expected: same pass/fail counts (only the pre-existing 2 SubscriptionProvider failures).

- [ ] **Step 6: Commit**

```bash
git add src/client/auth/AGENTS.md src/client/hooks/AGENTS.md src/client/providers/AGENTS.md src/client/AGENTS.md
git commit -m "docs(agents): update AGENTS.md files to reflect auth/ consolidation"
```
