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

/**
 * Adds a cookie to the response without replacing any it already sets: a response may set several, each its own
 * `Set-Cookie` header.
 */
function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (existing == null) { res.setHeader('Set-Cookie', cookie); return; }
  const cookies = Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader('Set-Cookie', [...cookies, cookie]);
}

function isEncryptedSocket(req: IncomingMessage): boolean {
  return (req.socket as any)?.encrypted === true;
}

export interface FromRequestOptions {
  /**
   * Whether the client reached the server over https. Pass Koa's `ctx.secure`: behind a trusted TLS-terminating
   * proxy the socket is plain HTTP, and only the proxy's X-Forwarded-Proto says the client used https. Defaults to
   * whether the socket itself is encrypted.
   */
  isSecure?: boolean;
}

export class ConnectionRegistry {
  constructor(ttlMs = DEFAULT_CONNECTION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private readonly connections = new Map<string, Connection>();
  /**
   * The connection each request in flight resolved to. A request passes through several wraps (the HTTP server's, the
   * REST action's), and one without a cookie would otherwise get a new connection, and a new cookie, at each.
   */
  private readonly requestConnections = new WeakMap<IncomingMessage, Connection>();
  private readonly ttlMs: number;

  /**
   * Resolves (or creates) the Connection for a REST request.
   * Reads the connection ID from the HTTP-only cookie; sets it on the response if new or expired.
   * Also calls `touch()` to reset the TTL. The same request always resolves to the same connection.
   */
  fromRequest(req: IncomingMessage, res: ServerResponse, { isSecure = isEncryptedSocket(req) }: FromRequestOptions = {}): Connection {
    const resolved = this.requestConnections.get(req);
    if (resolved != null) {
      resolved.touch();
      return resolved;
    }
    const cookieHeader = req.headers.cookie ?? '';
    const existingId = parseCookieId(cookieHeader);
    const id = existingId != null && this.connections.has(existingId) ? existingId : generateId();
    if (id !== existingId) {
      const secure = isSecure ? '; Secure' : '';
      appendSetCookie(res, `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Strict; Path=/${secure}`);
    }
    const connection = this.getOrCreate(id);
    this.requestConnections.set(req, connection);
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
