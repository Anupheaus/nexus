import type Router from 'koa-router';
import type { IncomingMessage, ServerResponse } from 'http';
import { getErrorFromAckResponse, wrapAckHandler } from '../../common/ackResponse';
import { wrap, useConfig, setAuthData, setResponseHeaders } from '../async-context/socketApiContext';
import type { ConnectionRegistry } from '../providers/connection';
import { validateRestSession } from '../auth/validateRestSession';
import { getRestAction, getAllRestActions, type RestActionRegistryEntry } from './restActionRegistry';

function coerceQueryValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== '') return n;
  return v;
}

function buildExplicitRequest(ctx: Router.RouterContext, method: string): unknown {
  const pathParams = ctx.params as Record<string, string>;
  if (method === 'GET' || method === 'DELETE') {
    const query = ctx.query as Record<string, string>;
    const coerced = Object.fromEntries(
      Object.entries(query).map(([k, v]) => [k, coerceQueryValue(v)]),
    );
    return { ...coerced, ...pathParams };
  }
  const body = (ctx.request.body as Record<string, unknown>) ?? {};
  return { ...body, ...pathParams };
}

async function executeRestEntry(
  ctx: Router.RouterContext,
  entry: RestActionRegistryEntry,
  request: unknown,
  connectionRegistry: ConnectionRegistry,
): Promise<void> {
  // Create a mutable header map in the outer closure so handlers can accumulate
  // response headers (e.g. Set-Cookie) via setResponseHeader(), and we can apply
  // them to ctx after the handler completes.
  const headerMap = new Map<string, string>();

  try {
    const run = wrap(
      (req: IncomingMessage, res: ServerResponse) => connectionRegistry.fromRequest(req, res),
      async (req: IncomingMessage, _res: ServerResponse): Promise<{ status: 401 } | { status: 200; result: unknown }> => {
        // Make the header map available inside the action handler via useResponseHeaders().
        setResponseHeaders(headerMap);

        const { auth, onBeforeHandle } = useConfig();
        if (auth != null && !entry.action.isPublic) {
          const session = await validateRestSession(
            req.headers.cookie ?? '',
            auth.store,
            auth.onGetUser,
          );
          if (!session) return { status: 401 };
          setAuthData({ user: session.user, token: session.token });
        }
        await onBeforeHandle?.(undefined as any);
        const result = await wrapAckHandler(
          () => entry.limitGate.run(() => (entry.handler as (req: unknown) => unknown)(request)),
        );
        return { status: 200, result };
      },
    );

    const outcome = await run(ctx.req, ctx.res);

    // Apply any headers the handler accumulated (e.g. Set-Cookie) before sending the response.
    for (const [name, value] of headerMap) {
      ctx.set(name, value);
    }

    if (outcome.status === 401) {
      ctx.status = 401;
      return;
    }

    const { error, response } = getErrorFromAckResponse(outcome.result);
    if (error) {
      ctx.status = 400;
      ctx.body = { error: { message: error.message } };
    } else {
      ctx.status = 200;
      // Void handlers return undefined — default to {} so callRest can always parse JSON.
      ctx.body = response ?? {};
    }
  } catch {
    ctx.status = 500;
  }
}

export function registerRestActions(
  router: Router,
  name: string,
  connectionRegistry: ConnectionRegistry,
): void {
  // Catch-all for actions dispatched by name (no explicit rest config required)
  router.post(`/${name}/actions/:actionName`, async ctx => {
    const actionName = ctx.params.actionName;
    const entry = getRestAction(actionName);
    if (!entry) {
      ctx.status = 404;
      ctx.body = { error: { message: `Unknown action: ${actionName}` } };
      return;
    }
    await executeRestEntry(ctx, entry, ctx.request.body, connectionRegistry);
  });

  // Explicit routes for actions that declare a rest config
  for (const entry of getAllRestActions()) {
    if (!entry.action.rest) continue;
    const { method, url } = entry.action.rest;
    const routerMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    router[routerMethod](url, async ctx => {
      const request = buildExplicitRequest(ctx, method);
      await executeRestEntry(ctx, entry, request, connectionRegistry);
    });
  }
}
