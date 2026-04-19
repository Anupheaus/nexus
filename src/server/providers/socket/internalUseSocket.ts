import type { Socket } from 'socket.io';
import { useClient } from '../../async-context';

export function internalUseSocket() {
  function getClient(): Socket | undefined;
  function getClient(isRequired: true): Socket;
  function getClient(isRequired: false): Socket | undefined;
  function getClient(isRequired = false): Socket | undefined {
    const client = useClient();
    if (client == null && isRequired) throw new Error('Socket client is not available at this location.');
    return client;
  }

  return { getClient };
}
