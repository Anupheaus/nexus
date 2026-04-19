import type { IncomingMessage, ServerResponse } from 'http';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { createRequestLogger } from '../logger';
import type { AnyHttpServer } from '../../internalModels';
import { wrap } from '../../async-context/socketApiContext';
import type { ConnectionRegistry } from '../connection';
import type { ResolvedSecurityConfig } from '../../security';
import { createSecurityMiddleware } from '../../security';

export { Koa };

export function setupKoa(server: AnyHttpServer, registry: ConnectionRegistry, security: ResolvedSecurityConfig): Koa {
  const app = new Koa();
  app.use(bodyParser({
    jsonLimit: `${security.maxBodySizeKb}kb`,
    formLimit: `${security.maxBodySizeKb}kb`,
  }));
  app.use(createRequestLogger());
  app.use(createSecurityMiddleware(security, app));

  const handler = app.callback();
  server.on(
    'request',
    wrap(
      (req: IncomingMessage, res: ServerResponse) => registry.fromRequest(req, res),
      (req: IncomingMessage, res: ServerResponse) => {
        handler(req, res);
      },
    ),
  );

  return app;
}
