import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useRef, useContext, type ReactNode } from 'react';
import type { AuthContextType } from './AuthContext';
import { AuthContext } from './AuthContext';
import type { SocketAPIAccount, SocketAPIUser } from '../../common';
import { signOutAction, biometricSetupAction } from '../../common/internalActions';
import { socketAPIUserChanged, socketAPIAccountChanged, socketAPIDeviceDisabled } from '../../common/internalEvents';
import { SocketContext } from '../providers/socket/SocketContext';
import { useAction, useEvent } from '../hooks';
import { performBiometricSetup, isCapacitorNative } from './biometricAuth';

interface Props {
  onDeviceDisabled?: () => void;
  onSignedIn?: (user: SocketAPIUser) => void;
  onSignedOut?: () => void;
  onPrf?: (userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>;
  children: ReactNode;
}

export const AuthenticationProvider = createComponent('AuthenticationProvider', ({
  children,
  onDeviceDisabled,
  onSignedIn,
  onSignedOut,
  onPrf,
}: Props) => {
  const { reconnect, name } = useContext(SocketContext);
  const { state: userState, set: setUser } = useDistributedState<SocketAPIUser | undefined>(() => undefined);
  const { state: accountState, set: setAccount } = useDistributedState<SocketAPIAccount | undefined>(() => undefined);
  const { signOut: callSignOut } = useAction(signOutAction);
  const { biometricSetup: callBiometricSetup } = useAction(biometricSetupAction);

  const previousUserRef = useRef<SocketAPIUser | undefined>(undefined);

  const onUserChanged = useEvent(socketAPIUserChanged);
  onUserChanged(({ user }) => {
    const prev = previousUserRef.current;
    previousUserRef.current = user as SocketAPIUser | undefined;
    setUser(user as SocketAPIUser | undefined);
    if (user != null && prev == null) {
      const typedUser = user as SocketAPIUser;
      onSignedIn?.(typedUser);
      // After sign-in on a Capacitor native device, register a biometric key for this device
      // so subsequent sign-ins can use the native biometric prompt instead of WebAuthn.
      if (isCapacitorNative()) {
        performBiometricSetup({ callSetup: callBiometricSetup, name, userId: typedUser.id }).catch(() => { /* non-fatal */ });
      }
    }
    if (user == null && prev != null) onSignedOut?.();
  });

  const onAccountChanged = useEvent(socketAPIAccountChanged);
  onAccountChanged(({ account }) => {
    setAccount(account as SocketAPIAccount | undefined);
  });

  const onDeviceDisabledEvent = useEvent(socketAPIDeviceDisabled);
  onDeviceDisabledEvent(() => {
    onDeviceDisabled?.();
  });

  const signOut = useBound(async () => {
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
  }), [onPrf]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={context}>
      {children}
    </AuthContext.Provider>
  );
});
