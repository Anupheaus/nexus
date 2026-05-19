import type { Http2Server } from 'http2';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
// import type { ServerConfig } from './startServer';
import type { DefaultEventsMap, Socket } from 'socket.io';

export type AnyHttpServer = Http2Server | HttpServer | HttpsServer;
export type Client = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;

// let savedServerConfig: ServerConfig | undefined;

// export function getServerConfig(): ServerConfig {
//   if (savedServerConfig == null) throw new Error('Server config is not set.');
//   return savedServerConfig;
// }

// export function setServerConfig(config: ServerConfig): void {
//   savedServerConfig = config;
// }
