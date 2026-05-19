import type { ServerConfig } from '../startServer';
import type { Socket } from 'socket.io';
import { createAsyncContext } from './createAsyncContext';
import { optional, required } from './types';
import type { Logger } from '@anupheaus/common';
import type { NexusAccount, NexusUser } from '../../common';

export interface NexusAuthData {
  user?: NexusUser;
  account?: NexusAccount;
  token?: string;
  privateKey?: string;
  publicKey?: string;
}

/**
 * Shared ALS used by socket-api server: `wrap(client, handler)` for deferred work,
 * plus typed slots for config, the active Socket, logger, and per-client authentication state.
 */
export const {
  wrap,
  setConfig,
  useConfig,
  setClient,
  useClient,
  setLogger,
  useLogger,
  setAuthData,
  useAuthData,
} = createAsyncContext({
  config: required<ServerConfig>(),
  logger: required<Logger>(),
  client: optional<Socket>(),
  authData: optional<NexusAuthData>(),
});
