import { io } from 'socket.io-client';
import { SocketIOParser } from '../../../common';
import type { Logger } from '@anupheaus/common';

export function createClientSocket(host: string | undefined, name: string, logger: Logger, auth?: Record<string, string>) {
  const resolvedHost = (host ?? window.location.host).replace(/^wss?:\/\//i, '');
  const isSecure = typeof window !== 'undefined' ? window.location.protocol === 'https:' : true;
  const wsProtocol = isSecure ? 'wss' : 'ws';
  const url = `${wsProtocol}://${resolvedHost}`;
  return io(url, {
    path: `/${name}`,
    transports: ['websocket', 'webtransport'],
    parser: new SocketIOParser({ logger }),
    secure: isSecure,
    forceNew: true,
    autoConnect: false,
    forceBase64: true,
    auth,
  });
}