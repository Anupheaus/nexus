import { useReducer, useRef, useContext, useCallback, useEffect } from 'react';
import { useDistributedState } from '@anupheaus/react-ui';
import type { SocketAPIUser } from '../../common';
import { webauthnInviteAction, webauthnRegisterAction } from '../../common/internalActions';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { UserContext } from '../providers/user/UserContext';
import { collectDeviceDetails } from '../auth/collectDeviceDetails';
import { computeKeyHash, getPrfResult } from '../auth/webauthnUtils';
import { performJwtSignIn } from '../auth/jwtAuth';
import { useAction } from './useAction';

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

type InviteCaller = (req: { requestId: string }) => Promise<{ registrationToken: string; userDetails: { name: string; displayName?: string } }>;
type RegisterCaller = (req: { registrationToken: string; keyHash: string; deviceDetails: ReturnType<typeof collectDeviceDetails> }) => Promise<{ userId: string }>;

async function performWebAuthnRegistration(
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

async function performWebAuthnReauth(
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
