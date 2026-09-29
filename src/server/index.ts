import { createServerActionHandler, useAction, type NexusServerAction } from './actions';
import { useEvent } from './events';
import { createServerSubscription, type NexusServerSubscription } from './subscriptions';
import type { Server, Socket } from 'socket.io';

export { createServerActionHandler, useAction, useEvent, NexusServerAction, createServerSubscription, NexusServerSubscription };
export * from './startServer';
export * from '../common/models';
export { useClient, useAuthentication } from './providers';
export type { Socket, Server };
// `useAuthData` is public because a consumer acting as the integrator needs to read the
// per-client authentication state this context holds — Vision resolves the current auth
// request from it in its billing helpers. Read accessor only: the matching `setAuthData`
// stays internal, since only nexus itself should be populating the slot.
export { useLogger, useConfig, useAuthData, createAsyncContext, required, optional } from './async-context';
export type { NexusServerHandlerActionUtils, CookieOptions, RedirectResult, TransportType } from './handler';
export type { SecurityConfig, ResolvedSecurityConfig, RateLimitConfig, CorsConfig, CorsOriginPredicate } from './security';
export { withSecurity } from './security';
export type { AuthConfig, JwtAuthConfig, WebAuthnAuthConfig } from './auth';
// Read accessor for the configuration `defineAuthentication` installed, so a consumer can
// branch on the active auth mode. `setAuthConfig`/`clearAuthConfig` stay internal.
export { getAuthConfig } from './auth';
// What a WebAuthn store holds for a device's key hash (a digest, never the client's value, sc-613), so a store can migrate
// records written before digests (mxdb does) with exactly nexus's formula.
export { toStoredKeyHash } from './auth';
export { defineAuthentication } from './auth/defineAuthentication';
export type { CreateInviteOptions, ServerUseAuthResult } from './auth/defineAuthentication';
export type { SSLConfig, SelfSignedSSLConfig, ProvidedSSLConfig, OffSSLConfig, TLSCertificate } from './ssl';
