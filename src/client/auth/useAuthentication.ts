import { useRef, useContext } from 'react';
import { useBound, useDistributedState, useForceUpdate } from '@anupheaus/react-ui';
import type { NexusAccount, NexusUser } from '../../common';
import { webauthnInviteAction, webauthnRegisterAction, signOutAction, signInAction, webauthnReauthAction } from '../../common/internalActions';
import { socketAPIUserChanged, socketAPIAccountChanged } from '../../common/internalEvents';
import { SocketContext } from '../providers/socket/SocketContext';
import { AuthContext } from './AuthContext';
import { performWebAuthnRegistration } from './webauthnRegistration';
import { performWebAuthnReauth } from './webauthnReauth';
import { performJwtSignIn } from './jwtAuth';
import { hasBiometricCredential, performBiometricReauth } from './biometricAuth';
import { useAction, useEvent } from '../hooks';
import { googleOAuthConfigAction, googleOneTapAction, googleScopesAction } from '../../common/internalActions';
import { performGoogleSignIn } from './googleSignIn';
import { requestScopes as doRequestScopes } from './googleRequestScopes';

// Module-level: deduplicate concurrent WebAuthn signIn calls across hook instances.
// DeviceAuthGate fires its effect before the socket delivers the user, then MXDBSyncInner
// fires once the user arrives — both call signIn() within milliseconds. Only one WebAuthn
// ceremony must run; the second call joins the in-flight promise instead of starting a new one.
let activeWebAuthnPromise: Promise<void> | undefined;

export interface ClientUseAuthResult<U, A, C> {
  readonly isAuthenticated: boolean;
  readonly user: U | undefined;
  readonly account: A | undefined;
  signIn(credentials?: C): Promise<void>;
  signOut(): Promise<void>;
  requestScopes(scopes: string[]): Promise<void>;
  waitForAuthCheck(): Promise<void>;
  /** Reads current auth state from a ref — safe to call inside stale closures (e.g. useEffect with [] deps). */
  getIsAuthenticated(): boolean;
  /** Reads current user from a ref — safe to call inside stale closures (e.g. useEffect with [] deps). */
  getUser(): U | undefined;
}

export function useAuthentication<U extends NexusUser = NexusUser, A extends NexusAccount = NexusAccount, C = void>(): ClientUseAuthResult<U, A, C> {
  const forceUpdate = useForceUpdate();
  const { reconnect, name, waitForAuthCheck } = useContext(SocketContext);
  const { onPrf, userState, accountState } = useContext(AuthContext);
  // Initialize from current state so we don't miss events fired before this hook instance
  // mounted (e.g. DeviceAuthGate remounting after MXDBSyncInner sets the encryption key).
  const { get: getCurrentUser } = useDistributedState<U | undefined>(userState);
  const { get: getCurrentAccount } = useDistributedState<A | undefined>(accountState);
  const userRef = useRef<U | undefined>(getCurrentUser());
  const accountRef = useRef<A | undefined>(getCurrentAccount());
  const isUserAccessedRef = useRef(false);
  const isAccountAccessedRef = useRef(false);

  const onUserChanged = useEvent(socketAPIUserChanged);
  onUserChanged(({ user }) => {
    userRef.current = user as U | undefined;
    if (isUserAccessedRef.current) forceUpdate();
  });

  const onAccountChanged = useEvent(socketAPIAccountChanged);
  onAccountChanged(({ account }) => {
    accountRef.current = account as A | undefined;
    if (isAccountAccessedRef.current) forceUpdate();
  });

  // Keep the latest action callers in refs so the signIn callback doesn't need them in its
  // dependency array (they are recreated every render by useAction, but are always current).
  const { webauthnInvite } = useAction(webauthnInviteAction);
  const { webauthnRegister } = useAction(webauthnRegisterAction);
  const { signOut: callSignOut } = useAction(signOutAction);
  const { signIn: callSignIn } = useAction(signInAction);
  const { webauthnReauth: callReauth } = useAction(webauthnReauthAction);
  const { googleOAuthConfig } = useAction(googleOAuthConfigAction);
  const { googleOneTap } = useAction(googleOneTapAction);
  const { googleScopes } = useAction(googleScopesAction);

  const signIn = useBound(async (credentials?: C) => {
    if (credentials == null) {
      // Deduplicate: if a sign-in is already in flight (e.g. DeviceAuthGate started one before
      // the socket delivered the user, then MXDBSyncInner fires too), join the existing promise.
      // activeWebAuthnPromise is assigned synchronously before the first await so concurrent calls
      // hit this guard even when the first call is still awaiting googleOAuthConfig.
      if (activeWebAuthnPromise != null) return activeWebAuthnPromise;

      const hasInvite = new URLSearchParams(window.location.search).has('requestId');
      // Evaluate lazily at call time: by then the socket has had seconds to deliver the user from
      // an existing session cookie, so we can skip reconnect if it already did.
      const maybeReconnect = () => { if (userRef.current == null) reconnect(); };

      // Wrap the body in an IIFE so activeWebAuthnPromise is assigned synchronously before
      // the first await, preventing a concurrent signIn from starting a second ceremony.
      activeWebAuthnPromise = (async () => {
        // On Capacitor native, try biometric sign-in first — WebAuthn is not available
        // in the Android WebView and biometric provides a frictionless alternative.
        // Skip when registering via invite — biometric reauth cannot create a new device.
        if (!hasInvite && await hasBiometricCredential(name)) {
          await performBiometricReauth(callReauth, maybeReconnect, name);
          return;
        }

        // Detect Google OAuth mode: GET config endpoint returns clientId if server is in
        // google-oauth mode, throws with 404 otherwise.
        let googleClientId: string | undefined;
        if (!hasInvite) {
          try {
            const cfg = await googleOAuthConfig();
            googleClientId = cfg.clientId;
          } catch {
            // Not google-oauth mode — fall through to WebAuthn
          }
        }

        if (googleClientId != null) {
          await performGoogleSignIn({
            clientId: googleClientId,
            startUrl: `/${name}/socketAPI/google/start`,
            onOneTap: async (credential) => { await googleOneTap({ credential }); },
            onComplete: maybeReconnect,
          });
          return;
        }

        await (hasInvite
          ? performWebAuthnRegistration(webauthnInvite, webauthnRegister, maybeReconnect, onPrf, name)
          : performWebAuthnReauth(callReauth, maybeReconnect, onPrf, name));
      })();

      // Clear on both resolve and reject without creating an unhandled rejection.
      // promise.finally(cb) mirrors the rejection, which would be unhandled here.
      activeWebAuthnPromise.then(
        () => { activeWebAuthnPromise = undefined; },
        () => { activeWebAuthnPromise = undefined; },
      );
      await activeWebAuthnPromise;
    } else {
      await performJwtSignIn(callSignIn, credentials, reconnect);
    }
  });

  const requestScopesFn = useBound(async (scopes: string[]) => {
    const startUrl = `/${name}/socketAPI/google/start`;
    await doRequestScopes(
      scopes,
      googleScopes,
      async (missingScopes) => {
        const cfg = await googleOAuthConfig();
        await performGoogleSignIn({
          clientId: cfg.clientId,
          startUrl: `${startUrl}?scopes=${encodeURIComponent(missingScopes.join(','))}`,
          onOneTap: async () => { /* not used for incremental auth */ },
          onComplete: reconnect,
          skipOneTap: true,
        });
      },
    );
  });

  const signOut = useBound(async () => {
    activeWebAuthnPromise = undefined;
    await callSignOut();
    userRef.current = undefined;
    accountRef.current = undefined;
    if (isUserAccessedRef.current || isAccountAccessedRef.current) forceUpdate();
    reconnect();
  });

  return {
    get isAuthenticated(): boolean {
      isUserAccessedRef.current = true;
      return userRef.current != null;
    },
    get user(): U | undefined {
      isUserAccessedRef.current = true;
      return userRef.current;
    },
    get account(): A | undefined {
      isAccountAccessedRef.current = true;
      return accountRef.current;
    },
    signIn,
    signOut,
    requestScopes: requestScopesFn,
    waitForAuthCheck,
    getIsAuthenticated: useBound((): boolean => userRef.current != null),
    getUser: useBound((): U | undefined => userRef.current),
  };
}
