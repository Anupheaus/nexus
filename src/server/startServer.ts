import type { PromiseMaybe } from '@anupheaus/common';
import { Logger } from '@anupheaus/common';
import type { AnyHttpServer } from './internalModels';
import type { Koa } from './providers';
import { setupSocket, setupKoa } from './providers';
import type { SocketAPIServerAction } from './actions';
import { registerRestActions } from './actions';
import type { Server, Socket } from 'socket.io';
export type { Server };
import type { SocketAPIClientLoggingService } from '../common';
import type { SocketAPIServerSubscription } from './subscriptions';
import { setupHandlers } from './handler';
import Router from 'koa-router';
import { wrap, setConfig, setLogger, setClient } from './async-context/socketApiContext';
import type { SecurityConfig } from './security';
import { resolveSecurityConfig } from './security';
import { ConnectionRegistry } from './providers/connection';
import { cleanupSocketSubscriptions } from './subscriptions';
import type { AuthConfig } from './auth';
import { setAuthConfig, registerAuthRoutes, validateSessionCookie } from './auth';
import { useAuthentication } from './providers/authentication/useAuthentication';
import type { SSLConfig } from './ssl';
import { createSSLServer } from './ssl';

export interface ServerConfig {
  /** Unique name for this server instance — must match the `name` passed to `SocketProvider` on the client. */
  name: string;
  /** Action handlers to register on startup. */
  actions?: SocketAPIServerAction[];
  /** Subscription handlers to register on startup. */
  subscriptions?: SocketAPIServerSubscription[];
  /** Logger instance. A default `'Socket-API'` logger is created when omitted. */
  logger?: Logger;
  /**
   * An existing HTTP or HTTPS server to attach to.
   * When provided, the caller is responsible for calling `server.listen()` and `server.close()`;
   * `startListening` and `stopListening` on the result are no-ops.
   * Mutually exclusive with `ssl`.
   */
  server?: AnyHttpServer;
  /**
   * SSL configuration. When provided, `startServer` creates and manages an HTTPS server internally.
   * Call `startListening()` on the result to begin accepting connections.
   * Falls back to plain HTTP if certificate creation fails.
   * Mutually exclusive with `server`.
   */
  ssl?: SSLConfig;
  /**
   * Port to listen on. Only applies when `ssl` is provided.
   * @default 443 when `ssl` is set, 80 otherwise.
   */
  port?: number;
  /** Authentication configuration. Returned from `defineAuthentication().configureAuthentication(...)`. */
  auth?: AuthConfig;
  /** Service used to forward client-side log entries to a remote logging backend. */
  clientLoggingService?: SocketAPIClientLoggingService;
  /** Called once after the server and socket infrastructure are fully initialised. */
  onStartup?(): PromiseMaybe<void>;
  /** Called for each incoming client connection, before event handlers are registered. Use to initialise per-client state. */
  onClientConnecting?(client: Socket): PromiseMaybe<void>;
  /** Called after event handlers have been registered for a client connection. */
  onClientConnected?(client: Socket): PromiseMaybe<void>;
  /** Called when a client disconnects. */
  onClientDisconnected?(client: Socket): PromiseMaybe<void>;
  /** Called before every action and subscription handler invocation. Awaited before the handler runs. */
  onBeforeHandle?(client: Socket): PromiseMaybe<void>;
  /** Called after the Socket.IO server is created. Use to register additional namespaces. */
  onRegisterNamespaces?(io: Server): PromiseMaybe<void>;
  /** Called after the default Koa router is set up. Use to register additional HTTP routes. */
  onRegisterRoutes?(router: Router): PromiseMaybe<void>;
  /** Rate limiting, CORS, and other security settings. */
  security?: SecurityConfig;
}

export interface StartServerResult {
  /** The Koa application instance. Use to attach additional middleware after `startServer` returns. */
  app: Koa;
  /** The Socket.IO server instance. */
  io: Server;
  /** The underlying HTTP or HTTPS server. */
  server: AnyHttpServer;
  /**
   * Begin accepting connections on the configured port.
   * Only meaningful when `ssl` was passed to `startServer`; no-op when an external `server` was provided.
   */
  startListening(): Promise<void>;
  /**
   * Destroy all open connections and close the server.
   * Only meaningful when `ssl` was passed to `startServer`; no-op when an external `server` was provided.
   */
  stopListening(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<StartServerResult> {
  const {
    name,
    actions,
    subscriptions,
    logger: providedLogger,
    clientLoggingService,
    onClientConnecting,
    onClientConnected,
    onClientDisconnected,
    onRegisterRoutes,
    auth,
  } = config;

  setConfig(config);
  if (auth) setAuthConfig(auth);

  const logger = providedLogger ?? new Logger('Socket-API');
  setLogger(logger);

  let server: AnyHttpServer;
  let startListening: () => Promise<void>;
  let stopListening: () => Promise<void>;

  const port = config.port ?? (config.ssl != null ? 443 : 80);

  if (config.server != null) {
    server = config.server;
    startListening = () => Promise.resolve();
    stopListening = () => Promise.resolve();
  } else if (config.ssl != null) {
    const { host = 'localhost', certsPath = './certs' } = config.ssl;
    const result = await createSSLServer({ host, port, certsPath, logger });
    server = result.server;
    startListening = result.startListening;
    stopListening = result.stopListening;
  } else {
    throw new Error('Either server or ssl must be provided to startServer');
  }

  return logger.provide(async () => {
    const registry = new ConnectionRegistry();
    const app = setupKoa(server, registry, resolveSecurityConfig(config.security));

    const router = new Router();
    const authActions = auth ? registerAuthRoutes(auth) : [];
    registerRestActions(router, name, registry, [...(actions ?? []), ...authActions]);
    if (onRegisterRoutes) await onRegisterRoutes(router);
    app.use(router.routes());

    const { onClientConnected: localOnClientConnected, io } = setupSocket(name, server, logger, clientLoggingService, registry);
    attachKoaFallbackToEngineIO(app, io, registry);
    if (config.onRegisterNamespaces) await config.onRegisterNamespaces(io);
    if (config.onStartup) await config.onStartup();

    if (auth) {
      // Run auth in socket.io middleware so it completes BEFORE the 'connection' event fires.
      // This guarantees that by the time we register event handlers, no client emits can race
      // ahead of handler setup — socket.io only delivers 'connect' to the client after the
      // connection handler (and thus handler registration) has run synchronously.
      io.use(wrap((socket: Socket) => registry.fromSocket(socket), async (socket: Socket, next: (err?: Error) => void) => {
        setClient(socket);
        try {
          const { setUser } = useAuthentication();
          await validateSessionCookie(socket, auth.store, auth.onGetUser, async (user, sessionToken) => {
            await setUser(user, sessionToken);
          });
          next();
        } catch (err) {
          next(err as Error);
        }
      }));
    }

    localOnClientConnected(wrap(({ client }) => registry.fromSocket(client), ({ client }) => {
      onClientConnecting?.(client);
      setupHandlers([...(actions ?? []), ...(subscriptions ?? [])]);
      onClientConnected?.(client);

      return wrap(innerClient => registry.fromSocket(innerClient), (innerClient: Socket) => {
        cleanupSocketSubscriptions(innerClient.id);
        onClientDisconnected?.(innerClient);
      });
    }));

    return { app, io, server, startListening, stopListening };
  });
}

function attachKoaFallbackToEngineIO(app: Koa, io: Server, registry: ConnectionRegistry) {
  const koaHandler = app.callback();
  io.engine.use(
    wrap(
      (req: any, res: any) => registry.fromRequest(req, res),
      (req: any, res: any, next: () => void) => {
        if (req._query?.transport) { next(); return; }
        koaHandler(req, res);
      },
    ),
  );
}
