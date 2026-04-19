import { useContext, useLayoutEffect, useRef, useState } from 'react';
import type { SocketAPIAction } from '../../common';
import { getErrorFromAckResponse, throwIfAckError } from '../../common/ackResponse';
import { useSocket } from '../providers';
import { Error } from '@anupheaus/common';
import { actionPrefix } from '../../common/internalModels';
import { SocketContext } from '../providers/socket/SocketContext';

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
export type GetUseActionType<ActionType extends SocketAPIAction<any, any, any>> = ActionType extends SocketAPIAction<infer Name, infer Request, infer Response> ? UseAction<Name, Request, Response>[Name] : never;

function buildRestCall(
  name: string,
  action: SocketAPIAction<string, unknown, unknown>,
  request: unknown,
): { url: string; method: string; body?: string; headers: Record<string, string> } {
  const req = (request ?? {}) as Record<string, unknown>;

  if (!action.rest) {
    return {
      url: `/${name}/actions/${action.name}`,
      method: 'POST',
      body: JSON.stringify(req),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const { method, url: urlTemplate } = action.rest;
  const paramNames = [...urlTemplate.matchAll(/:(\w+)/g)].map(m => m[1]);
  let url = urlTemplate;
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
    body: JSON.stringify(remaining),
    headers: { 'Content-Type': 'application/json' },
  };
}

async function callRest<Response>(
  name: string,
  action: SocketAPIAction<string, unknown, Response>,
  request: unknown,
): Promise<Response> {
  const { url, method, body, headers } = buildRestCall(name, action, request);
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    ...(body != null ? { body } : {}),
  });
  const data = await res.json() as unknown;
  if (res.status === 401) throw new globalThis.Error('Unauthorized');
  if (!res.ok || (data != null && typeof data === 'object' && 'error' in data)) {
    const msg = (data as any)?.error?.message ?? `REST action failed: ${res.status}`;
    throw new globalThis.Error(msg);
  }
  return data as Response;
}

export function useAction<Name extends string, Request, Response>(action: SocketAPIAction<Name, Request, Response>): UseAction<Name, Request, Response> {
  const { getIsConnected, emit, onConnected } = useSocket();
  const { name } = useContext(SocketContext);

  return {
    [action.name]: async (request: Request, response?: (response: Response) => void) => {
      if (typeof response === 'function') {
        if (getIsConnected()) {
          emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(res => response(throwIfAckError(res)));
        } else {
          callRest<Response>(name, action, request).then(response);
        }
      } else {
        if (getIsConnected()) {
          return emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(throwIfAckError);
        } else {
          return callRest<Response>(name, action, request);
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
            if (getIsConnected()) {
              const result = getErrorFromAckResponse(await emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request));
              response = result.response;
              error = result.error;
            } else {
              response = await callRest<Response>(name, action, request);
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
        if (getIsConnected()) {
          doEmit();
        } else {
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
