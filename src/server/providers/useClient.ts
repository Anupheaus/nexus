import type { Socket } from 'socket.io';
import { internalUseSocket } from './socket';

export function useClient(): Socket | undefined {
  return internalUseSocket().getClient();
}
