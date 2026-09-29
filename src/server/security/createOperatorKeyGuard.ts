import type Koa from 'koa';
import type { OperatorKeyGuardConfig } from './SecurityConfig';
import { securityWarn } from './securityLog';

/** The answer a refused request gets: plain, and naming nothing about how the server reads it. */
export const REFUSED_OPERATOR_MESSAGE = 'This request could not be accepted.';

const isDollarKey = (key: string): boolean => key.startsWith('$');
const isDottedKey = (key: string): boolean => key.includes('.');

/**
 * The path to the first key `isRefused` picks out in a parsed request — plain objects and arrays only (a JSON or qs body
 * holds nothing else) — or undefined. Copes with a value that refers to itself.
 */
export function findRefusedKey(value: unknown, isRefused: (key: string) => boolean, path = '', seen = new WeakSet<object>()): string | undefined {
  if (value == null || typeof value !== 'object' || seen.has(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  const isPlain = Array.isArray(value) || prototype === Object.prototype || prototype === null;
  if (!isPlain) return undefined;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path.length === 0 ? key : `${path}.${key}`;
    if (!Array.isArray(value) && isRefused(key)) return nestedPath;
    const found = findRefusedKey(nested, isRefused, nestedPath, seen);
    if (found != null) return found;
  }
  return undefined;
}

interface GuardedRequest {
  path: string;
  method: string;
  query: Record<string, unknown>;
  body: unknown;
}

/**
 * Where a request carries a MongoDB operator key, or undefined when it does not: a `$`-prefixed key anywhere in the query
 * string or the body, or — unless `isDottedKeyAllowed` allows it for this request (a webhook whose provider sends dotted
 * names, e.g. Meta's `hub.mode` or an inbound email's header map) — a dotted key, which MongoDB reads as a path into a
 * nested field.
 */
export function findOperatorKeyInRequest({ path, method, query, body }: GuardedRequest, { isDottedKeyAllowed }: OperatorKeyGuardConfig): string | undefined {
  const refusesDotted = isDottedKeyAllowed?.({ path, method }) !== true;
  const isRefused = (key: string): boolean => isDollarKey(key) || (refusesDotted && isDottedKey(key));
  const inQuery = findRefusedKey(query, isRefused);
  if (inQuery != null) return `query.${inQuery}`;
  const inBody = findRefusedKey(body, isRefused);
  return inBody == null ? undefined : `body.${inBody}`;
}

/**
 * Koa middleware, ahead of every route (nexus's REST actions, its own auth routes, and whatever the app and mxdb
 * register): refuses with 400 a request whose query string or body carries a MongoDB operator key. It reads the body
 * as the body parser left it — before `to.deserialise` turns `@error` objects into Errors and ISO strings into DateTimes,
 * which would hide what is inside them from any later check. Socket traffic is not HTTP and is not seen here.
 */
export function createOperatorKeyGuard(config: OperatorKeyGuardConfig | false): Koa.Middleware {
  return async (ctx, next) => {
    if (config === false) return next();
    const refused = findOperatorKeyInRequest({
      path: ctx.path,
      method: ctx.method,
      query: ctx.query as Record<string, unknown>,
      body: (ctx.request as unknown as { body?: unknown }).body,
    }, config);
    if (refused != null) {
      securityWarn('Refused a request carrying a MongoDB operator or a dotted key', { securityEvent: 'operator-injection', path: ctx.path, method: ctx.method, key: refused });
      ctx.status = 400;
      ctx.body = { error: { message: REFUSED_OPERATOR_MESSAGE } };
      return;
    }
    return next();
  };
}
