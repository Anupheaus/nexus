import { io, type Socket } from 'socket.io-client';
import type { PromiseMaybe } from '@anupheaus/common';
import { Logger, is } from '@anupheaus/common';
import type { NexusAction, NexusEvent, NexusSubscription } from '../../src/common';
import { SocketIOParser } from '../../src/common';
import { actionPrefix, eventPrefix, subscriptionPrefix } from '../../src/common/internalModels';
import { wrapAckHandler } from '../../src/common/ackResponse';

function decodeResponse<T>(raw: unknown): T {
  if (is.plainObject(raw) && 'error' in raw) {
    const err = (raw as { error: unknown; }).error;
    const message = err instanceof Error ? err.message
      : (is.plainObject(err) && typeof (err as Record<string, unknown>).message === 'string')
        ? (err as Record<string, unknown>).message as string
        : String(err);
    throw new Error(message);
  }
  return raw as T;
}

export type TestClientOptions = {
  /** Forwarded to socket.io-client (e.g. `Cookie` after an HTTP request). */
  extraHeaders?: Record<string, string>;
};

/**
 * Typed test client — wraps socket.io-client using the library's contract types so tests
 * break at compile time if contracts change, rather than silently at runtime.
 */
export class TestClient {
  constructor(
    port: number,
    socketName: string,
    auth?: Record<string, string>,
    options?: TestClientOptions,
  ) {
    const logger = new Logger('socket-api-e2e-testclient');
    this.socket = io(`http://localhost:${port}`, {
      path: `/${socketName}`,
      transports: ['websocket'],
      autoConnect: false,
      auth,
      extraHeaders: options?.extraHeaders,
      parser: new SocketIOParser({ logger }),
      forceBase64: true,
      forceNew: true,
    });
  }

  private socket: Socket;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);
      this.socket.connect();
    });
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  get isConnected(): boolean {
    return this.socket.connected;
  }

  get rawSocket(): Socket {
    return this.socket;
  }

  async call<Name extends string, Req, Res>(action: NexusAction<Name, Req, Res>, request?: Req): Promise<Res> {
    const raw = await this.socket.emitWithAck(`${actionPrefix}.${action.name}`, request);
    return decodeResponse<Res>(raw);
  }

  async subscribe<Name extends string, Req, Res>(
    subscription: NexusSubscription<Name, Req, Res>,
    request: Req,
    subscriptionId = `sub-${Date.now()}-${Math.random()}`,
  ): Promise<{ subscriptionId: string; initial: Res; }> {
    const raw = await this.socket.emitWithAck(`${subscriptionPrefix}.${subscription.name}`, {
      action: 'subscribe',
      request,
      subscriptionId,
    });
    const result = decodeResponse<{ subscriptionId: string; response: Res; }>(raw);
    return { subscriptionId: result.subscriptionId, initial: result.response };
  }

  async unsubscribe<Name extends string, Req, Res>(
    subscription: NexusSubscription<Name, Req, Res>,
    subscriptionId: string,
  ): Promise<void> {
    const raw = await this.socket.emitWithAck(`${subscriptionPrefix}.${subscription.name}`, {
      action: 'unsubscribe',
      subscriptionId,
    });
    decodeResponse(raw);
  }

  /**
   * Handles a server-initiated action (`useAction` on server). Must be registered before the server invokes it.
   * Mirrors client `useServerActionHandler` ack behaviour.
   */
  registerServerActionHandler<Name extends string, Req, Res>(
    action: NexusAction<Name, Req, Res>,
    handler: (request: Req) => PromiseMaybe<Res>,
  ): () => void {
    const eventName = `${actionPrefix}.${action.name}`;
    const listener = async (data: unknown, ack: (result: unknown) => void) => {
      const out = await wrapAckHandler(async () => handler(data as Req));
      ack(out);
    };
    this.socket.on(eventName, listener);
    return () => this.socket.off(eventName, listener);
  }

  /**
   * Listens for server `useEvent` / `emitWithAck` deliveries. Invokes the Socket.IO ack so the server can await.
   */
  onEvent<T>(event: NexusEvent<T>, handler: (payload: T) => void): () => void {
    const eventName = `${eventPrefix}.${event.name}`;
    const listener = (...args: unknown[]) => {
      let ack: ((...a: unknown[]) => void) | undefined;
      let raw: unknown;
      if (args.length > 0 && typeof args[args.length - 1] === 'function') {
        ack = args[args.length - 1] as (...a: unknown[]) => void;
        raw = args.length === 2 ? args[0] : args.slice(0, -1).length === 1 ? args[0] : args.slice(0, -1);
      } else {
        raw = args[0];
      }
      const payload = (raw === undefined || raw === null
        ? undefined
        : typeof raw === 'string'
          ? JSON.parse(raw)
          : raw) as T;
      handler(payload);
      ack?.(null);
    };
    this.socket.on(eventName, listener);
    return () => this.socket.off(eventName, listener);
  }

  onSubscriptionUpdate<Name extends string, Req, Res>(
    subscription: NexusSubscription<Name, Req, Res>,
    subscriptionId: string,
    handler: (response: Res) => void,
  ): () => void {
    const listener = (raw: unknown) => {
      const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { subscriptionId?: string; response?: Res; };
      if (data?.subscriptionId === subscriptionId && data?.response != null) handler(data.response);
    };
    const channel = `${subscriptionPrefix}.${subscription.name}`;
    this.socket.on(channel, listener as (raw: unknown, ...args: unknown[]) => void);
    return () => this.socket.off(channel, listener as (raw: unknown, ...args: unknown[]) => void);
  }

  /** Forwards batched log lines to the server `clientLoggingService` pipeline (`nexus.log`). */
  emitClientLog(entries: unknown[]): void {
    this.socket.emit('nexus.log', entries);
  }
}
