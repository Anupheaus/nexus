import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useEffect, useRef, useContext, type ReactNode } from 'react';
import type { UserContextType } from '../../auth/UserContext';
import { UserContext } from '../../auth/UserContext';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserChanged, socketAPIDeviceDisabled } from '../../../common/internalEvents';
import { eventPrefix } from '../../../common/internalModels';
import { SocketContext } from '../socket/SocketContext';

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
