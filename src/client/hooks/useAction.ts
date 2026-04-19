import { useLayoutEffect, useRef, useState } from 'react';
import type { SocketAPIAction } from '../../common';
import { getErrorFromAckResponse, throwIfAckError } from '../../common/ackResponse';
import { useSocket } from '../providers';
import { Error } from '@anupheaus/common';
import { actionPrefix } from '../../common/internalModels';

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

export function useAction<Name extends string, Request, Response>(action: SocketAPIAction<Name, Request, Response>): UseAction<Name, Request, Response> {
  const { getIsConnected, emit, onConnected } = useSocket();
  return {
    [action.name]: async (request: Request, response?: (response: Response) => void) => {
      if (typeof (response) === 'function') {
        emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(res => response(throwIfAckError(res)));
      } else {
        return emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request).then(throwIfAckError);
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
            const { response, error } = getErrorFromAckResponse(await emit<Response, Request>(`${actionPrefix}.${action.name.toString()}`, request));
            setState({ response, error, isLoading: false });
          } catch (error) {
            if (isMonitoringErrorRef.current) {
              setState({ response: undefined, error: new Error({ error }), isLoading: false });
            } else {
              throw error;
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