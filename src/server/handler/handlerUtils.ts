import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';
import { InternalError } from '@anupheaus/common';

export type TransportType = 'socket' | 'rest';

export interface CookieOptions {
  /** Default: true */
  httpOnly?: boolean;
  /** Default: true */
  secure?: boolean;
  /** Default: 'Strict' */
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Default: '/' */
  path?: string;
  /** Seconds until the cookie expires */
  maxAge?: number;
  expires?: Date;
}

// RedirectResult must be declared before SocketAPIServerHandlerActionUtils so the
// return type reference in the interface resolves without forward-declaration issues.

// Module-private symbol — only redirect() can produce a valid RedirectResult.
const REDIRECT_SYMBOL: unique symbol = Symbol('socket-api.redirect');

export interface RedirectResult {
  readonly type: typeof REDIRECT_SYMBOL;
  readonly url: string;
}

export interface SocketAPIServerHandlerActionUtils {
  transportType: TransportType;
  requestId: string;
  headers: Record<string, string | string[] | undefined>;
  setHeaders(headers: Record<string, string>): void;
  setCookie(name: string, value: string, options?: CookieOptions): void;
  getCookie(name: string): string | undefined;
  removeCookie(name: string): void;
  redirect(url: string): RedirectResult;
}

export function isRedirectResult(value: unknown): value is RedirectResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>).type === REDIRECT_SYMBOL
  );
}

// Why a dedicated factory: the error message names the operation so the caller
// knows exactly which util they cannot use over a socket transport.
function restOnlyError(name: string): InternalError {
  return new InternalError(`"${name}" is only available in REST action handlers`);
}

function buildSetCookieHeader(name: string, value: string, options: CookieOptions = {}): string {
  const {
    httpOnly = true,
    secure = true,
    sameSite = 'Strict',
    path = '/',
    maxAge,
    expires,
  } = options;

  const parts = [`${name}=${value}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  parts.push(`Path=${path}`);
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (expires != null) parts.push(`Expires=${expires.toUTCString()}`);
  return parts.join('; ');
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.split('=');
    if (key.trim() === name) return rest.join('=').trim();
  }
  return undefined;
}

export function createSocketHandlerUtils(socket: Socket, requestId: string): SocketAPIServerHandlerActionUtils {
  return {
    transportType: 'socket',
    requestId,
    // Socket.IO exposes IncomingHttpHeaders which is compatible with this type
    headers: socket.handshake.headers as Record<string, string | string[] | undefined>,
    setHeaders:   () => { throw restOnlyError('setHeaders'); },
    setCookie:    () => { throw restOnlyError('setCookie'); },
    getCookie:    () => { throw restOnlyError('getCookie'); },
    removeCookie: () => { throw restOnlyError('removeCookie'); },
    redirect:     () => { throw restOnlyError('redirect'); },
  };
}

export function createRestHandlerUtils(
  req: IncomingMessage,
  headerMap: Map<string, string>,
  requestId: string,
): SocketAPIServerHandlerActionUtils {
  return {
    transportType: 'rest',
    requestId,
    // Node http IncomingHttpHeaders is compatible with this type
    headers: req.headers as Record<string, string | string[] | undefined>,
    setHeaders:   (headers) => {
      for (const [k, v] of Object.entries(headers)) headerMap.set(k, v);
    },
    setCookie:    (name, value, opts) => {
      headerMap.set('Set-Cookie', buildSetCookieHeader(name, value, opts));
    },
    getCookie:    (name) => parseCookie(req.headers.cookie, name),
    removeCookie: (name) => {
      headerMap.set('Set-Cookie', buildSetCookieHeader(name, '', { maxAge: 0 }));
    },
    redirect:     (url) => ({ type: REDIRECT_SYMBOL, url }),
  };
}
