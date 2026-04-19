import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketProvider, SubscriptionProvider } from './providers';
import { AuthenticationProvider } from './providers/user/AuthenticationProvider';
import type { Logger } from '@anupheaus/common';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  tokenKeyName?: string;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  onInvalidToken?(): Promise<void>;
  children?: ReactNode;
}

export const SocketAPI = createComponent('SocketAPI', ({
  host,
  name,
  logger,
  auth,
  tokenKeyName = 'socket-api-token',
  children,
}: Props) => {
  return (
    <LoggerProvider logger={logger} loggerName={'socket-api'}>
      <SocketProvider host={host} name={name} auth={auth}>
        <SubscriptionProvider>
          <AuthenticationProvider tokenKeyName={tokenKeyName} disableTokenReconnect={auth != null}>
            {children}
          </AuthenticationProvider>
        </SubscriptionProvider>
      </SocketProvider>
    </LoggerProvider>
  );
});
