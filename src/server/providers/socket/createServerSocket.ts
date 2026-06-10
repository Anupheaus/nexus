import { Server } from 'socket.io';
import type { AnyHttpServer } from '../../internalModels';
import { SocketIOParser } from '../../../common';
import type { Logger } from '@anupheaus/common';

const MAX_HTTP_BUFFER_SIZE = 1024 * 1024 * 10;

/** Default Engine.IO pingTimeout is 20s — too tight when the Node event loop stalls on heavy sync work. */
const PING_INTERVAL_MS = 25_000;
const PING_TIMEOUT_MS = 60_000;

export function createServerSocket(name: string, server: AnyHttpServer, logger: Logger) {
  return new Server(server, {
    path: `/${name}`,
    transports: ['websocket'],
    serveClient: false,
    parser: new SocketIOParser({ logger }),
    maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
    pingInterval: PING_INTERVAL_MS,
    pingTimeout: PING_TIMEOUT_MS,
    // Engine.IO uses prefix matching, so /{name}/register etc. pass the path check.
    // allowRequest fires inside the upgrade/request handler and lets us enforce an exact match.
    allowRequest: (req, callback) => {
      const pathname = ((req.url ?? '').split('?')[0] ?? '').replace(/\/$/, '');
      callback(pathname === `/${name}` ? null : 'path not allowed', pathname === `/${name}`);
    },
  });
}
