/** Inputs for {@link toRestOrigin}. */
export interface RestOriginSource {
  /** The `host` the socket connects to (as passed to `SocketProvider`), if any. */
  host: string | undefined;
  /** `window.location.protocol` of the page — picks https vs http, matching the socket's wss vs ws. */
  pageProtocol: string;
}

/**
 * The origin REST actions are sent to, so they reach the SAME server as the socket. Empty when no
 * `host` is configured, keeping REST page-relative (today's behaviour). When a host is set — e.g. a
 * Capacitor app whose page is served from somewhere other than the server it syncs with — REST must
 * follow it, or public auth actions (invite/register/re-auth) hit the page's origin instead.
 * Mirrors `createClientSocket`'s host handling (strip a ws/wss scheme; secure iff the page is https).
 */
export function toRestOrigin({ host, pageProtocol }: RestOriginSource): string {
  if (host == null || host === '') return '';
  const bareHost = host.replace(/^wss?:\/\//i, '');
  const scheme = pageProtocol === 'https:' ? 'https' : 'http';
  return `${scheme}://${bareHost}`;
}
