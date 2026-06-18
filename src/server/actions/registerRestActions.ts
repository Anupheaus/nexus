import type Router from '@koa/router';
import type { RouterContext } from '@koa/router';
import type { IncomingMessage, ServerResponse } from 'http';
import { wrap, useConfig, setAuthData } from '../async-context/nexusContext';
import type { ConnectionRegistry } from '../providers/connection';
import { validateRestSession } from '../auth/validateRestSession';
import type { NexusServerAction, RestActionRegistryEntry } from './createServerActionHandler';
import { createRestHandlerUtils, isRedirectResult, type NexusServerHandlerActionUtils } from '../handler/handlerUtils';
import { getClientIp } from '../security/getClientIp';
import { getResolvedSecurity } from '../security/createSecurityMiddleware';
import { Error as BaseError, ApiError } from '@anupheaus/common';

function coerceQueryValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== '') return n;
  return v;
}

function buildExplicitRequest(ctx: RouterContext, method: string): unknown {
  const pathParams = ctx.params as Record<string, string>;
  if (method === 'GET' || method === 'DELETE') {
    const query = ctx.query as Record<string, string>;
    const coerced = Object.fromEntries(
      Object.entries(query).map(([k, v]) => [k, coerceQueryValue(v)]),
    );
    return { ...coerced, ...pathParams };
  }
  const body = ((ctx.request as unknown as { body: unknown }).body as Record<string, unknown>) ?? {};
  return { ...body, ...pathParams };
}

async function executeRestEntry(
  ctx: RouterContext,
  entry: RestActionRegistryEntry,
  request: unknown,
  connectionRegistry: ConnectionRegistry,
): Promise<void> {
  // Transport check — reject REST calls to socket-only actions before any other work.
  if (entry.action.transport != null && !entry.action.transport.includes('rest')) {
    ctx.status = 405;
    ctx.body = { error: { message: 'This action is only available via socket' } };
    return;
  }

  // Per-IP rate limit (when the action declares `server.rateLimit`) — checked before auth and the handler
  // so throttled requests cost nothing downstream. Keyed by client IP + action name so each action limits
  // independently. The IP is resolved with the trusted-proxy-hop count from the security middleware, so it
  // can't be spoofed via prepended X-Forwarded-For entries.
  if (entry.rateLimiter != null) {
    const ip = getClientIp(ctx, getResolvedSecurity(ctx)?.trustedProxyHops ?? 0);
    if (!entry.rateLimiter.check(ip, entry.action.name)) {
      ctx.status = 429;
      ctx.body = { error: { message: entry.rateLimitMessage ?? 'Too many requests, please slow down.' } };
      return;
    }
  }

  const headerMap = new Map<string, string>();
  const requestId = Math.uniqueId();

  try {
    const run = wrap(
      (req: IncomingMessage, res: ServerResponse) => connectionRegistry.fromRequest(req, res),
      async (req: IncomingMessage, _res: ServerResponse): Promise<
        | { type: 'success'; result: unknown }
        | { type: 'redirect'; url: string }
        | { type: 'error'; status: number; message: string }
        | { type: 'unauthorized' }
      > => {
        const { auth, onBeforeHandle } = useConfig();
        if (auth != null && !entry.action.isPublic) {
          const session = await validateRestSession(
            req.headers.cookie ?? '',
            auth.store,
            auth.onGetUser,
          );
          if (!session) return { type: 'unauthorized' };
          setAuthData({ user: session.user, token: session.token });
        }
        await onBeforeHandle?.(undefined as any);

        const utils: NexusServerHandlerActionUtils = createRestHandlerUtils(req, headerMap, requestId);
        try {
          const result = await entry.limitGate.run(
            () => (entry.handler as (req: unknown, utils: NexusServerHandlerActionUtils) => unknown)(request, utils),
          );
          if (isRedirectResult(result)) return { type: 'redirect', url: result.url };
          return { type: 'success', result };
        } catch (err) {
          // ApiError stores statusCode in meta (accessible via getter), while other BaseError
          // subclasses store it directly in props (accessible via toJSON). Check both paths.
          const status = err instanceof ApiError ? err.statusCode
            : err instanceof BaseError ? (err.toJSON().statusCode ?? 400)
            : 500;
          const message = err instanceof globalThis.Error ? err.message : String(err);
          return { type: 'error', status, message };
        }
      },
    );

    const outcome = await run(ctx.req, ctx.res);

    // Apply any response headers (e.g. Set-Cookie) accumulated by the handler.
    for (const [name, value] of headerMap) ctx.set(name, value);

    if (outcome.type === 'unauthorized') { ctx.status = 401; return; }
    if (outcome.type === 'redirect') { ctx.redirect(outcome.url); ctx.status = 302; return; }
    if (outcome.type === 'error') {
      ctx.status = outcome.status;
      ctx.body = { error: { message: outcome.message } };
      return;
    }
    ctx.status = 200;
    // Void handlers return undefined — default to {} so callRest can always parse JSON.
    ctx.body = outcome.result ?? {};
  } catch {
    ctx.status = 500;
  }
}

export function registerRestActions(
  router: Router,
  name: string,
  connectionRegistry: ConnectionRegistry,
  actions: NexusServerAction[],
): void {
  const restMap = new Map(actions.map(a => [a.restEntry.action.name, a.restEntry]));

  // Catch-all for actions dispatched by name (no explicit rest config required)
  router.post(`/${name}/actions/:actionName`, async ctx => {
    const actionName = ctx.params.actionName ?? '';
    const entry = restMap.get(actionName);
    if (!entry) {
      ctx.status = 404;
      ctx.body = { error: { message: `Unknown action: ${actionName}` } };
      return;
    }
    await executeRestEntry(ctx, entry, (ctx.request as unknown as { body: unknown }).body, connectionRegistry);
  });

  // Explicit routes for actions that declare a rest config
  for (const serverAction of actions) {
    const restRoute = serverAction.restEntry.action.rest;
    if (!restRoute) continue;
    const { method } = restRoute;
    // Substitute {name} with the actual server name before registering the route.
    const url = restRoute.url.replace('{name}', name);
    const routerMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    router[routerMethod](url, async ctx => {
      const request = buildExplicitRequest(ctx, method);
      await executeRestEntry(ctx, serverAction.restEntry, request, connectionRegistry);
    });
  }
}
