import crypto from 'crypto';
import type { MakePromise } from '@anupheaus/common';
import { AuthenticationError } from '@anupheaus/common';
import type { SocketAPIAccount, SocketAPIUser } from '../../../common';
import { socketAPIUserChanged, socketAPIAccountChanged } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, wrap } from '../../async-context/socketApiContext';
import { getAuthConfig } from '../../auth/authConfig';
import type { CreateInviteOptions } from '../../auth/defineAuthentication';
import { refreshGoogleToken } from '../../auth/googleTokenRefresh';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser, AccountType extends SocketAPIAccount = SocketAPIAccount>() {
  function getUser(): UserType | undefined {
    return useAuthData()?.user as UserType | undefined;
  }

  function getAccount(): AccountType | undefined {
    return useAuthData()?.account as AccountType | undefined;
  }

  async function setUser(user: UserType | undefined, sessionToken?: string) {
    const { getClient } = internalUseSocket();
    const emitUserChanged = useEvent(socketAPIUserChanged);

    const existingAuthData = useAuthData() ?? {};
    const resolvedAccount = user == null ? undefined : existingAuthData.account;
    setAuthData({ ...existingAuthData, user, account: resolvedAccount, token: sessionToken });

    const authConfig = getAuthConfig();
    const syncUserToClient = authConfig?.syncUserToClient ?? true;

    if (syncUserToClient) {
      const client = getClient();
      if (client != null) emitUserChanged({ user });
    }
  }

  async function setAccount(account: AccountType | undefined) {
    const { getClient } = internalUseSocket();
    const emitAccountChanged = useEvent(socketAPIAccountChanged);

    const existingAuthData = useAuthData() ?? {};
    setAuthData({ ...existingAuthData, account });

    const authConfig = getAuthConfig();
    const syncUserToClient = authConfig?.syncUserToClient ?? true;

    if (syncUserToClient) {
      const client = getClient();
      if (client != null) emitAccountChanged({ account });
    }
  }

  async function signOut() {
    await setUser(undefined);
    await setAccount(undefined);
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

  async function createInvite({ userId, baseUrl, accountId }: CreateInviteOptions): Promise<string> {
    const authConfig = getAuthConfig();
    if (!authConfig || authConfig.mode !== 'webauthn') {
      throw new AuthenticationError({ message: 'createInvite is only available in webauthn mode' });
    }
    const requestId = crypto.randomUUID();
    await authConfig.store.create({
      requestId,
      userId,
      accountId,
      isEnabled: false,
      sessionToken: '',
      deviceId: '',
    });
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}?requestId=${requestId}`;
  }

  async function getGoogleToken(): Promise<string> {
    const authConfig = getAuthConfig();
    if (!authConfig || authConfig.mode !== 'google-oauth') {
      throw new AuthenticationError({ message: 'getGoogleToken is only available in google-oauth mode' });
    }
    const sessionToken = useAuthData()?.token;
    if (!sessionToken) throw new AuthenticationError({ message: 'No active Google OAuth session' });
    return refreshGoogleToken({ store: authConfig.store, clientId: authConfig.clientId, clientSecret: authConfig.clientSecret, sessionToken });
  }

  return {
    get user() { return getUser(); },
    get account() { return getAccount(); },
    setUser,
    setAccount,
    signOut,
    impersonateUser,
    createInvite,
    getGoogleToken,
  };
}
