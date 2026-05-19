# Auth Lifecycle Callbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four lifecycle callbacks to `Nexus`: `onDeviceDisabled`, `onSignedIn`, `onSignedOut`, and `onPrf(userId, prfOutput)`.

**Architecture:**
- `onDeviceDisabled` — server emits a new `socketAPIDeviceDisabled` event before disconnecting a disabled device; `AuthenticationProvider` listens and calls the prop.
- `onSignedIn` / `onSignedOut` — `AuthenticationProvider` tracks user state transitions from the existing `socketAPIUserChanged` handler and fires these on `undefined→user` and `user→undefined` respectively.
- `onPrf` — both WebAuthn routes are updated to return `userId` in their response; `onPrf` is stored in `UserContext` so `useAuthentication` can call `onPrf(userId, prfOutput)` after each WebAuthn ceremony; `Nexus` → `AuthenticationProvider` → `UserContext` is the prop chain.

**Tech Stack:** TypeScript, Socket.IO, React (via `@anupheaus/react-ui` `createComponent`), Vitest, Koa

---

## File Map

| File | Change |
|------|--------|
| `src/common/internalEvents.ts` | Add `socketAPIDeviceDisabled` event |
| `src/server/auth/validateSessionCookie.ts` | Split `!record \|\| !record.isEnabled` check; emit event only for disabled-device path |
| `src/server/auth/validateSessionCookie.tests.ts` | Add test asserting event emitted for disabled device; assert NOT emitted for other failure paths |
| `src/server/auth/routes/webauthnRegisterRoute.ts` | Add `userId: record.userId` to 200 response body |
| `src/server/auth/routes/webauthnReauthRoute.ts` | Add `userId: record.userId` to 200 response body |
| `src/client/providers/user/UserContext.ts` | Add `onPrf?: (userId: string, prfOutput: ArrayBuffer) => void` to `UserContextType` |
| `src/client/providers/user/AuthenticationProvider.tsx` | Add `onDeviceDisabled`, `onSignedIn`, `onSignedOut`, `onPrf` props; listen for device-disabled event; track user transitions; store `onPrf` in context |
| `src/client/providers/user/AuthenticationProvider.tests.tsx` | New unit tests for all four callback props |
| `src/client/hooks/useAuthentication.ts` | Read `onPrf` from `UserContext`; call after each WebAuthn ceremony with `userId` from route response + `prfOutput` from ceremony |
| `src/client/Nexus.tsx` | Add all four props; pass to `AuthenticationProvider` |

---

### Task 1: Add `socketAPIDeviceDisabled` internal event

**Files:**
- Modify: `src/common/internalEvents.ts`

**Current content of `src/common/internalEvents.ts`:**
```ts
import { defineEvent } from './defineEvent';

export interface NexusUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export interface NexusUserChangedEventPayload {
  user?: unknown;
}

export const socketAPIUserAuthenticated = defineEvent<NexusUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
export const socketAPIUserChanged = defineEvent<NexusUserChangedEventPayload>('socketAPIUserChanged');
```

- [ ] **Step 1: Add the event**

```ts
// src/common/internalEvents.ts
import { defineEvent } from './defineEvent';

export interface NexusUserAuthenticatedEventPayload {
  token: string;
  publicKey: string;
}

export interface NexusUserChangedEventPayload {
  user?: unknown;
}

export const socketAPIUserAuthenticated = defineEvent<NexusUserAuthenticatedEventPayload>('socketAPIUserAuthenticated');
export const socketAPIUserSignOut = defineEvent<void>('socketAPIUserSignOut');
export const socketAPIUserChanged = defineEvent<NexusUserChangedEventPayload>('socketAPIUserChanged');
export const socketAPIDeviceDisabled = defineEvent<void>('socketAPIDeviceDisabled');
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm -C C:/code/personal/socket-api tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git -C C:/code/personal/socket-api add src/common/internalEvents.ts
git -C C:/code/personal/socket-api commit -m "feat(events): add socketAPIDeviceDisabled internal event"
```

---

### Task 2: Server — emit event for disabled device; add userId to WebAuthn route responses

**Files:**
- Modify: `src/server/auth/validateSessionCookie.ts`
- Modify: `src/server/auth/validateSessionCookie.tests.ts`
- Modify: `src/server/auth/routes/webauthnRegisterRoute.ts`
- Modify: `src/server/auth/routes/webauthnReauthRoute.ts`

#### Part A — `validateSessionCookie`

**Current file:** See `src/server/auth/validateSessionCookie.ts` — the key line is:
```ts
if (!record || !record.isEnabled) { socket.disconnect(); return false; }
```

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `src/server/auth/validateSessionCookie.tests.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { validateSessionCookie } from './validateSessionCookie';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';

function makeStore(record?: NexusAuthRecord): NexusAuthStore<NexusAuthRecord> {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => record),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => record),
    update: vi.fn(async () => {}),
  };
}

function makeSocket(cookieHeader?: string): Pick<Socket, 'handshake' | 'disconnect' | 'emit'> {
  return {
    handshake: { headers: { cookie: cookieHeader } } as any,
    disconnect: vi.fn(),
    emit: vi.fn(),
  };
}

const testUser: NexusUser = { id: 'user-1' };

describe('validateSessionCookie', () => {
  it('disconnects socket when no cookie header is present', async () => {
    const socket = makeSocket(undefined);
    await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('disconnects socket when sessionToken not found in store', async () => {
    const socket = makeSocket('socketapi_session=abc123');
    await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('disconnects socket when record isEnabled is false', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket('socketapi_session=abc123');
    await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('emits socketAPIDeviceDisabled before disconnecting when record isEnabled is false', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: false };
    const socket = makeSocket('socketapi_session=abc123');
    const result = await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(result).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('socket-api.events.socketAPIDeviceDisabled', undefined);
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-token disconnects', async () => {
    const socket = makeSocket(undefined);
    await validateSessionCookie(socket as any, makeStore(), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit socketAPIDeviceDisabled for missing-record disconnects', async () => {
    const socket = makeSocket('socketapi_session=abc123');
    await validateSessionCookie(socket as any, makeStore(undefined), vi.fn(async () => testUser), vi.fn(async () => {}));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('calls setUser and updates lastConnectedAt when valid', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const store = makeStore(record);
    const socket = makeSocket('socketapi_session=abc123');
    const setUser = vi.fn(async () => {});
    await validateSessionCookie(socket as any, store, vi.fn(async () => testUser), setUser);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(testUser);
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({ lastConnectedAt: expect.any(Number) }));
  });

  it('disconnects when onGetUser returns undefined', async () => {
    const record: NexusAuthRecord = { requestId: 'r1', sessionToken: 'abc123', userId: 'user-1', deviceId: 'd1', isEnabled: true };
    const socket = makeSocket('socketapi_session=abc123');
    await validateSessionCookie(socket as any, makeStore(record), vi.fn(async () => undefined), vi.fn(async () => {}));
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm new tests fail**

Run: `pnpm -C C:/code/personal/socket-api test -- src/server/auth/validateSessionCookie.tests.ts`
Expected: `emits socketAPIDeviceDisabled...` FAIL, `does NOT emit...` tests may fail too since `emit` property is now required in mock

- [ ] **Step 3: Update `validateSessionCookie.ts`**

```ts
// src/server/auth/validateSessionCookie.ts
import type { Socket } from 'socket.io';
import type { NexusAuthStore, NexusAuthRecord } from '../../common/auth';
import type { NexusUser } from '../../common';
import { socketAPIDeviceDisabled } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';

const COOKIE_NAME = 'socketapi_session';

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : undefined;
}

export async function validateSessionCookie(
  socket: Socket,
  store: NexusAuthStore<NexusAuthRecord>,
  onGetUser: (userId: string) => Promise<NexusUser | undefined>,
  setUser: (user: NexusUser) => Promise<void>,
): Promise<boolean> {
  const cookieHeader = socket.handshake.headers.cookie as string | undefined;
  const sessionToken = parseCookie(cookieHeader);
  if (!sessionToken) { socket.disconnect(); return false; }

  const record = await store.findBySessionToken(sessionToken);
  if (!record) { socket.disconnect(); return false; }

  if (!record.isEnabled) {
    socket.emit(`${eventPrefix}.${socketAPIDeviceDisabled.name}`, undefined);
    socket.disconnect();
    return false;
  }

  const user = await onGetUser(record.userId);
  if (!user) { socket.disconnect(); return false; }

  await setUser(user);
  await store.update(record.requestId, { lastConnectedAt: Date.now() });
  return true;
}
```

- [ ] **Step 4: Run tests — all should pass**

Run: `pnpm -C C:/code/personal/socket-api test -- src/server/auth/validateSessionCookie.tests.ts`
Expected: all 8 tests PASS

#### Part B — WebAuthn routes: return `userId`

- [ ] **Step 5: Update `webauthnRegisterRoute.ts`**

Change only the response body (line 36) from `{ ok: true }` to `{ ok: true, userId: record.userId }`:

```ts
    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true, userId: record.userId };
```

- [ ] **Step 6: Update `webauthnReauthRoute.ts`**

Same change (line 32) from `{ ok: true }` to `{ ok: true, userId: record.userId }`:

```ts
    ctx.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    ctx.status = 200;
    ctx.body = { ok: true, userId: record.userId };
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `pnpm -C C:/code/personal/socket-api tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git -C C:/code/personal/socket-api add src/server/auth/validateSessionCookie.ts src/server/auth/validateSessionCookie.tests.ts src/server/auth/routes/webauthnRegisterRoute.ts src/server/auth/routes/webauthnReauthRoute.ts
git -C C:/code/personal/socket-api commit -m "feat(auth): emit deviceDisabled event; add userId to WebAuthn route responses"
```

---

### Task 3: Client — `AuthenticationProvider`, `UserContext`, and `useAuthentication`

**Files:**
- Modify: `src/client/providers/user/UserContext.ts`
- Modify: `src/client/providers/user/AuthenticationProvider.tsx`
- Create: `src/client/providers/user/AuthenticationProvider.tests.tsx`
- Modify: `src/client/hooks/useAuthentication.ts`

#### Part A — `UserContext`: add `onPrf`

**Current content of `src/client/providers/user/UserContext.ts`:**
```ts
import { createContext } from 'react';
import type { NexusUser } from '../../../common';
import type { DistributedState } from '@anupheaus/react-ui';

export interface UserContextType {
  isValid: boolean;
  userState: DistributedState<NexusUser | undefined>;
  signOut(): Promise<void>;
}

export const UserContext = createContext<UserContextType>({
  isValid: false,
  userState: undefined as unknown as DistributedState<NexusUser | undefined>,
  signOut: () => Promise.resolve(),
});
```

- [ ] **Step 1: Write failing test first (for AuthenticationProvider)**

Create `src/client/providers/user/AuthenticationProvider.tests.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { NexusUser } from '../../../common';

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
    const user: NexusUser = { id: 'u1' };
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

  it('exposes onPrf in context so useAuthentication can call it', () => {
    const onPrf = vi.fn();
    let capturedContext: any;
    const { UserContext } = require('./UserContext');
    const ContextCapture = () => {
      const ctx = require('react').useContext(UserContext);
      capturedContext = ctx;
      return null;
    };
    render(
      <AuthenticationProvider onPrf={onPrf}>
        <ContextCapture />
      </AuthenticationProvider>
    );
    expect(typeof capturedContext?.onPrf).toBe('function');
    capturedContext.onPrf('user-1', new ArrayBuffer(32));
    expect(onPrf).toHaveBeenCalledWith('user-1', expect.any(ArrayBuffer));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm -C C:/code/personal/socket-api test -- src/client/providers/user/AuthenticationProvider.tests.tsx`
Expected: FAIL — props don't exist yet

#### Part B — Update `UserContext.ts`

- [ ] **Step 3: Update `UserContext.ts` to add `onPrf`**

```ts
// src/client/providers/user/UserContext.ts
import { createContext } from 'react';
import type { NexusUser } from '../../../common';
import type { DistributedState } from '@anupheaus/react-ui';

export interface UserContextType {
  isValid: boolean;
  userState: DistributedState<NexusUser | undefined>;
  signOut(): Promise<void>;
  onPrf?: (userId: string, prfOutput: ArrayBuffer) => void;
}

export const UserContext = createContext<UserContextType>({
  isValid: false,
  userState: undefined as unknown as DistributedState<NexusUser | undefined>,
  signOut: () => Promise.resolve(),
});
```

#### Part C — Update `AuthenticationProvider.tsx`

- [ ] **Step 4: Update `AuthenticationProvider.tsx`**

**Current file content for reference:**
```tsx
import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useEffect, useRef, useContext, type ReactNode } from 'react';
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';
import type { NexusUser } from '../../../common';
import { socketAPIUserChanged } from '../../../common/internalEvents';
import { eventPrefix } from '../../../common/internalModels';
import { SocketContext } from '../socket/SocketContext';

interface Props {
  children: ReactNode;
}

const eventName = `${eventPrefix}.${socketAPIUserChanged.name}`;

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({ children }: Props) => {
  const { on, off, name, reconnect } = useContext(SocketContext);
  const { state: userState, set: setUser } = useDistributedState<NexusUser | undefined>(() => undefined);
  const hookId = useRef('AuthenticationProvider').current;

  on(hookId, eventName, (payload: { user?: NexusUser }) => {
    setUser(payload.user);
  });

  useEffect(() => {
    return () => { off(hookId, eventName); };
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
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <UserContext.Provider value={context}>
      {children}
    </UserContext.Provider>
  );
});
```

New content:

```tsx
// src/client/providers/user/AuthenticationProvider.tsx
import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useEffect, useRef, useContext, type ReactNode } from 'react';
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';
import type { NexusUser } from '../../../common';
import { socketAPIUserChanged, socketAPIDeviceDisabled } from '../../../common/internalEvents';
import { eventPrefix } from '../../../common/internalModels';
import { SocketContext } from '../socket/SocketContext';

interface Props {
  onDeviceDisabled?: () => void;
  onSignedIn?: (user: NexusUser) => void;
  onSignedOut?: () => void;
  onPrf?: (userId: string, prfOutput: ArrayBuffer) => void;
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
  const { state: userState, set: setUser } = useDistributedState<NexusUser | undefined>(() => undefined);
  const hookId = useRef('AuthenticationProvider').current;
  const previousUserRef = useRef<NexusUser | undefined>(undefined);

  on(hookId, userChangedEventName, (payload: { user?: NexusUser }) => {
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

- [ ] **Step 5: Run AuthenticationProvider tests — all should pass**

Run: `pnpm -C C:/code/personal/socket-api test -- src/client/providers/user/AuthenticationProvider.tests.tsx`
Expected: all tests PASS

#### Part D — Update `useAuthentication.ts` to call `onPrf`

**Current content of `src/client/hooks/useAuthentication.ts`** (key section):
```ts
async function performWebAuthnRegistration(name: string, reconnect: () => void): Promise<void> {
  // ... fetches invite, calls navigator.credentials.create with PRF extension ...
  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');
  const keyHash = await computeKeyHash(prfResult);
  // ... calls register endpoint with keyHash ...
  reconnect();
}

async function performWebAuthnReauth(name: string, reconnect: () => void): Promise<void> {
  // ... calls navigator.credentials.get with PRF extension ...
  const prfResult = getPrfResult(credential);
  if (!prfResult) throw new Error('WebAuthn PRF extension not supported by this authenticator');
  const keyHash = await computeKeyHash(prfResult);
  // ... calls reauth endpoint with keyHash ...
  reconnect();
}
```

Both functions need to: (a) accept an `onPrf` callback, (b) read `userId` from the route response, (c) call `onPrf(userId, prfResult)` after success.

- [ ] **Step 6: Update `useAuthentication.ts`**

Full replacement content:

```ts
// src/client/hooks/useAuthentication.ts
import { useReducer, useRef, useContext, useCallback, useEffect } from 'react';
import type { NexusUser } from '../../common';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { UserContext } from '../providers/user/UserContext';
import { collectDeviceDetails } from '../auth/collectDeviceDetails';
import { computeDeviceId } from '../auth/computeDeviceId';

export interface ClientUseAuthResult<U, C> {
  readonly user: U | undefined;
  signIn(credentials: C): Promise<void>;
  signOut(): Promise<void>;
}

async function computeKeyHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getPrfResult(credential: PublicKeyCredential): ArrayBuffer | undefined {
  return (credential.getClientExtensionResults() as any).prf?.results?.first as ArrayBuffer | undefined;
}

async function performWebAuthnRegistration(
  name: string,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer) => void) | undefined,
): Promise<void> {
  const requestId = new URLSearchParams(window.location.search).get('requestId');
  if (!requestId) throw new Error('WebAuthn registration requires a ?requestId= query parameter (from invite URL)');

  const inviteRes = await fetch(`/${name}/socketAPI/webauthn/invite?requestId=${encodeURIComponent(requestId)}`, {
    credentials: 'include',
  });
  if (!inviteRes.ok) throw new Error(`Invite fetch failed: ${inviteRes.status}`);
  const { registrationToken, userDetails } = await inviteRes.json() as {
    registrationToken: string;
    userDetails: { name: string; displayName?: string };
  };

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

  const regRes = await fetch(`/${name}/socketAPI/webauthn/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ registrationToken, keyHash, deviceDetails: details }),
  });
  if (!regRes.ok) throw new Error(`WebAuthn registration failed: ${regRes.status}`);
  const { userId } = await regRes.json() as { userId: string };

  const url = new URL(window.location.href);
  url.searchParams.delete('requestId');
  window.history.replaceState({}, '', url.toString());

  if (onPrf) onPrf(userId, prfResult);
  reconnect();
}

async function performWebAuthnReauth(
  name: string,
  reconnect: () => void,
  onPrf: ((userId: string, prfOutput: ArrayBuffer) => void) | undefined,
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

  if (onPrf) onPrf(userId, prfResult);
  reconnect();
}

async function performJwtSignIn<C>(name: string, credentials: C, reconnect: () => void): Promise<void> {
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

export function useAuthentication<U extends NexusUser = NexusUser, C = void>(): ClientUseAuthResult<U, C> {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const userRef = useRef<U | undefined>(undefined);
  const isUserAccessedRef = useRef(false);
  const { name, reconnect, on, off } = useContext(SocketContext);
  const { onPrf } = useContext(UserContext);

  const hookId = useRef(`useAuthentication-${Math.random()}`).current;
  const eventName = `${eventPrefix}.${socketAPIUserChanged.name}`;
  on(hookId, eventName, (payload: { user: U | undefined }) => {
    userRef.current = payload.user;
    if (isUserAccessedRef.current) forceUpdate();
  });

  useEffect(() => {
    return () => off(hookId, eventName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (credentials?: C) => {
    if (credentials == null) {
      const hasInvite = new URLSearchParams(window.location.search).has('requestId');
      if (hasInvite) {
        await performWebAuthnRegistration(name, reconnect, onPrf);
      } else {
        await performWebAuthnReauth(name, reconnect, onPrf);
      }
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

- [ ] **Step 7: Run full test suite**

Run: `pnpm -C C:/code/personal/socket-api test`
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/providers/user/UserContext.ts src/client/providers/user/AuthenticationProvider.tsx src/client/providers/user/AuthenticationProvider.tests.tsx src/client/hooks/useAuthentication.ts
git -C C:/code/personal/socket-api commit -m "feat(client): add onDeviceDisabled, onSignedIn, onSignedOut, onPrf to AuthenticationProvider"
```

---

### Task 4: Wire all four props through `Nexus`

**Files:**
- Modify: `src/client/Nexus.tsx`

**Current `Nexus` Props:**
```ts
interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  auth?: Record<string, string>;
  autoConnect?: boolean;
  children?: ReactNode;
}
```

- [ ] **Step 1: Update `Nexus.tsx`**

```tsx
// src/client/Nexus.tsx
import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketProvider, SubscriptionProvider } from './providers';
import { AuthenticationProvider } from './providers/user/AuthenticationProvider';
import type { Logger } from '@anupheaus/common';
import type { NexusUser } from '../common';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  /** When false, the socket is not created until connect() is called. Default: true. */
  autoConnect?: boolean;
  /** Called when the server reports this device has been administratively disabled. */
  onDeviceDisabled?: () => void;
  /** Called when a user successfully signs in (undefined → user transition). */
  onSignedIn?: (user: NexusUser) => void;
  /** Called when the user signs out (user → undefined transition). */
  onSignedOut?: () => void;
  /** Called after a successful WebAuthn ceremony with the raw PRF output for key derivation. */
  onPrf?: (userId: string, prfOutput: ArrayBuffer) => void;
  children?: ReactNode;
}

export const Nexus = createComponent('Nexus', ({
  host,
  name,
  logger,
  auth,
  autoConnect,
  onDeviceDisabled,
  onSignedIn,
  onSignedOut,
  onPrf,
  children,
}: Props) => {
  return (
    <LoggerProvider logger={logger} loggerName={'socket-api'}>
      <SocketProvider host={host} name={name} auth={auth} autoConnect={autoConnect}>
        <SubscriptionProvider>
          <AuthenticationProvider
            onDeviceDisabled={onDeviceDisabled}
            onSignedIn={onSignedIn}
            onSignedOut={onSignedOut}
            onPrf={onPrf}
          >
            {children}
          </AuthenticationProvider>
        </SubscriptionProvider>
      </SocketProvider>
    </LoggerProvider>
  );
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm -C C:/code/personal/socket-api tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run full test suite**

Run: `pnpm -C C:/code/personal/socket-api test`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git -C C:/code/personal/socket-api add src/client/Nexus.tsx
git -C C:/code/personal/socket-api commit -m "feat(Nexus): add onDeviceDisabled, onSignedIn, onSignedOut, onPrf props"
```

---

## Self-Review

**Spec coverage:**
- ✅ `onDeviceDisabled` — server emits `socketAPIDeviceDisabled` only for `!record.isEnabled`; client `AuthenticationProvider` calls prop
- ✅ Other disconnect paths (no cookie, no record, user not found) do NOT emit the event
- ✅ `onSignedIn(user)` — fires on `undefined → user` transition only; not on user updates
- ✅ `onSignedOut()` — fires on `user → undefined` transition only; not if no prior user
- ✅ `onPrf(userId, prfOutput)` — fires after WebAuthn registration AND reauth ceremonies; `userId` from route response; `prfOutput` raw ArrayBuffer from PRF extension
- ✅ All four props exposed on `Nexus`; thread to `AuthenticationProvider`; `onPrf` stored in `UserContext` for `useAuthentication` to consume

**Placeholder scan:** No placeholders found.

**Type consistency:**
- `socketAPIDeviceDisabled: NexusEvent<void>` — defined Task 1, imported Task 2 server + Task 3 client
- `onDeviceDisabled?: () => void` — identical in `AuthenticationProvider` Props and `Nexus` Props
- `onSignedIn?: (user: NexusUser) => void` — identical in both Props interfaces
- `onSignedOut?: () => void` — identical in both Props interfaces
- `onPrf?: (userId: string, prfOutput: ArrayBuffer) => void` — identical in `AuthenticationProvider` Props, `UserContext`, and `Nexus` Props
- `userId: string` — from route response `{ ok: true, userId: record.userId }`; typed as `{ userId: string }` in `useAuthentication`
- `prfResult: ArrayBuffer` — from `getPrfResult(credential)` which returns `ArrayBuffer | undefined`; guarded before use
