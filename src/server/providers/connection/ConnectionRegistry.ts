import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'socket.io';
import { Connection, DEFAULT_CONNECTION_TTL_MS } from './Connection';

const COOKIE_NAME = 'nexus-conn';

function parseCookieId(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) return trimmed.slice(COOKIE_NAME.length + 1);
  }
  return undefined;
}

function generateId(): string {
  return crypto.randomUUID();
}

function isSecureRequest(req: IncomingMessage): boolean {
  return (req.socket as any)?.encrypted === true;
}

export class ConnectionRegistry {
  constructor(ttlMs = DEFAULT_CONNECTION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private readonly connections = new Map<string, Connection>();
  private readonly ttlMs: number;

  /**
   * Resolves (or creates) the Connection for a REST request.
   * Reads the connection ID from the HTTP-only cookie; sets it on the response if new or expired.
   * Also calls `touch()` to reset the TTL.
   */
  fromRequest(req: IncomingMessage, res: ServerResponse): Connection {
    const cookieHeader = req.headers.cookie ?? '';
    const existingId = parseCookieId(cookieHeader);
    const id = existingId != null && this.connections.has(existingId) ? existingId : generateId();
    if (id !== existingId) {
      const secure = isSecureRequest(req) ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Strict; Path=/${secure}`);
    }
    const connection = this.getOrCreate(id);
    connection.touch();
    return connection;
  }

  /**
   * Resolves (or creates) the Connection for a WebSocket client.
   * Reads the connection ID from the Socket.IO handshake cookie.
   */
  fromSocket(socket: Socket): Connection {
    const cookieHeader = socket.handshake.headers.cookie ?? '';
    // Fall back to socket.id (stable for the lifetime of the socket) when no cookie is present.
    const id = parseCookieId(cookieHeader) ?? socket.id;
    return this.getOrCreate(id);
  }

  private getOrCreate(id: string): Connection {
    let connection = this.connections.get(id);
    if (connection == null) {
      connection = new Connection(id, this.ttlMs, () => this.connections.delete(id));
      this.connections.set(id, connection);
    }
    return connection;
  }
}
