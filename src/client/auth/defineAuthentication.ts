import type { SocketAPIUser } from '../../common';
import { useAuthentication } from '../hooks/useAuthentication';
import type { ClientUseAuthResult } from '../hooks/useAuthentication';

export function defineAuthentication<U extends SocketAPIUser, C = void>() {
  return {
    configureAuthentication: null as never,
    useAuthentication(): ClientUseAuthResult<U, C> {
      return useAuthentication<U, C>();
    },
  };
}
