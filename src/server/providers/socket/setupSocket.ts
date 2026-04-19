import '@anupheaus/common';
import type { SocketContextProps } from './SocketContext';
import type { Logger, LoggerEntry } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { AnyHttpServer } from '../../internalModels';
import { createServerSocket } from './createServerSocket';
import { useAuthentication } from '../authentication';
import { setClient, wrap } from '../../async-context';
import type { Socket } from 'socket.io';
import type { SocketAPIClientLoggingService } from '../../../common';
import type { Connection } from '../connection';
import type { ConnectionRegistry } from '../connection';

export function setupSocket(name: string, server: AnyHttpServer, logger: Logger, clientLoggingService: SocketAPIClientLoggingService | undefined, registry: ConnectionRegistry) {
  logger.info(`Preparing websocket for '${name}'...`);
  const socket = createServerSocket(name, server, logger);
  try {
    const onConnectedCallbacks = new Set<Parameters<SocketContextProps['onClientConnected']>[0]>();
    socket.on('connection', wrap(client => registry.fromSocket(client), async client => {
      const connection = registry.fromSocket(client);
      connection.openWebSocket();
      setClient(client);
      const clientLogger = logger.createSubLogger(client.id, { globalMeta: { clientId: client.id } });
      const userAgent = client.request.headers['user-agent'];
      const language = client.request.headers['accept-language'];
      const ipAddress = client.handshake.address;

      clientLogger.info('Client connected', { IPAddress: ipAddress, userAgent, language });

      const disconnectCallbacks = Array.from(onConnectedCallbacks)
        .mapWithoutNull(callback => callback({ client }));

      setupClientLoggingService(client, connection, clientLoggingService, userAgent, language, ipAddress);

      client.on('disconnect', wrap(connection, () => {
        connection.closeWebSocket();
        clientLogger.info('Client disconnected');
        disconnectCallbacks.forEach(async potentialCb => {
          const cb = await potentialCb;
          if (!is.function(cb)) return;
          cb(client);
        });
      }));
    }));

    const onClientConnected: SocketContextProps['onClientConnected'] = (callback: Parameters<SocketContextProps['onClientConnected']>[0]) => {
      onConnectedCallbacks.add(callback);
    };

    logger.info('Websocket ready, waiting for the server to start...');

    server.on('listening', wrap(() => {
      const address = server.address();
      const port = is.string(address) ? undefined : address?.port;
      logger.info(`Websocket listening on port ${port}.`);
    }));

    server.on('close', wrap(() => {
      logger.info('Websocket closed due to the server being closed.');
    }));

    return { onClientConnected, io: socket };


  } finally {
    // socket.close();
  }
}

function setupClientLoggingService(
  client: Socket,
  connection: Connection,
  clientLoggingService: SocketAPIClientLoggingService | undefined,
  userAgent: string | undefined,
  language: string | undefined,
  ipAddress: string | undefined,
) {
  const listener = wrap(connection, (entries: LoggerEntry[]) => {
    const { user } = useAuthentication();
    entries.forEach(entry => {
      const meta = entry.meta = entry.meta ?? {};
      meta.clientId = client.id;
      meta.source = 'client';
      meta.userAgent = userAgent;
      meta.language = language;
      meta.IPAddress = ipAddress;
      if (user != null) meta.userId = user.id;
    });
    clientLoggingService?.(client, user)(entries);
  });
  client.on('mxdb.log', listener);
  client.on('disconnect', wrap(connection, () => client.off('mxdb.log', listener)));
}
