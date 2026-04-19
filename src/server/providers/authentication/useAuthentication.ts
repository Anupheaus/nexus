import type { MakePromise } from '@anupheaus/common';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserChanged } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, wrap } from '../../async-context/socketApiContext';
import { getAuthConfig } from '../../auth/authConfig';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser>() {
  function getUser(): UserType | undefined {
    return useAuthData()?.user as UserType | undefined;
  }

  async function setUser(user: UserType | undefined) {
    const { getClient } = internalUseSocket();
    const emitUserChanged = useEvent(socketAPIUserChanged);

    const existingAuthData = useAuthData() ?? {};
    setAuthData({ ...existingAuthData, user });

    const authConfig = getAuthConfig();
    const syncUserToClient = authConfig?.syncUserToClient ?? true;

    if (syncUserToClient) {
      const client = getClient();
      if (client != null) emitUserChanged({ user });
    }
  }

  async function signOut() {
    await setUser(undefined);
  }

  function impersonateUser<ImpersonatedUserType extends SocketAPIUser, T>(
    user: ImpersonatedUserType,
    handler: () => T,
  ): MakePromise<T> {
    const newTarget = {};
    return wrap(newTarget, async () => {
      await setUser(user as unknown as UserType);
      return handler();
    })() as MakePromise<T>;
  }

  return {
    get user() { return getUser(); },
    setUser,
    signOut,
    impersonateUser,
  };
}
