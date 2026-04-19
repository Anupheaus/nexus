import type { MakePromise } from '@anupheaus/common';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserSignOut } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, wrap } from '../../async-context/socketApiContext';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser>() {
  function getUser() {
    return useAuthData()?.user as UserType | undefined;
  }

  async function setUserInternally(user: UserType | undefined, ignoreClient: boolean = false) {
    const { getClient } = internalUseSocket();
    const userSignOut = useEvent(socketAPIUserSignOut);

    const existingAuthData = useAuthData() ?? {};
    if (user == null) {
      if (existingAuthData.user == null) return;
      setAuthData({ ...existingAuthData, token: undefined, privateKey: undefined, publicKey: undefined, user: undefined });
      userSignOut();
    } else {
      const innerClient = getClient();
      if (!ignoreClient && innerClient == null) throw new Error('Client is not available at this location.');
      setAuthData({ user });
    }
  }

  async function setUser(user: UserType | undefined) {
    const { getClient } = internalUseSocket();
    const userSignOut = useEvent(socketAPIUserSignOut);

    const existingAuthData = useAuthData() ?? {};
    if (user == null) {
      if (existingAuthData.user == null) return;
      setAuthData({ ...existingAuthData, token: undefined, privateKey: undefined, publicKey: undefined, user: undefined });
      userSignOut();
    } else {
      getClient(true);
      setAuthData({ user });
    }
  }

  function impersonateUser<ImpersonatedUserType extends SocketAPIUser, T>(user: ImpersonatedUserType, handler: () => T): MakePromise<T> {
    const newTarget = {};
    return wrap(newTarget, async () => {
      await setUserInternally(user as unknown as UserType, true);
      return handler();
    })() as MakePromise<T>;
  }

  return {
    getUser,
    setUser,
    impersonateUser,
  };
}
