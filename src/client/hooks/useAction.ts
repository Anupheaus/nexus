import { useContext, useLayoutEffect, useRef, useState } from 'react';
import type { NexusAction } from '../../common';
import { getErrorFromAckResponse, throwIfAckError } from '../../common/ackResponse';
import { useSocket } from '../providers';
import { AuthenticationError, Error, to } from '@anupheaus/common';
import { actionPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';
import { resolveTransport, isRestOnly } from './resolveTransport';

function a<Request, Response>(request: Request, response: (response: Response) => void): void;
function a<Request, Response>(request: Request): Promise<Response>;
function a<Request, Response>(_request: Request, _response?: (response: Response) => void): void | Promise<Response> {
  return;
}

export type UseAction<Name extends string, Request, Response> =
  { isConnected(): boolean; }
  & { [P in Name]: typeof a<Request, Response>; }
  & { [P in `use${Capitalize<Name>}`]: (request: Request) => { response: Response | undefined; error: Error | undefined; isLoading: boolean; }; };

// eslint-disable-next-line max-len
export type GetUseActionType<ActionType extends NexusAction<any, any, any>> = ActionType extends NexusAction<infer Name, infer Request, infer Response> ? UseAction<Name, Request, Response>[Name] : never;

function buildRestCall(
  name: string,
  action: NexusAction<string, unknown, unknown>,
  request: unknown,
): { url: string; method: string; body?: string; headers: Record<string, string> } {
  const req = (request ?? {}) as Record<string, unknown>;

  if (!action.rest) {
    return {
      url: `/${name}/actions/${action.name}`,
      method: 'POST',
      // to.serialise (not JSON.stringify) so DateTime/Error round-trip like the socket transport does.
      body: to.serialise(req),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const { method, url: urlTemplate } = action.rest;
  const paramNames = [...urlTemplate.matchAll(/:(\w+)/g)].map(m => m[1]).filter((n): n is string => n != null);
  // Substitute the API name before path-param replacement so it doesn't interfere.
  let url = urlTemplate.replace('{name}', name);
  const remaining: Record<string, unknown> = { ...req };
  for (const paramName of paramNames) {
    url = url.replace(`:${paramName}`, encodeURIComponent(String(remaining[paramName] ?? '')));
    delete remaining[paramName];
  }

  if (method === 'GET' || method === 'DELETE') {
    const qs = new URLSearchParams(
      Object.entries(remaining)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return { url: qs ? `${url}?${qs}` : url, method, headers: {} };
  }

  return {
    url,
    method,
    body: to.serialise(remaining),
    headers: { 'Content-Type': 'application/json' },
  };
}

/** Parse a REST response body as JSON, or `undefined` when it isn't JSON (e.g. Koa's plain-text
 *  "Unauthorized" body for an auth-gate rejection), so the status-based handling below still runs. */
async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json() as unknown;
  } catch {
    // Non-JSON body — callers decide from the status alone.
    return undefined;
  }
}

/** The `{ error: { message } }` reason a nexus REST handler returns on failure, if present. */
function getServerErrorMessage(data: unknown): string | undefined {
  if (data == null || typeof data !== 'object' || !('error' in data)) return undefined;
  const { error } = data as { error?: { message?: unknown } };
  return typeof error?.message === 'string' && error.message !== '' ? error.message : undefined;
}

interface RestCall<Response> {
  name: string;
  /** Prefix for the action URL — '' for page-relative, else the socket host's origin (see `toRestOrigin`). */
  restOrigin: string;
  action: NexusAction<string, unknown, Response>;
  request: unknown;
}

async function callRest<Response>({ name, restOrigin, action, request }: RestCall<Response>): Promise<Response> {
  const { url, method, body, headers } = buildRestCall(name, action, request);
  const res = await fetch(`${restOrigin}${url}`, {
    method,
    credentials: 'include',
    headers,
    ...(body != null ? { body } : {}),
  });
  const data = await readJsonBody(res);
  const serverMessage = getServerErrorMessage(data);
  // Keep the handler's own reason (e.g. "The user provided was not recognised") so auth screens can
  // explain the failure; a bare 401 (auth gate rejection, no body) still reads as "Unauthorized".
  if (res.status === 401) throw new AuthenticationError(serverMessage ?? 'Unauthorized');
  if (!res.ok || serverMessage != null) throw new globalThis.Error(serverMessage ?? `REST action failed: ${res.status}`);
  // Rehydrate DateTime (and other serialised types) like the socket transport's reconstruct does.
  return to.deserialise(data) as Response;
}

export function useAction<Name extends string, Request, Response>(action: NexusAction<Name, Request, Response>): UseAction<Name, Request, Response> {
  const { getIsConnected, getRawSocket, emit, onConnected } = useSocket();
  const { name, getRestOrigin } = useContext(SocketContext);
  const callActionRest = (request: unknown): Promise<Response> =>
    callRest<Response>({ name, restOrigin: getRestOrigin?.() ?? '', action, request });

  return {
    [action.name]: async (request: Request, response?: (response: Response) => void) => {
      const transport = resolveTransport(action, getIsConnected());
      if (transport === 'wait') throw new globalThis.Error(`Cannot call socket-only action '${action.name}' while disconnected`);
      if (typeof response === 'function') {
        if (transport === 'socket') {
          emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(res => response(throwIfAckError(res)));
        } else {
          callActionRest(request).then(response);
        }
      } else {
        if (transport === 'socket') {
          return emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(throwIfAckError);
        } else {
          return callActionRest(request);
        }
      }
    },
    [`use${action.name.toPascalCase()}`]: (request: Request) => {
      const [state, setState] = useState<{ response: Response | undefined; error: Error | undefined; isLoading: boolean; }>({ response: undefined, error: undefined, isLoading: true });
      const isMonitoringErrorRef = useRef(false);
      // Serialize request for dep comparison — re-fires when the request value changes.
      const requestKey = JSON.stringify(request);

      useLayoutEffect(() => {
        setState({ response: undefined, error: undefined, isLoading: true });
        const doEmit = async () => {
          try {
            let response: Response | undefined;
            let error: Error | undefined;
            const transport = resolveTransport(action, getIsConnected());
            if (transport === 'socket') {
              const result = getErrorFromAckResponse(await emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request));
              response = result.response;
              error = result.error;
            } else if (transport === 'rest' && (getRawSocket() == null || isRestOnly(action))) {
              // REST: either no socket is configured at all, or the action is constrained to REST.
              response = await callActionRest(request);
            } else {
              // Socket is configured and the action can use it — defer until onConnected fires.
              return;
            }
            setState({ response, error, isLoading: false });
          } catch (err) {
            if (isMonitoringErrorRef.current) {
              setState({ response: undefined, error: new Error({ error: err }), isLoading: false });
            } else {
              throw err;
            }
          }
        };
        doEmit();
        // Register onConnected when the action must wait — either because it is socket-only,
        // or because the action can use a socket that is configured but not yet connected.
        const pendingTransport = resolveTransport(action, getIsConnected());
        if (pendingTransport === 'wait' || (pendingTransport === 'rest' && !isRestOnly(action) && getRawSocket() != null)) {
          onConnected(() => doEmit());
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [requestKey]);

      return {
        ...state,
        get error() {
          isMonitoringErrorRef.current = true;
          return state.error;
        },
      };
    },
    isConnected: getIsConnected,
  } as UseAction<Name, Request, Response>;
}
