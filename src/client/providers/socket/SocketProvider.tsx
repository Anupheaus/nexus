import { createComponent, useBound, useId, useLogger, useMap, useOnUnmount } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SocketContextProps } from './SocketContext';
import { SocketContext } from './SocketContext';
import type { Unsubscribe } from '@anupheaus/common';
import { InternalError, Logger, type AnyFunction } from '@anupheaus/common';
import { createClientSocket } from './createClientSocket';

interface CallbackRecord {
  callback: (isConnected: boolean, socket: Socket | undefined) => void;
  debugId?: string;
}

interface EventHandler {
  /** When true, exactly one handler; ack is that handler's return value (safe for array responses). */
  exclusive: boolean;
  socketHandler: AnyFunction;
  handlers: Map<string, AnyFunction>;
}

interface Props {
  host?: string;
  name: string;
  /** Auth object passed in socket.io handshake (available as socket.handshake.auth on the server). */
  auth?: Record<string, string>;
  children?: ReactNode;
}

/** File-based diagnostic logger. No-op unless MXDB_DIAG_FILE env var is set. Safe to call in any context. */
function diagLog(message: string, data?: Record<string, unknown>): void {
  if (typeof process === 'undefined') return;
  const file = (process as any).env?.MXDB_DIAG_FILE as string | undefined;
  if (!file) return;
  try {
    // Dynamic require keeps this out of browser bundles (tree-shaken by webpack browser target).
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports
    const { appendFileSync } = require('fs') as typeof import('fs');
    const ts = (process as any).hrtime.bigint().toString();
    const iso = new Date().toISOString();
    const pid = (process as any).pid ?? '?';
    const line = `${ts}\t${iso}\t[pid:${pid}]\tsocket-provider\t${message}\t${data ? JSON.stringify(data) : ''}\n`;
    appendFileSync(file, line);
  } catch { /* ignore */ }
}

export const SocketProvider = createComponent('SocketProvider', ({
  host,
  name,
  auth,
  children,
}: Props) => {
  const logger = useLogger();
  const registeredEvents = useMap<string, EventHandler>();
  const [uniqueConnectionId, setUniqueConnectionId] = useState('');
  const socketRef = useRef<Socket>();
  const unsubscribeListenerRef = useRef<Unsubscribe>(() => void 0);
  /** Set to true before calling setUniqueConnectionId() to indicate the new socket should auto-connect. */
  const reconnectRef = useRef(false);

  const getSocket = () => {
    const sck = socketRef.current;
    if (sck == null) throw new InternalError('Socket is not available yet.');
    return sck;
  };

  const connectionCallbacks = useMap<string, CallbackRecord>();

  const disconnectSocket = useBound(() => {
    const socket = getSocket();
    Array.from(registeredEvents.entries()).forEach(([event, { socketHandler }]) => socket.removeListener(event, socketHandler));
    socket.disconnect();
  });

  useMemo(() => {
    const prevSocket = socketRef.current;
    if (prevSocket?.connected) disconnectSocket();
    logger.info('Connecting socket to server...', { prevSocketId: prevSocket?.id, prevConnected: prevSocket?.connected ?? false, uniqueConnectionId });
    diagLog('useMemo: creating socket', { uniqueConnectionId, prevSocketId: prevSocket?.id, prevConnected: prevSocket?.connected ?? false });
    const sck = createClientSocket(host, name, logger, auth);
    let isConnected = false;

    sck.on('connect', () => {
      if (isConnected) return; // prevent multiple calls
      isConnected = true;
      logger.info('Socket connect event fired', { socketId: sck.id, isRef: socketRef.current === sck });
      diagLog('socket connect event', { socketId: sck.id, isRef: socketRef.current === sck });
      unsubscribeListenerRef.current();
      unsubscribeListenerRef.current = Logger.registerListener({
        sendInterval: {
          seconds: 2,
        },
        maxEntries: 100,
        onTrigger: entries => {
          const socket = getSocket();
          socket.emit('mxdb.log', entries);
        },
      });
      logger.always('Socket connected to server', { id: sck.id });
      connectionCallbacks.forEach(({ callback, debugId }, callbackId) => {
        if (debugId) logger.silly('Calling connection state change callback from connect', { callbackId, debugId, connected: true });
        callback(true, sck);
      });
    });
    sck.on('disconnect', reason => {
      if (!isConnected) return; // prevent multiple calls
      isConnected = false;
      unsubscribeListenerRef.current();
      logger.debug('Socket disconnected from server', { id: sck.id, reason, isRef: socketRef.current === sck });
      diagLog('socket disconnect event', { socketId: sck.id, reason, isRef: socketRef.current === sck });
      connectionCallbacks.forEach(({ callback, debugId }, callbackId) => {
        if (debugId) logger.silly('Calling connection state change callback from connect', { callbackId, debugId, connected: false });
        callback(false, undefined);
      });
    });
    sck.on('connect_error', error => {
      logger.error(`Socket connection error: ${error.message}`, { error });
      const errData: Record<string, unknown> = { message: error.message };
      try {
        const cause = (error as any).cause;
        if (cause != null) errData.cause = String(cause?.message ?? cause?.code ?? cause);
        errData.code = (error as any).code ?? (cause as any)?.code;
      } catch { /* ignore */ }
      diagLog('socket connect_error', { socketId: sck.id, ...errData });
    });

    // Connect if this is the initial mount OR an explicit reconnect request.
    const shouldConnect = uniqueConnectionId === '' || reconnectRef.current;
    reconnectRef.current = false;
    if (shouldConnect) {
      diagLog('socket.connect() called', { uniqueConnectionId, shouldConnect });
      sck.connect();
    }
    socketRef.current = sck;
  }, [uniqueConnectionId, name, auth]);

  const context = useMemo<SocketContextProps>(() => {
    function wireSocketListener(event: string, registeredEvent: EventHandler) {
      registeredEvents.set(event, registeredEvent);
      const callback = (isConnected: boolean, socket: Socket | undefined) => {
        if (!isConnected || socket == null) return;
        socket.on(event, registeredEvent.socketHandler);
      };
      connectionCallbacks.set(event, { callback });
      const localSocket = getSocket();
      callback(localSocket.connected, localSocket);
    }

    function registerHandler(hookId: string, event: string, handler: AnyFunction, exclusive: boolean) {
      const callbackId = `${hookId}-${event}`;
      let registeredEvent = registeredEvents.get(event);

      if (exclusive) {
        if (registeredEvent != null) {
          if (!registeredEvent.exclusive) {
            throw new InternalError(`Cannot register a server action handler on "${event}": this event already has multicast listeners.`);
          }
          if (registeredEvent.handlers.size >= 1) {
            throw new InternalError(`Only one useServerActionHandler is allowed per action; duplicate registration for "${event}".`);
          }
        }
      } else if (registeredEvent != null && registeredEvent.exclusive) {
        throw new InternalError(`Cannot add listener on "${event}": this event is reserved for a single server action handler (useServerActionHandler).`);
      }

      if (registeredEvent == null) {
        const handlers = new Map<string, AnyFunction>();
        registeredEvent = {
          exclusive,
          handlers,
          socketHandler: exclusive
            ? async (data: any, response: AnyFunction) => {
              const list = Array.from(handlers.values());
              if (list.length !== 1) throw new InternalError(`Exclusive handler missing for "${event}".`);
              response(await list[0](data));
            }
            : async (data: any, response: AnyFunction) =>
              response(await Array.from(handlers.values()).mapAsync(innerHandler => innerHandler(data))),
        };
        wireSocketListener(event, registeredEvent);
      }

      registeredEvent.handlers.set(callbackId, handler);
    }

    return {
      name,
      getSocket() {
        const socket = getSocket();
        if (socket.connected) return socket;
      },
      getRawSocket() {
        return socketRef.current;
      },
      onConnectionStateChanged(callback, debugId) {
        const callbackId = useId();
        const boundCallback = useBound(callback);
        if (debugId) logger.silly('Registering connection state change callback', { callbackId, debugId });
        connectionCallbacks.set(callbackId, { callback: boundCallback, debugId });
        useLayoutEffect(() => {
          const socket = getSocket();
          if (debugId) logger.silly('Calling connection state change callback', { callbackId, debugId, connected: socket.connected });
          if (socket.connected) boundCallback(true, socket); else boundCallback(false, undefined);
          return () => {
            if (debugId) logger.silly('Deleting connection state change callback', { callbackId, debugId });
            connectionCallbacks.delete(callbackId);
          };
        }, []);
      },
      reconnect() {
        const socket = socketRef.current;
        logger.info('reconnect called', { socketId: socket?.id, connected: socket?.connected });
        diagLog('reconnect called', { socketId: socket?.id, connected: socket?.connected });
        if (socket?.connected) disconnectSocket();
        reconnectRef.current = true;
        setUniqueConnectionId(Math.uniqueId());
      },
      testDisconnect() {
        const s = socketRef.current;
        logger.info('testDisconnect called', { socketId: s?.id, connected: s?.connected });
        diagLog('testDisconnect called', { socketId: s?.id, connected: s?.connected });
        disconnectSocket();
      },
      testReconnect() {
        const socket = socketRef.current;
        logger.info('testReconnect called', { socketId: socket?.id, connected: socket?.connected });
        diagLog('testReconnect called', { socketId: socket?.id, connected: socket?.connected });
        if (socket == null || socket.connected) return;
        // Create a fresh socket rather than re-using the disconnected one.
        // socket.connect() on an already-disconnect()ed socket is unreliable across
        // socket.io versions, so we force socket recreation via state change.
        reconnectRef.current = true;
        setUniqueConnectionId(Math.uniqueId());
      },
      on(hookId, event, handler) {
        registerHandler(hookId, event, handler, false);
      },
      onExclusive(hookId, event, handler) {
        registerHandler(hookId, event, handler, true);
      },
      off(hookId, event) {
        const callbackId = `${hookId}-${event}`;
        const registeredEvent = registeredEvents.get(event);
        if (registeredEvent == null) return;
        registeredEvent.handlers.delete(callbackId);
        if (registeredEvent.handlers.size === 0) {
          const socket = socketRef.current;
          if (socket != null) socket.off(event, registeredEvent.socketHandler);
          registeredEvents.delete(event);
          connectionCallbacks.delete(event);
        }
      },
    };
  }, []);


  useOnUnmount(() => disconnectSocket());

  return (
    <SocketContext.Provider value={context}>
      {children}
    </SocketContext.Provider>
  );
});
