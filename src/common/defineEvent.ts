export interface SocketAPIEvent<T> {
  name: string;
  argsType?: T;
}

/**
 * Declares a typed server-push event contract.
 *
 * Pass the result to `useEvent` on the server to emit, and to `useEvent` on the client to listen.
 * Wire name: `socket-api.events.{name}`.
 *
 * @param name - Unique wire name for the event.
 */
export function defineEvent<T>(name: string): SocketAPIEvent<T> {
  return {
    name,
  };
}
