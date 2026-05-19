import type Koa from 'koa';
import { ApiError } from '@anupheaus/common';
import { useLogger } from '../../async-context/nexusContext';

export function createRequestLogger(): Koa.Middleware {
  const logger = useLogger();
  return async (ctx, next) => {
    try {
      logger.silly('Request started', { method: ctx.method, path: ctx.path });
      const start = Date.now();
      const result = await next();
      const duration = Date.now() - start;
      logger.info(`${ctx.method} Request handled: ${ctx.path} (${ctx.status}, ${duration}ms)`, { method: ctx.method, path: ctx.path, status: ctx.status, duration });
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        ctx.status = error.statusCode ?? 500;
        ctx.body = error.message;
      } else {
        ctx.status = 500;
        ctx.body = 'Internal server error';
      }
      logger.error(`Error handling ${ctx.method} request: ${ctx.path} (${ctx.status})`, { method: ctx.method, path: ctx.path, status: ctx.status, message: ctx.body });
    }
  };
}