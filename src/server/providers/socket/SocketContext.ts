import type { PromiseMaybe } from '@anupheaus/common';
import type { Server, Socket } from 'socket.io';

export interface SocketClientConnectedProps {
  client: Socket;
}

export interface SocketContextProps {
  socket: Server;
  onClientConnected(callback: (props: SocketClientConnectedProps) => PromiseMaybe<((client: Socket) => void) | void>): void;
}
