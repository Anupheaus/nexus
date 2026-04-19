import { useReducer, useRef, useContext, useCallback, useEffect } from 'react';
import type { SocketAPIUser } from '../../common';
import { socketAPIUserChanged } from '../../common/internalEvents';
import { eventPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { collectDeviceDetails } from '../auth/collectDeviceDetails';
import { computeDeviceId } from '../auth/computeDeviceId';

export interface ClientUseAuthResult<U, C> {
  readonly user: U | undefined;
  signIn(credentials: C): Promise<void>;
  signOut(): Promise<void>;
}

export function useAuthentication<U extends SocketAPIUser = SocketAPIUser, C = void>(): ClientUseAuthResult<U, C> {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const userRef = useRef<U | undefined>(undefined);
  const isUserAccessedRef = useRef(false);
  const { name, reconnect, on, off } = useContext(SocketContext);

  // Listen for server-pushed user changes
  const hookId = useRef(`useAuthentication-${Math.random()}`).current;
  const eventName = `${eventPrefix}.${socketAPIUserChanged.name}`;
  on(hookId, eventName, (payload: { user: U | undefined }) => {
    userRef.current = payload.user;
    if (isUserAccessedRef.current) forceUpdate();
  });

  // Cleanup event listener on unmount
  useEffect(() => {
    return () => {
      off(hookId, eventName);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (credentials: C) => {
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
  }, [name, reconnect]);

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
