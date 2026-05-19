/** Server-side limits for an action (enforced in `createServerActionHandler`). */
export interface NexusActionServerOptions {
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

export interface RestActionOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL template with named path params matching request property names, e.g. `/users/:id` */
  url: string;
}

export interface NexusAction<Name extends string, Request, Response> {
  name: Name;
  requestType?: Request;
  responseType?: Response;
  server?: NexusActionServerOptions;
  isPublic?: boolean;
  rest?: RestActionOptions;
  /** Which transports this action is callable on. Default (undefined): both. */
  transport?: Array<'socket' | 'rest'>;
}

export interface DefineActionOptions {
  server?: NexusActionServerOptions;
  /** When true, unauthenticated clients may call this action. Defaults to false (auth required). */
  isPublic?: boolean;
  /** REST endpoint config. If omitted, the action is reachable via the auto catch-all POST /{name}/actions/:actionName. */
  rest?: RestActionOptions;
  /** Which transports this action is callable on. Default (undefined): both. */
  transport?: Array<'socket' | 'rest'>;
}

/**
 * Declares a typed RPC action contract shared by client and server.
 *
 * Curried factory — call with type params first, then the name:
 * `defineAction<{ id: string }, User>()('getUser')`.
 *
 * The returned contract is passed to `createServerActionHandler` on the server and `useAction`
 * on the client. Both directions share the same wire name (`nexus.actions.{name}`).
 *
 * @throws When `name` contains a `/`, or when `rest` and `transport` are contradictory.
 */
export function defineAction<Request, Response>() {
  return <Name extends string>(
    name: Name,
    options?: DefineActionOptions,
  ): NexusAction<Name, Request, Response> => {
    if (name.includes('/')) throw new Error(`Action name "${name}" must not contain a slash — it is used as a URL path segment.`);
    if (options?.rest != null && options?.transport != null && !options.transport.includes('rest')) {
      throw new Error(`Action "${name}" cannot have a rest config when transport excludes 'rest'.`);
    }
    return {
      name,
      ...(options?.server != null ? { server: options.server } : {}),
      ...(options?.isPublic === true ? { isPublic: true } : {}),
      ...(options?.rest != null ? { rest: options.rest } : {}),
      ...(options?.transport != null ? { transport: options.transport } : {}),
    };
  };
}
