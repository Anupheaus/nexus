import { useReducer, useRef, useContext, useCallback, useEffect } from 'react';
import type { SocketAPIUser } from '../../common';
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

export function useAuthentication<U extends SocketAPIUser = SocketAPIUser, C = void>(): ClientUseAuthResult<U, C> {
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
