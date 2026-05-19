import type { PromiseMaybe } from '@anupheaus/common';
import type { SocketAPIEvent } from '../../common';
import { eventPrefix } from '../../common/internalModels';
import { useSocket } from '../providers';
import { useRef } from 'react';

export type GetUseEventType<EventType extends SocketAPIEvent<any>> = EventType extends SocketAPIEvent<infer T> ? ReturnType<typeof useEvent<T>> : never;

export function useEvent<T>(event: SocketAPIEvent<T>) {
  const { on } = useSocket();
  const handlerRef = useRef<(payload: T) => PromiseMaybe<void>>(() => void 0);

  on<T>(`${eventPrefix}.${event.name}`, payload => handlerRef.current(payload));

  return (handler: (payload: T) => PromiseMaybe<void>) => { handlerRef.current = handler; };
}