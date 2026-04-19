import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SocketProvider, SubscriptionProvider } from './providers';
import { AuthenticationProvider } from './providers/user/AuthenticationProvider';
import type { Logger } from '@anupheaus/common';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  /** When false, the socket is not created until connect() is called. Default: true. */
  autoConnect?: boolean;
  children?: ReactNode;
}

export const SocketAPI = createComponent('SocketAPI', ({
  host,
  name,
  logger,
  auth,
  autoConnect,
  children,
}: Props) => {
  return (
    <LoggerProvider logger={logger} loggerName={'socket-api'}>
      <SocketProvider host={host} name={name} auth={auth} autoConnect={autoConnect}>
        <SubscriptionProvider>
          <AuthenticationProvider>
            {children}
          </AuthenticationProvider>
        </SubscriptionProvider>
      </SocketProvider>
    </LoggerProvider>
  );
});
