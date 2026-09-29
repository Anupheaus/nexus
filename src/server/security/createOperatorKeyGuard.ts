import type Koa from 'koa';
import type { OperatorKeyGuardConfig } from './SecurityConfig';
import { securityWarn } from './securityLog';

/** The answer a refused request gets: plain, and naming nothing about how the server reads it. */
export const REFUSED_OPERATOR_MESSAGE = 'This request could not be accepted.';

/**
 * How deep a request may nest. Nothing a real client sends comes close; a body nested thousands of levels deep is refused
 * rather than walked (a recursive walk would overflow the stack and answer 500).
 */
export const MAX_REQUEST_DEPTH = 64;

/** The logged key path is cut to this length — a refused request's keys are the client's, and can be any length. */
const MAX_LOGGED_PATH_LENGTH = 200;

const isDollarKey = (key: string): boolean => key.startsWith('$');
const isDottedKey = (key: string): boolean => key.includes('.');

const isPlainContainer = (value: object): boolean => {
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * The path to the first key `isRefused` picks out in a parsed request — plain objects and arrays only (a JSON or qs body
 * holds nothing else), in document order — or undefined. Walked iteratively, never recursively; a value nested more than
 * {@link MAX_REQUEST_DEPTH} levels deep is itself refused (the path then ends ` (nested too deeply)`). Copes with a value
 * that refers to itself.
 */
export function findRefusedKey(value: unknown, isRefused: (key: string) => boolean): string | undefined {
  const seen = new WeakSet<object>();
  const pending: { value: unknown; path: string; depth: number }[] = [{ value, path: '', depth: 0 }];
  while (pending.length > 0) {
    const { value: current, path, depth } = pending.pop()!;
    if (current == null || typeof current !== 'object' || seen.has(current) || !isPlainContainer(current)) continue;
    if (depth >= MAX_REQUEST_DEPTH) return `${path} (nested too deeply)`;
    seen.add(current);
    const entries = Object.entries(current);
    const isArray = Array.isArray(current);
    for (const [key] of entries) {
      if (!isArray && isRefused(key)) return path.length === 0 ? key : `${path}.${key}`;
    }
    // Pushed in reverse, so the first entry is walked first
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, nested] = entries[index]!;
      pending.push({ value: nested, path: path.length === 0 ? key : `${path}.${key}`, depth: depth + 1 });
    }
  }
  return undefined;
}

const forLog = (path: string): string => (path.length > MAX_LOGGED_PATH_LENGTH ? `${path.slice(0, MAX_LOGGED_PATH_LENGTH)}…` : path);

interface GuardedRequest {
  path: string;
  method: string;
  query: Record<string, unknown>;
  body: unknown;
}

/**
 * Where a request carries a MongoDB operator key, or undefined when it does not: a `$`-prefixed key anywhere in the query
 * string or the body, or — when the app opted in with `refuseDottedKeys` and `isDottedKeyAllowed` does not exempt this
 * request (a webhook whose provider sends dotted names, e.g. Meta's `hub.mode` or an inbound email's header map) — a
 * dotted key, which MongoDB reads as a path into a nested field.
 */
export function findOperatorKeyInRequest({ path, method, query, body }: GuardedRequest, { refuseDottedKeys = false, isDottedKeyAllowed }: OperatorKeyGuardConfig): string | undefined {
  const refusesDotted = refuseDottedKeys && isDottedKeyAllowed?.({ path, method }) !== true;
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
      securityWarn('Refused a request carrying a MongoDB operator or a dotted key', { securityEvent: 'operator-injection', path: ctx.path, method: ctx.method, key: forLog(refused) });
      ctx.status = 400;
      ctx.body = { error: { message: REFUSED_OPERATOR_MESSAGE } };
      return;
    }
    return next();
  };
}
