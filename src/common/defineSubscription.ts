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

export function defineSubscription<Request, Response>() {
  return <Name extends string>(name: Name, options?: DefineSubscriptionOptions): SocketAPISubscription<Name, Request, Response> => ({
    name,
    ...(options?.isPublic === true ? { isPublic: true } : {}),
  });
}
