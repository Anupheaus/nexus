/** Server-side limits for an action (enforced in `createServerActionHandler`). */
export interface SocketAPIActionServerOptions {
  /** When all concurrent slots are busy, wait here up to `max` waiters. Requires `concurrent` or defaults to 1 in-flight when only `queue` is set. */
  queue?: {
    /** Maximum number of requests waiting for a slot (not counting in-flight). */
    max: number;
    /** Max time (ms) a request may wait in the queue before failing the ack. */
    timeout?: number;
  };
  /** Cap how many handler invocations run at once for this action (shared across connections). */
  concurrent?: {
    max: number;
  };
}

export interface SocketAPIAction<Name extends string, Request, Response> {
  name: Name;
  requestType?: Request;
  responseType?: Response;
  server?: SocketAPIActionServerOptions;
  isPublic?: boolean;
}

export interface DefineActionOptions {
  server?: SocketAPIActionServerOptions;
  /** When true, unauthenticated clients may call this action. Defaults to false (auth required). */
  isPublic?: boolean;
}

export function defineAction<Request, Response>() {
  return <Name extends string>(
    name: Name,
    options?: DefineActionOptions,
  ): SocketAPIAction<Name, Request, Response> => ({
    name,
    ...(options?.server != null ? { server: options.server } : {}),
    ...(options?.isPublic === true ? { isPublic: true } : {}),
  });
}
