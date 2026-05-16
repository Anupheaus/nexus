import { io } from 'socket.io-client';
import { SocketIOParser } from '../../../common';
import type { Logger } from '@anupheaus/common';
import type { TokenStorage } from './tokenStorage';

interface CreateClientSocketOptions {
  host?: string;
  name: string;
  logger: Logger;
  auth?: Record<string, string>;
  tokenStorage?: TokenStorage;
}

export function createClientSocket({ host, name, logger, auth, tokenStorage }: CreateClientSocketOptions) {
  const resolvedHost = (host ?? window.location.host).replace(/^wss?:\/\//i, '');
  const isSecure = typeof window !== 'undefined' ? window.location.protocol === 'https:' : true;
  const wsProtocol = isSecure ? 'wss' : 'ws';
  const url = `${wsProtocol}://${resolvedHost}`;

  // Key used to persist the session token via tokenStorage (Capacitor / non-cookie environments).
  const storageKey = `socketapi:session:${name}`;

  // In dev mode, check for a persisted dev session token (written by the Dev Unlock
  // button in DeviceAuthGate). Android WebView does not reliably include HttpOnly cookies
  // in WebSocket upgrade headers, so we pass the token via socket.handshake.auth instead.
  // The server's validateSessionCookie already supports this fallback.
  // The guard ensures this localStorage read is skipped entirely in production builds.
  const devToken = process.env.NODE_ENV !== 'production' && typeof localStorage !== 'undefined'
    ? localStorage.getItem(`socketapi:dev-session:${name}`) ?? null
    : null;

  // Dev token takes priority. When no dev token is present, use tokenStorage (Capacitor) if
  // provided — this allows the stored session token to be supplied asynchronously on each
  // reconnect. Falls back to the plain auth object for web (cookies only).
  const authProvider: Record<string, string> | ((cb: (data: object) => void) => void) =
    devToken
      ? { ...(auth ?? {}), sessionToken: devToken }
      : tokenStorage
        ? (cb: (data: object) => void) => {
            // Fall back to auth-only on storage read failure so the connection attempt is
            // not silently abandoned (cb never called = socket hangs forever).
            tokenStorage.get(storageKey)
              .then(token => cb(token != null ? { ...(auth ?? {}), sessionToken: token } : (auth ?? {})))
              .catch(() => cb(auth ?? {}));
          }
        : (auth ?? {});

  const socket = io(url, {
    path: `/${name}`,
    transports: ['websocket', 'webtransport'],
    parser: new SocketIOParser({ logger }),
    secure: isSecure,
    forceNew: true,
    autoConnect: false,
    forceBase64: true,
    auth: authProvider,
    withCredentials: true,
  });

  if (tokenStorage != null) {
    // Server emits this after successful auth; store for future reconnects.
    socket.on('socketapi:sessionToken', (token: string) => {
      tokenStorage.set(storageKey, token);
    });
    // Server emits this when the stored token has been invalidated; clear it so the
    // next reconnect does not re-send a stale token.
    socket.on('socketapi:sessionInvalid', () => {
      tokenStorage.remove(storageKey);
    });
  }

  return socket;
}
