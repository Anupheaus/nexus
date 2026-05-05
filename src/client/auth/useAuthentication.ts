import { useRef, useContext } from 'react';
import { useBound, useDistributedState, useForceUpdate } from '@anupheaus/react-ui';
import type { SocketAPIAccount, SocketAPIUser } from '../../common';
import { webauthnInviteAction, webauthnRegisterAction, signOutAction, signInAction, webauthnReauthAction } from '../../common/internalActions';
import { socketAPIUserChanged, socketAPIAccountChanged } from '../../common/internalEvents';
import { SocketContext } from '../providers/socket/SocketContext';
import { AuthContext } from './AuthContext';
import { performWebAuthnRegistration } from './webauthnRegistration';
import { performWebAuthnReauth } from './webauthnReauth';
import { performJwtSignIn } from './jwtAuth';
import { useAction, useEvent } from '../hooks';

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
}

export function useAuthentication<U extends SocketAPIUser = SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount, C = void>(): ClientUseAuthResult<U, A, C> {
  const forceUpdate = useForceUpdate();
  const { reconnect } = useContext(SocketContext);
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

  const signIn = useBound(async (credentials?: C) => {
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
        ? performWebAuthnRegistration(webauthnInvite, webauthnRegister, maybeReconnect, onPrf)
        : performWebAuthnReauth(callReauth, maybeReconnect, onPrf);
      activeWebAuthnPromise = promise;
      // Clear on both resolve and reject without creating an unhandled rejection.
      // promise.finally(cb) mirrors the original rejection on its own returned promise,
      // which would be unhandled if we don't consume it. Using then(cb, cb) resolves instead.
      promise.then(() => { activeWebAuthnPromise = undefined; }, () => { activeWebAuthnPromise = undefined; });
      await promise;
    } else {
      await performJwtSignIn(callSignIn, credentials, reconnect);
    }
  });

  const signOut = useBound(async () => {
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
  };
}
