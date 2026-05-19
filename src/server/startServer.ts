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
  name: string;
  actions?: SocketAPIServerAction[];
  subscriptions?: SocketAPIServerSubscription[];
  logger?: Logger;
  /** Provide an existing HTTP/HTTPS server. Mutually exclusive with `ssl`. */
  server?: AnyHttpServer;
  /** SSL configuration — when provided, startServer creates and manages the HTTPS server lifecycle. Mutually exclusive with `server`. */
  ssl?: SSLConfig;
  auth?: AuthConfig;
  clientLoggingService?: SocketAPIClientLoggingService;
  onStartup?(): PromiseMaybe<void>;
  /** Called once per client connection, BEFORE handlers are registered. Use to set up per-client state. */
  onClientConnecting?(client: Socket): PromiseMaybe<void>;
  onClientConnected?(client: Socket): PromiseMaybe<void>;
  onClientDisconnected?(client: Socket): PromiseMaybe<void>;
  /** Called before every action/subscription handler invocation. Awaited before the handler runs. */
  onBeforeHandle?(client: Socket): PromiseMaybe<void>;
  /** Called after the socket.io server is created, allowing consumers to register additional namespaces. */
  onRegisterNamespaces?(io: Server): PromiseMaybe<void>;
  onRegisterRoutes?(router: Router): PromiseMaybe<void>;
  security?: SecurityConfig;
}

export interface StartServerResult {
  app: Koa;
  io: Server;
  /** The underlying HTTP/HTTPS server. */
  server: AnyHttpServer;
  /** Start listening on the configured port. Only meaningful when `ssl` was passed to `startServer`; no-op when an external `server` was provided. */
  startListening(): Promise<void>;
  /** Stop listening and close all connections. Only meaningful when `ssl` was passed to `startServer`; no-op when an external `server` was provided. */
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

  if (config.server != null) {
    server = config.server;
    startListening = () => Promise.resolve();
    stopListening = () => Promise.resolve();
  } else if (config.ssl != null) {
    const { host = 'localhost', port = 3000, certsPath = './certs', logger: sslLogger } = config.ssl;
    const result = await createSSLServer({ host, port, certsPath, logger: sslLogger ?? logger });
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
