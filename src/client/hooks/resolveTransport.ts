import type { SocketAPIAction } from '../../common';

export function resolveTransport(
  action: SocketAPIAction<string, unknown, unknown>,
  isConnected: boolean,
): 'socket' | 'rest' | 'wait' {
  const { transport } = action;
  const restOnly = transport != null && !transport.includes('socket');
  const socketOnly = transport != null && !transport.includes('rest');

  if (restOnly) return 'rest';
  if (socketOnly) return isConnected ? 'socket' : 'wait';
  // Default: prefer socket when connected, fall back to REST.
  return isConnected ? 'socket' : 'rest';
}
