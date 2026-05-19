import { useContext, useRef, useState } from 'react';
import { SocketContext } from './SocketContext';
import { useBound, useId, useLogger } from '@anupheaus/react-ui';
import { InternalError } from '@anupheaus/common';
import type { Socket } from 'socket.io-client';

export function useSocket() {
  const logger = useLogger();
  const { getSocket, getRawSocket, onConnectionStateChanged, connect: contextConnect, disconnect: contextDisconnect, on: contextOn, onExclusive: contextOnExclusive, off: contextOff } = useContext(SocketContext);
  const hookId = useId();
  const connectedCallback = useRef<(socket: Socket) => void>();
  const disconnectedCallback = useRef<() => void>();

  const getIsConnected = useBound(() => {
    const sck = getSocket();
    return sck != null && sck.connected === true;
  });

  const [isConnected, setIsConnected] = useState(() => getIsConnected());
  const updateWhenChangedRef = useRef(false);
  const [clientId, setClientId] = useState(() => getIsConnected() ? getSocket()?.id : undefined);

  onConnectionStateChanged((newIsConnected, socket) => {
    if (connectedCallback.current != null && socket != null && socket.connected === true) connectedCallback.current(socket);
    if (disconnectedCallback.current != null && socket != null && socket.connected === false) disconnectedCallback.current();
    if (!updateWhenChangedRef.current) return;
    setClientId(socket?.id);
    setIsConnected(newIsConnected);
  });

  const emit = useBound(async <ReturnType = void, DataType = unknown>(event: string, data: DataType): Promise<ReturnType> => {
    const socket = getSocket();
    if (socket == null) throw new InternalError('Socket is not connected');
    try {
      return socket.emitWithAck(event, data);
    } catch (error) {
      logger.error('Failed to emit an event using socket.io', { error });
      throw error;
    }
  });

  const on = useBound(<DataType = unknown, ReturnType = unknown>(event: string, callback: (data: DataType) => ReturnType) => contextOn(hookId, event, callback));

  const onExclusive = useBound(<DataType = unknown, ReturnType = unknown>(event: string, callback: (data: DataType) => ReturnType) => contextOnExclusive(hookId, event, callback));

  const off = useBound((event: string) => contextOff(hookId, event));

  const onConnected = (callback: (socket: Socket) => void) => {
    const shouldCall = connectedCallback.current == null;
    connectedCallback.current = callback;
    if (!shouldCall) return;
    const socket = getSocket();
    if (socket == null || socket.connected === false) return;
    callback(socket);
  };

  const onDisconnected = (callback: () => void) => {
    const shouldCall = disconnectedCallback.current == null;
    disconnectedCallback.current = callback;
    if (!shouldCall) return;
    const socket = getSocket();
    if (socket != null && socket.connected === true) return;
    callback();
  };

  return {
    get isConnected() { updateWhenChangedRef.current = true; return isConnected; },
    get clientId() { updateWhenChangedRef.current = true; return clientId; },
    getIsConnected,
    onConnected,
    onDisconnected,
    onConnectionStateChanged,
    getSocket,
    getRawSocket,
    emit,
    on,
    onExclusive,
    off,
    connect: contextConnect,
    disconnect: contextDisconnect,
  };
}