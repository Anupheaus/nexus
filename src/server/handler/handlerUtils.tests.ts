import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'http';
import type { Socket } from 'socket.io';

// These imports will fail until the file is created — that's expected.
import {
  isRedirectResult,
  createSocketHandlerUtils,
  createRestHandlerUtils,
} from './handlerUtils';
import type { RestResponseHeaders } from './handlerUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSocket(headers: Record<string, string> = {}): Pick<Socket, 'handshake'> {
  return { handshake: { headers } } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(cookieHeader?: string, headers: Record<string, string> = {}): IncomingMessage {
  return { headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...headers } } as any;
}

function makeResponseHeaders(): RestResponseHeaders {
  return { headers: new Map(), cookies: [] };
}

// ── parseCookie (tested via getCookie) ──────────────────────────────────────

describe('getCookie (REST)', () => {
  it('returns undefined when no cookie header present', () => {
    const { getCookie } = createRestHandlerUtils(makeReq(), makeResponseHeaders(), 'req-1');
    expect(getCookie('session')).toBeUndefined();
  });

  it('returns undefined when named cookie not present', () => {
    const { getCookie } = createRestHandlerUtils(makeReq('other=abc'), makeResponseHeaders(), 'req-1');
    expect(getCookie('session')).toBeUndefined();
  });

  it('returns value when named cookie present', () => {
    const { getCookie } = createRestHandlerUtils(makeReq('session=tok123'), makeResponseHeaders(), 'req-1');
    expect(getCookie('session')).toBe('tok123');
  });

  it('handles multiple cookies', () => {
    const { getCookie } = createRestHandlerUtils(makeReq('a=1; session=tok123; b=2'), makeResponseHeaders(), 'req-1');
    expect(getCookie('session')).toBe('tok123');
    expect(getCookie('a')).toBe('1');
  });
});

// ── buildSetCookieHeader (tested via setCookie / removeCookie) ───────────────

describe('setCookie (REST)', () => {
  it('builds correct Set-Cookie header with defaults', () => {
    const responseHeaders = makeResponseHeaders();
    const { setCookie } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    setCookie('session', 'tok');
    const [header] = responseHeaders.cookies;
    expect(header).toContain('session=tok');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
  });

  it('applies custom maxAge', () => {
    const responseHeaders = makeResponseHeaders();
    const { setCookie } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    setCookie('session', 'tok', { maxAge: 3600 });
    expect(responseHeaders.cookies[0]).toContain('Max-Age=3600');
  });

  it('applies custom sameSite', () => {
    const responseHeaders = makeResponseHeaders();
    const { setCookie } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    setCookie('session', 'tok', { sameSite: 'Lax' });
    expect(responseHeaders.cookies[0]).toContain('SameSite=Lax');
  });

  // Each cookie is its own Set-Cookie header: one set later must not replace one set earlier.
  it('keeps every cookie a handler sets, in order', () => {
    const responseHeaders = makeResponseHeaders();
    const { setCookie, removeCookie } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    setCookie('first', 'one');
    setCookie('second', 'two');
    removeCookie('third');
    expect(responseHeaders.cookies.map(cookie => cookie.split(';')[0])).toEqual(['first=one', 'second=two', 'third=']);
  });
});

describe('removeCookie (REST)', () => {
  it('sets Max-Age=0 to expire the cookie', () => {
    const responseHeaders = makeResponseHeaders();
    const { removeCookie } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    removeCookie('session');
    const [header] = responseHeaders.cookies;
    expect(header).toContain('session=');
    expect(header).toContain('Max-Age=0');
  });
});

// ── setHeaders (REST) ────────────────────────────────────────────────────────

describe('setHeaders (REST)', () => {
  it('writes all provided headers to the headerMap', () => {
    const responseHeaders = makeResponseHeaders();
    const { setHeaders } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    setHeaders({ 'X-Foo': 'bar', 'X-Baz': 'qux' });
    expect(responseHeaders.headers.get('X-Foo')).toBe('bar');
    expect(responseHeaders.headers.get('X-Baz')).toBe('qux');
  });

  it('adds a Set-Cookie header to the cookies rather than replacing them', () => {
    const responseHeaders = makeResponseHeaders();
    const { setHeaders, setCookie } = createRestHandlerUtils(makeReq(), responseHeaders, 'req-1');
    setCookie('session', 'tok');
    setHeaders({ 'set-cookie': 'other=1; Path=/' });
    expect(responseHeaders.cookies).toHaveLength(2);
    expect(responseHeaders.headers.size).toBe(0);
  });
});

// ── redirect ─────────────────────────────────────────────────────────────────

describe('redirect (REST)', () => {
  it('returns a RedirectResult recognised by isRedirectResult', () => {
    const { redirect } = createRestHandlerUtils(makeReq(), makeResponseHeaders(), 'req-1');
    const result = redirect('/new-path');
    expect(isRedirectResult(result)).toBe(true);
    expect(result.url).toBe('/new-path');
  });
});

describe('isRedirectResult', () => {
  it('returns false for plain objects', () => {
    expect(isRedirectResult({ url: '/foo' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRedirectResult(null)).toBe(false);
  });

  it('returns false for strings', () => {
    expect(isRedirectResult('/foo')).toBe(false);
  });
});

// ── REST utils metadata ──────────────────────────────────────────────────────

describe('createRestHandlerUtils', () => {
  it('exposes transportType as rest', () => {
    const { transportType } = createRestHandlerUtils(makeReq(), makeResponseHeaders(), 'req-1');
    expect(transportType).toBe('rest');
  });

  it('exposes requestId', () => {
    const { requestId } = createRestHandlerUtils(makeReq(), makeResponseHeaders(), 'my-id');
    expect(requestId).toBe('my-id');
  });

  it('exposes request headers', () => {
    const { headers } = createRestHandlerUtils(makeReq(undefined, { 'x-custom': 'val' }), makeResponseHeaders(), 'req-1');
    expect(headers['x-custom']).toBe('val');
  });
});

// ── Socket utils ─────────────────────────────────────────────────────────────

describe('createSocketHandlerUtils', () => {
  it('exposes transportType as socket', () => {
    const { transportType } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(transportType).toBe('socket');
  });

  it('exposes requestId', () => {
    const { requestId } = createSocketHandlerUtils(makeSocket() as any, 'my-id');
    expect(requestId).toBe('my-id');
  });

  it('exposes socket handshake headers', () => {
    const { headers } = createSocketHandlerUtils(makeSocket({ 'x-custom': 'hello' }) as any, 'req-1');
    expect(headers['x-custom']).toBe('hello');
  });

  it('throws when setHeaders is called', () => {
    const { setHeaders } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => setHeaders({ 'X-Foo': 'bar' })).toThrow('"setHeaders" is only available in REST action handlers');
  });

  it('throws when setCookie is called', () => {
    const { setCookie } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => setCookie('name', 'value')).toThrow('"setCookie" is only available in REST action handlers');
  });

  it('throws when getCookie is called', () => {
    const { getCookie } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => getCookie('name')).toThrow('"getCookie" is only available in REST action handlers');
  });

  it('throws when removeCookie is called', () => {
    const { removeCookie } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => removeCookie('name')).toThrow('"removeCookie" is only available in REST action handlers');
  });

  it('throws when redirect is called', () => {
    const { redirect } = createSocketHandlerUtils(makeSocket() as any, 'req-1');
    expect(() => redirect('/url')).toThrow('"redirect" is only available in REST action handlers');
  });
});
