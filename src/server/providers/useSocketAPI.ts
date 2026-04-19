import type { AnyFunction } from '@anupheaus/common';
import type { SocketAPIUser } from '../../common';
import { useAuthentication } from './authentication';
import { internalUseSocket } from './socket';
import { useConfig, wrap } from '../async-context';

export function useSocketAPI<UserType extends SocketAPIUser = SocketAPIUser>() {
  const config = useConfig();
  const { getClient } = internalUseSocket();
  const authentication = useAuthentication<UserType>();

  function wrapWithSocketAPI<T extends AnyFunction>(handler: T) {
    const client = getClient(true);
    return wrap(client, handler) as T;
  }

  return {
    config,
    getClient,
    ...authentication,
    wrapWithSocketAPI,
  };
}
