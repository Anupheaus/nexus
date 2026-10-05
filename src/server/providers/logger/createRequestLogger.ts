import type Koa from 'koa';
import { ApiError } from '@anupheaus/common';
import { useLogger } from '../../async-context/nexusContext';

const CLIENT_ERROR_STATUS = 400;
const SERVER_ERROR_STATUS = 500;

/** Browser-fetched files; a successful one adds a log line per page load and says nothing a developer needs. */
const STATIC_ASSET_PATTERN = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|json|txt|webmanifest|wasm)$/i;

function isStaticAsset(path: string): boolean {
  return STATIC_ASSET_PATTERN.test(path);
}

/**
 * Picks the level for a finished request. Successful requests are debug (one per request would dominate ingest),
 * client errors warn and server errors error so they always surface.
 */
function getRequestLogLevel(status: number): 'debug' | 'warn' | 'error' {
  if (status >= SERVER_ERROR_STATUS) return 'error';
  if (status >= CLIENT_ERROR_STATUS) return 'warn';
  return 'debug';
}

export function createRequestLogger(): Koa.Middleware {
  const logger = useLogger();
  return async (ctx, next) => {
    try {
      logger.silly('Request started', { method: ctx.method, path: ctx.path });
      const start = Date.now();
      const result = await next();
      const duration = Date.now() - start;
      const { method, path, status } = ctx;
      if (status < CLIENT_ERROR_STATUS && isStaticAsset(path)) return result;
      logger[getRequestLogLevel(status)](`${method} Request handled: ${path} (${status}, ${duration}ms)`, { method, path, status, duration });
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        ctx.status = error.statusCode ?? 500;
        ctx.body = error.message;
      } else {
        ctx.status = 500;
        ctx.body = 'Internal server error';
      }
      const { method, path, status, body: message } = ctx;
      logger[getRequestLogLevel(status) === 'error' ? 'error' : 'warn'](`Error handling ${method} request: ${path} (${status})`, { method, path, status, message });
    }
  };
}
