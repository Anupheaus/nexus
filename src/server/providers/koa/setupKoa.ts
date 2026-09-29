import type { IncomingMessage, ServerResponse } from 'http';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { createRequestLogger } from '../logger';
import type { AnyHttpServer } from '../../internalModels';
import { wrap } from '../../async-context/nexusContext';
import type { ConnectionRegistry } from '../connection';
import type { ResolvedSecurityConfig } from '../../security';
import { createOperatorKeyGuard, createSecurityMiddleware } from '../../security';

export { Koa };

export function setupKoa(server: AnyHttpServer, registry: ConnectionRegistry, security: ResolvedSecurityConfig): Koa {
  const app = new Koa();
  app.use(bodyParser({
    jsonLimit: `${security.maxBodySizeKb}kb`,
    formLimit: `${security.maxBodySizeKb}kb`,
  }));
  app.use(createRequestLogger());
  app.use(createSecurityMiddleware(security, app));
  // Last of the app-wide middleware, so ahead of every route: the body as the parser left it, before any route's
  // `to.deserialise`; after the security middleware, so CORS, rate limits and the request log still apply to a refusal
  app.use(createOperatorKeyGuard(security.operatorKeys));

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
