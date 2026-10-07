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

/** Where a request came from, for the `[Auth]` event log (sc-378). Set per REST request; a socket's comes from its handshake. */
export interface NexusRequestOrigin {
  /** The client's address, resolved with the trusted proxy hops. */
  ip?: string;
  userAgent?: string;
}

/**
 * Shared ALS used by nexus server: `wrap(client, handler)` for deferred work,
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
  setRequestOrigin,
  useRequestOrigin,
} = createAsyncContext({
  config: required<ServerConfig>(),
  logger: required<Logger>(),
  client: optional<Socket>(),
  authData: optional<NexusAuthData>(),
  requestOrigin: optional<NexusRequestOrigin>(),
});
