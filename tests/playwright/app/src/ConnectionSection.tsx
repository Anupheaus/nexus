import React from 'react';
import { useSocket } from '../../../../src/client/providers/socket/useSocket';

export function ConnectionSection() {
  const { isConnected, connect, disconnect } = useSocket();

  return (
    <section>
      <h2>Connection</h2>
      <div data-testid="connection-status">{isConnected ? 'connected' : 'disconnected'}</div>
      <button data-testid="connect-btn" onClick={connect}>Connect</button>
      <button data-testid="disconnect-btn" onClick={disconnect}>Disconnect</button>
    </section>
  );
}
