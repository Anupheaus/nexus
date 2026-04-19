import type { MakePromise } from '@anupheaus/common';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserAuthenticated, socketAPIUserSignOut } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { jwt } from '../../jwt';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, useConfig, wrap } from '../../async-context/socketApiContext';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser>() {
  function getUser() {
    return useAuthData()?.user as UserType | undefined;
  }

  async function setUserInternally(user: UserType | undefined, ignoreClient: boolean = false) {
    const { getClient } = internalUseSocket();
    const userAuthenticated = useEvent(socketAPIUserAuthenticated);
    const userSignOut = useEvent(socketAPIUserSignOut);

    const existingAuthData = useAuthData() ?? {};
    if (user == null) {
      if (existingAuthData.token != null) return;
      setAuthData({ ...existingAuthData, token: undefined, privateKey: undefined, publicKey: undefined, user: undefined });
      userSignOut();
    } else {
      const innerClient = getClient();
      if (!ignoreClient && innerClient == null) throw new Error('Client is not available at this location.');
      const { onSavePrivateKey, privateKey: providedPrivateKey } = useConfig();
      const { token, privateKey, publicKey } = await jwt.createTokenFromUser(user, providedPrivateKey);
      setAuthData({ user, token, privateKey, publicKey });

      if (!ignoreClient && innerClient != null) {
        await onSavePrivateKey?.(innerClient, user, privateKey);
        userAuthenticated({ token, publicKey });
      }
    }
  }

  async function setUser(user: UserType | undefined) {
    const { getClient } = internalUseSocket();
    const userAuthenticated = useEvent(socketAPIUserAuthenticated);
    const userSignOut = useEvent(socketAPIUserSignOut);

    const existingAuthData = useAuthData() ?? {};
    if (user == null) {
      if (existingAuthData.token != null) return;
      setAuthData({ ...existingAuthData, token: undefined, privateKey: undefined, publicKey: undefined, user: undefined });
      userSignOut();
    } else {
      const innerClient = getClient(true);
      const { onSavePrivateKey, privateKey: providedPrivateKey } = useConfig();
      const { token, privateKey, publicKey } = await jwt.createTokenFromUser(user, providedPrivateKey);
      setAuthData({ user, token, privateKey, publicKey });
      await onSavePrivateKey?.(innerClient, user, privateKey);
      userAuthenticated({ token, publicKey });
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
