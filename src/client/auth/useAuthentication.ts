import { useReducer, useRef, useContext, useEffect } from 'react';
import { useBound, useDistributedState } from '@anupheaus/react-ui';
import type { SocketAPIUser } from '../../common';
import { webauthnInviteAction, webauthnRegisterAction, signOutAction } from '../../common/internalActions';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { UserContext } from './UserContext';
import { performWebAuthnRegistration } from './webauthnRegistration';
import { performWebAuthnReauth } from './webauthnReauth';
import { performJwtSignIn } from './jwtAuth';
import { useAction } from '../hooks/useAction';

// Module-level: deduplicate concurrent WebAuthn signIn calls across hook instances.
// DeviceAuthGate fires its effect before the socket delivers the user, then MXDBSyncInner
// fires once the user arrives — both call signIn() within milliseconds. Only one WebAuthn
// ceremony must run; the second call joins the in-flight promise instead of starting a new one.
let activeWebAuthnPromise: Promise<void> | undefined;

export interface ClientUseAuthResult<U, C> {
  readonly user: U | undefined;
  signIn(credentials?: C): Promise<void>;
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
  on(hookId, eventName, (payload: { user: U | undefined; }) => {
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
  const { signOut: callSignOut } = useAction(signOutAction);

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
  });

  const signOut = useBound(async () => {
    await callSignOut();
    userRef.current = undefined;
    if (isUserAccessedRef.current) forceUpdate();
    reconnect();
  });

  return {
    get user(): U | undefined {
      isUserAccessedRef.current = true;
      return userRef.current;
    },
    signIn,
    signOut,
  };
}
