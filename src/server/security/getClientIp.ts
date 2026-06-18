import type Koa from 'koa';

/**
 * Resolve the real client IP, honouring the number of trusted reverse proxies in front of the server.
 *
 * Hops are counted **inward from the server**, never from the (attacker-controllable) left of the header:
 *   - hop 0 = the direct TCP peer (`socket.remoteAddress`)
 *   - hop 1 = the right-most `X-Forwarded-For` entry (the address our nearest trusted proxy recorded)
 *   - hop N = the Nth address counting inward
 *
 * So with `trustedProxyHops = N` we return the address `N` steps in — i.e. the client as seen by the
 * outermost *trusted* proxy. Any extra `X-Forwarded-For` values a client prepends on the left are ignored,
 * which is what makes IP-keyed rate limiting spoof-resistant. With `trustedProxyHops = 0` we use the raw
 * socket peer and ignore `X-Forwarded-For` entirely (correct when the server is directly internet-facing).
 *
 * If the chain is shorter than `trustedProxyHops` (misconfiguration, or a client sending fewer hops than
 * expected) we clamp to the furthest available address rather than running off the end.
 */
export function getClientIp(ctx: Koa.Context, trustedProxyHops: number): string {
  // Optional chaining throughout: callers' mock contexts (and odd transports) may lack `req`/`socket`.
  const socketPeer = ctx.req?.socket?.remoteAddress ?? ctx.ip ?? '';
  if (trustedProxyHops <= 0) return socketPeer;

  const header = ctx.get('x-forwarded-for');
  if (!header) return socketPeer;

  const forwarded = header.split(',').map(part => part.trim()).filter(Boolean);
  // Nearest-first: the socket peer, then the X-Forwarded-For entries right-to-left.
  const chain = [socketPeer, ...forwarded.reverse()];
  const index = Math.min(trustedProxyHops, chain.length - 1);
  return chain[index] || socketPeer;
}
