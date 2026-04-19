import type { Record, LoggerEntry } from '@anupheaus/common';
import type { Socket } from 'socket.io';

export interface SocketAPICredentials {
  id: string;
  password: string;
}

export interface SocketAPIUser extends Record {}

export type SocketAPIClientLoggingService = (client: Socket, user: SocketAPIUser | undefined) => (entries: LoggerEntry[]) => Promise<void>;
