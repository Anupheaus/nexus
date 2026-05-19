import type { NexusUser, NexusAccount } from '../../common';
import { useAuthentication } from './useAuthentication';
import type { ClientUseAuthResult } from './useAuthentication';

export function defineAuthentication<U extends NexusUser, A extends NexusAccount = NexusAccount, C = void>() {
  return {
    configureAuthentication: null as never,
    useAuthentication(): ClientUseAuthResult<U, A, C> {
      return useAuthentication<U, A, C>();
    },
  };
}
