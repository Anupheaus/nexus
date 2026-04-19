import { createContext } from 'react';
import type { Socket } from 'socket.io-client';

function missingSocketProvider(usage: string) {
  return (): never => {
    throw new Error(`SocketProvider is required for ${usage}.`);
  };
}

function missingSocketProviderWithArgs(usage: string) {
  return (..._args: unknown[]): never => {
    throw new Error(`SocketProvider is required for ${usage}.`);
  };
}

export interface SocketContextProps {
  getSocket(): Socket | undefined;
  /** Returns socketRef.current regardless of connected state — for diagnostics only. */
  getRawSocket(): Socket | undefined;
  onConnectionStateChanged(callback: (isConnected: boolean, socket: Socket | undefined) => void, debugId?: string): void;
  testDisconnect(): void;
  testReconnect(): void;
  on<DataType = unknown, ReturnType = unknown>(hookId: string, event: string, callback: (data: DataType) => ReturnType): void;
  /** At most one handler per event; ack is the handler return value (not an array). For server-initiated actions only. */
  onExclusive<DataType = unknown, ReturnType = unknown>(hookId: string, event: string, callback: (data: DataType) => ReturnType): void;
  off(hookId: string, event: string): void;
}

export const SocketContext = createContext<SocketContextProps>({
  getSocket: missingSocketProvider('socket access — wrap the app with SocketAPI or SocketProvider'),
  getRawSocket: missingSocketProvider('raw socket access'),
  onConnectionStateChanged: missingSocketProviderWithArgs('connection state listeners'),
  testDisconnect: missingSocketProvider('testDisconnect'),
  testReconnect: missingSocketProvider('testReconnect'),
  on: missingSocketProviderWithArgs('event listeners (e.g. useEvent)'),
  onExclusive: missingSocketProviderWithArgs('useServerActionHandler'),
  off: missingSocketProviderWithArgs('removing event listeners'),
});
