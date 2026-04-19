import type { PromiseMaybe } from '@anupheaus/common';
import { Logger } from '@anupheaus/common';
import type { AnyHttpServer } from './internalModels';
import type { Koa } from './providers';
import { setupSocket, setupKoa } from './providers';
import type { SocketAPIServerAction } from './actions';
import { generateInternalActions } from './actions';
import type { Server, Socket } from 'socket.io';
export type { Server };
import type { SocketAPIClientLoggingService, SocketAPIUser } from '../common';
import type { SocketAPIServerSubscription } from './subscriptions';
import { setupHandlers } from './handler';
import Router from 'koa-router';
import { wrap, setConfig, setLogger } from './async-context/socketApiContext';
import type { SecurityConfig } from './security';
import { resolveSecurityConfig } from './security';
import { ConnectionRegistry } from './providers/connection';
import { cleanupSocketSubscriptions } from './subscriptions';

export interface ServerConfig {
  name: string;
  actions?: SocketAPIServerAction[];
  subscriptions?: SocketAPIServerSubscription[];
  logger?: Logger;
  server: AnyHttpServer;
  privateKey?: string; // used for encrypting the jwt tokens
  clientLoggingService?: SocketAPIClientLoggingService;
  // contextWrapper?<R>(delegate: () => (R | void)): (R | void);
  onStartup?(): PromiseMaybe<void>;
  /** Called once per client connection, BEFORE handlers are registered. Use to set up per-client state. */
  onClientConnecting?(client: Socket): PromiseMaybe<void>;
  onClientConnected?(client: Socket): PromiseMaybe<void>;
  onClientDisconnected?(client: Socket): PromiseMaybe<void>;
  /** Called before every action/subscription handler invocation. Awaited before the handler runs. */
  onBeforeHandle?(client: Socket): PromiseMaybe<void>;
  onSavePrivateKey?(client: Socket, user: SocketAPIUser, privateKey: string): PromiseMaybe<void>;
  onLoadPrivateKey?(client: Socket, user: SocketAPIUser): PromiseMaybe<string | undefined>;
  /** Called after the socket.io server is created, allowing consumers to register additional namespaces. */
  onRegisterNamespaces?(io: Server): PromiseMaybe<void>;
  onRegisterRoutes?(router: Router): PromiseMaybe<void>;
  security?: SecurityConfig;
}

export async function startServer(config: ServerConfig) {
  const {
    name,
    server,
    actions,
    subscriptions,
    logger: providedLogger,
    clientLoggingService,
    onClientConnecting,
    onClientConnected,
    onClientDisconnected,
    onRegisterRoutes,
  } = config;
  setConfig(config);
  const logger = providedLogger ?? new Logger('Socket-API');
  setLogger(logger);

  return logger.provide(async () => {
    const registry = new ConnectionRegistry();
    const app = setupKoa(server, registry, resolveSecurityConfig(config.security));
    if (onRegisterRoutes) await registerRoutes(app, onRegisterRoutes);
    const { onClientConnected: localOnClientConnected, io } = setupSocket(name, server, logger, clientLoggingService, registry);
    attachKoaFallbackToEngineIO(app, io, registry);
    if (config.onRegisterNamespaces) await config.onRegisterNamespaces(io);
    if (config.onStartup) await config.onStartup();
    const internalActions = generateInternalActions();
    localOnClientConnected(wrap(({ client }) => registry.fromSocket(client), ({ client }) => {
      onClientConnecting?.(client);
      setupHandlers([...internalActions, ...(actions ?? []), ...(subscriptions ?? [])]);
      onClientConnected?.(client);
      return wrap(innerClient => registry.fromSocket(innerClient), (innerClient: Socket) => {
        cleanupSocketSubscriptions(innerClient.id);
        onClientDisconnected?.(innerClient);
      });
    }));

    return {
      app,
      io,
    };
  });
}


async function registerRoutes(app: Koa, onRegisterRoutes: Required<ServerConfig>['onRegisterRoutes']) {
  const router = new Router();
  await onRegisterRoutes(router);
  app.use(router.routes());
}

/**
 * Attaches a fallback handler to the Engine.IO server so that non-transport requests are handled by Koa.
 * This avoids listener reordering and ensures Koa sees REST requests.
 * @param app Koa application instance
 * @param io Socket.IO server instance
 */
function attachKoaFallbackToEngineIO(app: Koa, io: Server, registry: ConnectionRegistry) {
  // Engine.IO intercepts all HTTP requests whose URL starts with /{name}/ (prefix matching).
  // io.engine.use() runs inside that handler before transport validation, so any request
  // without a `transport` query param is a plain REST request — pass it to Koa.
  // This avoids listener reordering entirely, which is important for HMR stability.
  // Note: koa-compose accesses app.middleware by reference, so the cached handler below
  // automatically sees routes added after this point (e.g. by the caller of startServer).
  const koaHandler = app.callback();
  io.engine.use(
    wrap(
      (req: any, res: any) => registry.fromRequest(req, res),
      (req: any, res: any, next: () => void) => {
        // Only Engine.IO handshakes set `transport`; empty string must not skip Koa (would hit verify → JSON error).
        if (req._query?.transport) { next(); return; }
        koaHandler(req, res);
      },
    ),
  );
}