import { createComponent, useBound, useDistributedState } from '@anupheaus/react-ui';
import { useMemo, useRef, useContext, type ReactNode } from 'react';
import type { AuthContextType } from './AuthContext';
import { AuthContext } from './AuthContext';
import type { NexusAccount, NexusUser } from '../../common';
import { signOutAction, biometricSetupAction } from '../../common/internalActions';
import { socketAPIUserChanged, socketAPIAccountChanged, socketAPIDeviceDisabled } from '../../common/internalEvents';
import { SocketContext } from '../providers/socket/SocketContext';
import { useAction, useEvent } from '../hooks';
import { performBiometricSetup, isCapacitorNative } from './biometricAuth';

interface Props {
  onDeviceDisabled?: () => void;
  onSignedIn?: (user: NexusUser) => void;
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
  const { state: userState, set: setUser } = useDistributedState<NexusUser | undefined>(() => undefined);
  const { state: accountState, set: setAccount } = useDistributedState<NexusAccount | undefined>(() => undefined);
  const { signOut: callSignOut } = useAction(signOutAction);
  const { biometricSetup: callBiometricSetup } = useAction(biometricSetupAction);

  const previousUserRef = useRef<NexusUser | undefined>(undefined);

  const onUserChanged = useEvent(socketAPIUserChanged);
  onUserChanged(({ user }) => {
    const prev = previousUserRef.current;
    previousUserRef.current = user as NexusUser | undefined;
    setUser(user as NexusUser | undefined);
    if (user != null && prev == null) {
      const typedUser = user as NexusUser;
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
    setAccount(account as NexusAccount | undefined);
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
