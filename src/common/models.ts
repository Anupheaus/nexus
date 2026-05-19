import type { Record, LoggerEntry } from '@anupheaus/common';
import type { Socket } from 'socket.io';

export interface NexusCredentials {
  id: string;
  password: string;
}

export interface NexusUser extends Record {}

export interface NexusAccount extends Record {}

export type NexusClientLoggingService = (client: Socket, user: NexusUser | undefined) => (entries: LoggerEntry[]) => Promise<void>;
