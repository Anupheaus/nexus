import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketProvider, SubscriptionProvider } from './providers';
import { AuthenticationProvider } from './auth/AuthenticationProvider';
import type { Logger } from '@anupheaus/common';
import type { SocketAPIUser } from '../common';
import type { TokenStorage } from './providers/socket/tokenStorage';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  /** When false, the socket is not created until connect() is called. Default: true. */
  autoConnect?: boolean;
  /** Optional token storage for environments that cannot rely on HttpOnly cookies (e.g. Capacitor). */
  tokenStorage?: TokenStorage;
  children?: ReactNode;
  /** Called when the server reports this device has been administratively disabled. */
  onDeviceDisabled?: () => void;
  /** Called when a user successfully signs in (undefined → user transition). */
  onSignedIn?: (user: SocketAPIUser) => void;
  /** Called when the user signs out (user → undefined transition). */
  onSignedOut?: () => void;
  /** Called after a successful WebAuthn ceremony with the raw PRF output for key derivation. */
  onPrf?: (userId: string, prfOutput: ArrayBuffer, accountId?: string) => void | Promise<void>;
}

export const SocketAPI = createComponent('SocketAPI', ({
  host,
  name,
  logger,
  auth,
  autoConnect,
  tokenStorage,
  children,
  onDeviceDisabled,
  onSignedIn,
  onSignedOut,
  onPrf,
}: Props) => {
  return (
    <LoggerProvider logger={logger} loggerName={'socket-api'}>
      <SocketProvider host={host} name={name} auth={auth} autoConnect={autoConnect} tokenStorage={tokenStorage}>
        <SubscriptionProvider>
          <AuthenticationProvider
            onDeviceDisabled={onDeviceDisabled}
            onSignedIn={onSignedIn}
            onSignedOut={onSignedOut}
            onPrf={onPrf}
          >
            {children}
          </AuthenticationProvider>
        </SubscriptionProvider>
      </SocketProvider>
    </LoggerProvider>
  );
});
