import { io } from 'socket.io-client';
import { SocketIOParser } from '../../../common';
import type { Logger } from '@anupheaus/common';

export function createClientSocket(host: string | undefined, name: string, logger: Logger, auth?: Record<string, string>) {
  const resolvedHost = (host ?? window.location.host).replace(/^wss?:\/\//i, '');
  const isSecure = typeof window !== 'undefined' ? window.location.protocol === 'https:' : true;
  const wsProtocol = isSecure ? 'wss' : 'ws';
  const url = `${wsProtocol}://${resolvedHost}`;

  // In dev mode, check for a persisted dev session token (written by the Dev Unlock
  // button in DeviceAuthGate). Android WebView does not reliably include HttpOnly cookies
  // in WebSocket upgrade headers, so we pass the token via socket.handshake.auth instead.
  // The server's validateSessionCookie already supports this fallback.
  const devSessionToken = process.env.NODE_ENV !== 'production' && typeof localStorage !== 'undefined'
    ? localStorage.getItem(`socketapi:dev-session:${name}`) ?? undefined
    : undefined;
  const resolvedAuth = devSessionToken != null ? { ...auth, sessionToken: devSessionToken } : auth;

  return io(url, {
    path: `/${name}`,
    transports: ['websocket', 'webtransport'],
    parser: new SocketIOParser({ logger }),
    secure: isSecure,
    forceNew: true,
    autoConnect: false,
    forceBase64: true,
    auth: resolvedAuth,
    withCredentials: true,
  });
}