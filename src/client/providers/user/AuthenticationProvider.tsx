import { createComponent, useBound, useDistributedState, useStorage } from '@anupheaus/react-ui';
import { useMemo, type ReactNode } from 'react';
import type { UserContextType } from './UserContext';
import { UserContext } from './UserContext';
import { useAction, useEvent } from '../../hooks';
import type { SocketAPIUser } from '../../../common';
import { jwt, socketAPIAuthenticateTokenAction } from '../../../common';
import { is } from '@anupheaus/common';
import { socketAPIUserAuthenticated, socketAPIUserSignOut } from '../../../common/internalEvents';
import { useSocket } from '../socket';

function getUserFromToken(token: string | undefined): SocketAPIUser | undefined {
  if (token == null) return;
  const userFromToken = jwt.extractUntrustedUserFromToken(token);
  if (userFromToken != null && is.guid(userFromToken.id)) return userFromToken;
}

interface Props {
  tokenKeyName?: string;
  /** When true, skips calling socketAPIAuthenticateTokenAction on reconnect.
   *  Use when the socket is authenticated via handshake auth (e.g. mxdb-sync device tokens). */
  disableTokenReconnect?: boolean;
  children: ReactNode;
}

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({
  tokenKeyName = 'socket-api-token',
  disableTokenReconnect = false,
  children,
}: Props) => {
  const { onConnected } = useSocket();
  const { state: token, setState: setToken } = useStorage<string>(tokenKeyName, { type: 'local' });
  const { socketAPIAuthenticateTokenAction: authenticateToken } = useAction(socketAPIAuthenticateTokenAction);
  const { state: userState, set: setUser } = useDistributedState(() => getUserFromToken(token));
  const onUserAuthenticated = useEvent(socketAPIUserAuthenticated);
  const onUserSignOut = useEvent(socketAPIUserSignOut);

  const signOut = useBound(async () => {
    setToken(undefined);
    setUser(undefined);
  });

  onUserAuthenticated(({ token: newToken }) => {
    const user = getUserFromToken(newToken);
    if (user == null) return;
    setToken(newToken);
    setUser(user);
  });

  onUserSignOut(signOut);

  onConnected(async () => {
    if (disableTokenReconnect) return;
    if (token == null) return;
    if (!await authenticateToken(token)) signOut();
  });

  const context = useMemo<UserContextType>(() => ({
    isValid: true,
    userState,
    signOut,
  }), []);

  return (
    <UserContext.Provider value={context}>
      {children}
    </UserContext.Provider>
  );
});
