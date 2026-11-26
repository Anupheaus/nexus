import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useRef, useContext, type ReactNode } from 'react';
import type { AuthContextType } from './AuthContext';
import { AuthContext } from './AuthContext';
import type { NexusAccount, NexusUser } from '../../common';
import { signOutAction } from '../../common/internalActions';
import { socketAPIUserChanged, socketAPIAccountChanged, socketAPIDeviceDisabled } from '../../common/internalEvents';
import { SocketContext } from '../providers/socket/SocketContext';
import { DEVICE_DISABLED_REFUSAL_REASON } from '../providers/socket/connectionRefusal';
import { useAction, useEvent } from '../hooks';
import { clearBiometricKey } from './biometricAuth';

interface Props {
  onDeviceDisabled?: () => void;
  onSignedIn?: (user: NexusUser) => void;
  onSignedOut?: () => void;
  onPrf?: (userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>;
  /** The WebAuthn relying party ID; the page's host when omitted (see `getRpId`). */
  rpId?: string;
  children: ReactNode;
}

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({
  children,
  onDeviceDisabled,
  onSignedIn,
  onSignedOut,
  onPrf,
  rpId,
}: Props) => {
  const { reconnect, name, onConnectionRefused } = useContext(SocketContext);
  const { state: userState, set: setUser } = useDistributedState<NexusUser | undefined>(() => undefined);
  const { state: accountState, set: setAccount } = useDistributedState<NexusAccount | undefined>(() => undefined);
  const { signOut: callSignOut } = useAction(signOutAction);

  const previousUserRef = useRef<NexusUser | undefined>(undefined);

  const onUserChanged = useEvent(socketAPIUserChanged);
  onUserChanged(({ user }) => {
    const prev = previousUserRef.current;
    previousUserRef.current = user as NexusUser | undefined;
    setUser(user as NexusUser | undefined);
    if (user != null && prev == null) {
      const typedUser = user as NexusUser;
      onSignedIn?.(typedUser);
    }
    if (user == null && prev != null) onSignedOut?.();
  });

  const onAccountChanged = useEvent(socketAPIAccountChanged);
  onAccountChanged(({ account }) => {
    setAccount(account as NexusAccount | undefined);
  });

  const handleDeviceDisabled = useBound(() => {
    // A disabled device keeps no key to the local database (sc-644)
    void clearBiometricKey(name);
    onDeviceDisabled?.();
  });

  const onDeviceDisabledEvent = useEvent(socketAPIDeviceDisabled);
  onDeviceDisabledEvent(handleDeviceDisabled);

  // The server refuses a disabled device's connection outright (it has no connected socket to send the event on), both
  // when its open page reconnects and on every reload.
  onConnectionRefused?.(reason => {
    if (reason === DEVICE_DISABLED_REFUSAL_REASON) handleDeviceDisabled();
  });

  const signOut = useBound(async () => {
    await clearBiometricKey(name);
    await callSignOut();
    setUser(undefined);
    setAccount(undefined);
    reconnect();
  });

  const context = useMemo<AuthContextType>(() => ({
    isValid: true,
    userState,
    accountState,
    signOut,
    onPrf,
    rpId,
  }), [onPrf, rpId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={context}>
      {children}
    </AuthContext.Provider>
  );
});
