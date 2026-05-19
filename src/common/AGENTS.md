# common — Shared Types & Utilities

Everything in this folder is shared between the client and server. It defines the typed contracts (actions, events, subscriptions) that both sides import to stay in sync.

## Sub-folders

| Folder | Description |
|--------|-------------|
| [auth/](auth/AGENTS.md) | Auth record/store interfaces for JWT, WebAuthn, and Google OAuth |
| [socket/](socket/AGENTS.md) | Custom Socket.IO parser that handles `Date`, `Map`, `Set`, `BigInt` over the wire |

## Key files

| File | Purpose |
|------|---------|
| `defineAction.ts` | `defineAction<Request, Response>()(name, options?)` — declares a typed RPC action |
| `defineEvent.ts` | `defineEvent<Payload>(name)` — declares a typed server-push event |
| `defineSubscription.ts` | `defineSubscription<Request, Response>()(name, options?)` — declares a typed streaming subscription |
| `models.ts` | `NexusUser`, `NexusCredentials` base interfaces |
| `ackResponse.ts` | Utilities for standardised socket.io acknowledgment responses |
| `jwt.ts` | Lightweight JWT decode helpers (no verification — server-side only for verification) |
| `internalActions.ts` | All framework-internal action definitions (sign-in, sign-out, WebAuthn, Google OAuth, biometric) plus their request/response types — imported by both client and server action implementations |
| `internalEvents.ts` | Internal server-push event definitions: `socketAPIUserAuthenticated`, `socketAPIUserChanged`, `socketAPIAccountChanged`, `socketAPIUserSignOut`, `socketAPIDeviceDisabled` |
| `internalModels.ts` | Wire-protocol types: event/action/subscription name prefixes, `NexusSubscriptionRequest`, `NexusSubscriptionResponse` |
| `internalSubscriptions.ts` | Internal subscription definitions used by framework internals |

## Quick start

Define your contracts once and import them on both sides:

```ts
// shared/contracts.ts
import { defineAction, defineSubscription, defineEvent } from '@anupheaus/nexus/common';

export const getUserAction = defineAction<{ id: string }, User>()('getUser');
export const userUpdatedEvent = defineEvent<User>('userUpdated');
export const liveStatsSubscription = defineSubscription<void, Stats>()('liveStats');
```
