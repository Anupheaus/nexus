export interface SocketAPISubscription<Name extends string, Request, Response> {
  name: Name;
  requestType?: Request;
  responseType?: Response;
  isPublic?: boolean;
}

export interface DefineSubscriptionOptions {
  /** When true, unauthenticated clients may subscribe. Defaults to false (auth required). */
  isPublic?: boolean;
}

/**
 * Declares a typed streaming subscription contract shared by client and server.
 *
 * Curried factory — call with type params first, then the name:
 * `defineSubscription<{ interval: number }, { count: number }>()('liveStats')`.
 *
 * Pass the result to `createServerSubscription` on the server and `useSubscription` on the client.
 */
export function defineSubscription<Request, Response>() {
  return <Name extends string>(name: Name, options?: DefineSubscriptionOptions): SocketAPISubscription<Name, Request, Response> => ({
    name,
    ...(options?.isPublic === true ? { isPublic: true } : {}),
  });
}
