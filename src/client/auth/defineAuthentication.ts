import type { SocketAPIUser, SocketAPIAccount } from '../../common';
import { useAuthentication } from './useAuthentication';
import type { ClientUseAuthResult } from './useAuthentication';

export function defineAuthentication<U extends SocketAPIUser, A extends SocketAPIAccount = SocketAPIAccount, C = void>() {
  return {
    configureAuthentication: null as never,
    useAuthentication(): ClientUseAuthResult<U, A, C> {
      return useAuthentication<U, A, C>();
    },
  };
}
