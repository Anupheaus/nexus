import { describe, it, expect } from 'vitest';
import type Koa from 'koa';
import { getClientIp } from './getClientIp';

function makeCtx(socketPeer: string | undefined, xff?: string): Koa.Context {
  return {
    req: { socket: { remoteAddress: socketPeer } },
    ip: socketPeer ?? '',
    get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? (xff ?? '') : ''),
  } as unknown as Koa.Context;
}

describe('getClientIp', () => {
  it('hops=0 returns the socket peer and ignores X-Forwarded-For', () => {
    expect(getClientIp(makeCtx('203.0.113.7', '9.9.9.9'), 0)).toBe('203.0.113.7');
  });

  it('hops=1 returns the right-most X-Forwarded-For entry (the nearest proxy recorded it)', () => {
    // XFF = client, proxy1 ; socket peer = proxy2. With 1 trusted hop we trust one step in.
    expect(getClientIp(makeCtx('3.3.3.3', '1.1.1.1, 2.2.2.2'), 1)).toBe('2.2.2.2');
  });

  it('hops=N counts inward — two trusted proxies resolves to the original client', () => {
    expect(getClientIp(makeCtx('3.3.3.3', '1.1.1.1, 2.2.2.2'), 2)).toBe('1.1.1.1');
  });

  it('ignores spoofed entries a client prepends on the left', () => {
    // Attacker connects through our single proxy and prepends a fake IP. The proxy appends the *real*
    // client IP, so with hops=1 we land on the real client, not the spoofed value.
    expect(getClientIp(makeCtx('10.0.0.1', '9.9.9.9, 198.51.100.23'), 1)).toBe('198.51.100.23');
  });

  it('falls back to the socket peer when there is no X-Forwarded-For', () => {
    expect(getClientIp(makeCtx('203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('clamps to the furthest available address when the chain is shorter than the hop count', () => {
    expect(getClientIp(makeCtx('2.2.2.2', '1.1.1.1'), 5)).toBe('1.1.1.1');
  });

  it('falls back to ctx.ip when the socket peer is unavailable', () => {
    const ctx = { ip: '5.5.5.5', get: () => '' } as unknown as Koa.Context;
    expect(getClientIp(ctx, 0)).toBe('5.5.5.5');
  });
});
