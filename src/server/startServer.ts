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
import { wrap, setConfig, setLogger } from './async-context/socketApiContext';
import type { SecurityConfig } from './security';
import { resolveSecurityConfig } from './security';
import { ConnectionRegistry } from './providers/connection';
import { cleanupSocketSubscriptions } from './subscriptions';
import type { AuthConfig } from './auth';
import { setAuthConfig, registerAuthRoutes, validateSessionCookie } from './auth';
import { useAuthentication } from './providers/authentication/useAuthentication';

export interface ServerConfig {
  name: string;
  actions?: SocketAPIServerAction[];
  subscriptions?: SocketAPIServerSubscription[];
  logger?: Logger;
  server: AnyHttpServer;
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
    auth,
  } = config;

  setConfig(config);
  if (auth) setAuthConfig(auth);

  const logger = providedLogger ?? new Logger('Socket-API');
  setLogger(logger);

  return logger.provide(async () => {
    const registry = new ConnectionRegistry();
    const app = setupKoa(server, registry, resolveSecurityConfig(config.security));

    const router = new Router();
    if (auth) registerAuthRoutes(router, name, auth);
    registerRestActions(router, name, registry);
    if (onRegisterRoutes) await onRegisterRoutes(router);
    app.use(router.routes());

    const { onClientConnected: localOnClientConnected, io } = setupSocket(name, server, logger, clientLoggingService, registry);
    attachKoaFallbackToEngineIO(app, io, registry);
    if (config.onRegisterNamespaces) await config.onRegisterNamespaces(io);
    if (config.onStartup) await config.onStartup();

    localOnClientConnected(wrap(({ client }) => registry.fromSocket(client), async ({ client }) => {
      onClientConnecting?.(client);

      if (auth) {
        const { setUser } = useAuthentication();
        const isValid = await validateSessionCookie(client, auth.store, auth.onGetUser, async user => {
          await setUser(user);
        });
        if (!isValid) return;
      }

      setupHandlers([...(actions ?? []), ...(subscriptions ?? [])]);
      onClientConnected?.(client);

      return wrap(innerClient => registry.fromSocket(innerClient), (innerClient: Socket) => {
        cleanupSocketSubscriptions(innerClient.id);
        onClientDisconnected?.(innerClient);
      });
    }));

    return { app, io };
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
