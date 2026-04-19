import type { PromiseMaybe } from '@anupheaus/common';
import type { SocketAPIAction } from '../../common';
import { wrapAckHandler } from '../../common/ackResponse';
import { actionPrefix } from '../../common/internalModels';
import { useSocket } from '../providers';
import { useLayoutEffect, useRef } from 'react';

export type GetUseServerActionHandlerType<ActionType extends SocketAPIAction<any, any, any>> =
  ActionType extends SocketAPIAction<infer _Name, infer Request, infer Response>
    ? (handler: (request: Request) => PromiseMaybe<Response>) => void
    : never;

/**
 * Registers the only allowed handler for a server-initiated action (RPC). At most one `useServerActionHandler` per action
 * in the tree; a second registration throws. Pair with server `useAction` (`@anupheaus/socket-api/server`) using the same `defineAction` contract.
 */
export function useServerActionHandler<Name extends string, Request, Response>(action: SocketAPIAction<Name, Request, Response>) {
  const { onExclusive, off } = useSocket();
  const handlerRef = useRef<(request: Request) => PromiseMaybe<Response>>(() => {
    throw new Error(`No handler registered for server action "${action.name}".`);
  });

  const eventName = `${actionPrefix}.${action.name}`;

  useLayoutEffect(() => {
    onExclusive<Request>(eventName, request => wrapAckHandler(() => handlerRef.current(request)));
    return () => off(eventName);
  }, [eventName, off, onExclusive]);

  return (handler: (request: Request) => PromiseMaybe<Response>) => {
    handlerRef.current = handler;
  };
}
