import { createComponent, useBound, useId, useLogger, useMap, useOnUnmount } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SocketContextProps } from './SocketContext';
import { SocketContext } from './SocketContext';
import type { Unsubscribe } from '@anupheaus/common';
import { InternalError, Logger, type AnyFunction } from '@anupheaus/common';
import { createClientSocket } from './createClientSocket';
import type { TokenStorage } from './tokenStorage';

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
  /** When false, the socket is not created until connect() is called. Default: true. */
  autoConnect?: boolean;
  /** Optional token storage for environments that cannot rely on HttpOnly cookies (e.g. Capacitor). */
  tokenStorage?: TokenStorage;
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

const AUTH_CHECK_TIMEOUT_MS = 10_000;

export const SocketProvider = createComponent('SocketProvider', ({
  host,
  name,
  auth,
  autoConnect,
  tokenStorage,
  children,
}: Props) => {
  const logger = useLogger();
  const registeredEvents = useMap<string, EventHandler>();
  const [uniqueConnectionId, setUniqueConnectionId] = useState('');
  const socketRef = useRef<Socket>();
  const unsubscribeListenerRef = useRef<Unsubscribe>(() => void 0);
  /** Set to true before calling setUniqueConnectionId() to indicate the new socket should auto-connect. */
  const reconnectRef = useRef(false);
  /** True once connect() has been called (or autoConnect is true). Gates socket creation in useMemo. */
  const connectRef = useRef(autoConnect !== false);
  /** Pending promise callbacks from an in-flight connect() call. */
  const connectPromiseRef = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);
  /** True once the current socket has received nexus:authCheckComplete from the server. */
  const authCheckCompletedRef = useRef(false);
  /** Callbacks waiting for the current socket's auth check to complete. */
  const authCheckCallbacksRef = useRef<Array<() => void>>([]);

  const getSocket = () => {
    const sck = socketRef.current;
    if (sck == null) throw new InternalError('Socket is not available yet.');
    return sck;
  };

  const connectionCallbacks = useMap<string, CallbackRecord>();

  const disconnectSocket = useBound(() => {
    const socket = socketRef.current;
    if (socket == null) return;
    Array.from(registeredEvents.entries()).forEach(([event, { socketHandler }]) => socket.removeListener(event, socketHandler));
    socket.disconnect();
  });

  useMemo(() => {
    if (!connectRef.current && !reconnectRef.current) return;
    const prevSocket = socketRef.current;
    if (prevSocket?.connected) disconnectSocket();
    logger.info('Connecting socket to server...', { prevSocketId: prevSocket?.id, prevConnected: prevSocket?.connected ?? false, uniqueConnectionId });
    diagLog('useMemo: creating socket', { uniqueConnectionId, prevSocketId: prevSocket?.id, prevConnected: prevSocket?.connected ?? false });

    // Reset auth check state for the new socket; resolve any callbacks still waiting on the
    // old socket so they don't hang (callers will find isAuthenticated still false and proceed
    // with interactive sign-in as normal).
    authCheckCompletedRef.current = false;
    const pendingAuthCallbacks = authCheckCallbacksRef.current;
    authCheckCallbacksRef.current = [];
    pendingAuthCallbacks.forEach(cb => cb());

    const sck = createClientSocket({ host, name, logger, auth, tokenStorage });
    let isConnected = false;

    sck.on('connect', () => {
      if (isConnected) return; // prevent multiple calls
      isConnected = true;
      connectPromiseRef.current?.resolve();
      connectPromiseRef.current = null;
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
          socket.emit('nexus.log', entries);
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
      // Reject on first connect_error; Socket.IO may still retry internally, but the promise
      // contract is: "did the initial attempt succeed?" Callers must call connect() again to retry.
      connectPromiseRef.current?.reject(error);
      connectPromiseRef.current = null;
    });

    sck.on('nexus:authCheckComplete', () => {
      authCheckCompletedRef.current = true;
      const callbacks = authCheckCallbacksRef.current;
      authCheckCallbacksRef.current = [];
      callbacks.forEach(cb => cb());
    });

    reconnectRef.current = false;
    diagLog('socket.connect() called', { uniqueConnectionId });
    sck.connect();
    socketRef.current = sck;
  }, [uniqueConnectionId, host, name, auth, tokenStorage]);

  const context = useMemo<SocketContextProps>(() => {
    function wireSocketListener(event: string, registeredEvent: EventHandler) {
      registeredEvents.set(event, registeredEvent);
      const callback = (isConnected: boolean, socket: Socket | undefined) => {
        if (!isConnected || socket == null) return;
        socket.on(event, registeredEvent.socketHandler);
      };
      connectionCallbacks.set(event, { callback });
      const localSocket = socketRef.current;
      if (localSocket != null) callback(localSocket.connected, localSocket);
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
              response(await list[0]!(data));
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
        const socket = socketRef.current;
        if (socket == null || !socket.connected) return undefined;
        return socket;
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
          const socket = socketRef.current;
          if (debugId) logger.silly('Calling connection state change callback', { callbackId, debugId, connected: socket?.connected ?? false });
          if (socket?.connected) boundCallback(true, socket); else boundCallback(false, undefined);
          return () => {
            if (debugId) logger.silly('Deleting connection state change callback', { callbackId, debugId });
            connectionCallbacks.delete(callbackId);
          };
        }, []);
      },
      waitForAuthCheck() {
        if (authCheckCompletedRef.current) return Promise.resolve();
        return new Promise<void>(resolve => {
          let timer: ReturnType<typeof setTimeout>;
          const callback = () => {
            clearTimeout(timer);
            resolve();
          };
          timer = setTimeout(() => {
            authCheckCallbacksRef.current = authCheckCallbacksRef.current.filter(cb => cb !== callback);
            resolve();
          }, AUTH_CHECK_TIMEOUT_MS);
          authCheckCallbacksRef.current.push(callback);
        });
      },
      reconnect() {
        const socket = socketRef.current;
        logger.info('reconnect called', { socketId: socket?.id, connected: socket?.connected });
        diagLog('reconnect called', { socketId: socket?.id, connected: socket?.connected });
        if (socket?.connected) disconnectSocket();
        reconnectRef.current = true;
        setUniqueConnectionId(Math.uniqueId());
      },
      connect() {
        const socket = socketRef.current;
        if (socket?.connected) {
          logger.warn('connect() called but socket is already connected');
          return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
          connectPromiseRef.current?.reject(new Error('connect() superseded by a newer connect() call'));
          connectPromiseRef.current = { resolve, reject };
          if (socket != null) {
            // Reuse the existing socket — triggers Manager.open() on the same decoder,
            // exercising the same auto-reconnect code path as a real network drop.
            socket.connect();
          } else {
            connectRef.current = true;
            setUniqueConnectionId(Math.uniqueId());
          }
        });
      },
      disconnect() {
        const socket = socketRef.current;
        if (socket == null || !socket.connected) {
          logger.warn('disconnect() called but socket is not connected');
          return Promise.resolve();
        }
        disconnectSocket();
        return Promise.resolve();
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


  useOnUnmount(() => {
    connectPromiseRef.current?.reject(new Error('SocketProvider unmounted'));
    connectPromiseRef.current = null;
    disconnectSocket();
  });

  return (
    <SocketContext.Provider value={context}>
      {children}
    </SocketContext.Provider>
  );
});
