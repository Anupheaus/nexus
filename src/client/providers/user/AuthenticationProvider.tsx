import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useEffect, useRef, useContext, type ReactNode } from 'react';
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserChanged } from '../../../common/internalEvents';
import { eventPrefix } from '../../../common/internalModels';
import { SocketContext } from '../socket/SocketContext';

interface Props {
  children: ReactNode;
}

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({ children }: Props) => {
  const { on, off } = useContext(SocketContext);
  const { state: userState, set: setUser } = useDistributedState<SocketAPIUser | undefined>(() => undefined);
  const hookId = useRef('AuthenticationProvider').current;
  const eventName = `${eventPrefix}.${socketAPIUserChanged.name}`;

  on(hookId, eventName, (payload: { user?: SocketAPIUser }) => {
    setUser(payload.user);
  });

  useEffect(() => {
    return () => { off(hookId, eventName); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useBound(async () => {
    setUser(undefined);
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
