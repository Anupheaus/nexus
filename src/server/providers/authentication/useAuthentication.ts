import crypto from 'crypto';
import type { MakePromise } from '@anupheaus/common';
import type { SocketAPIUser } from '../../../common';
import { socketAPIUserChanged } from '../../../common/internalEvents';
import { useEvent } from '../../events';
import { internalUseSocket } from '../socket';
import { useAuthData, setAuthData, wrap } from '../../async-context/socketApiContext';
import { getAuthConfig } from '../../auth/authConfig';
import type { CreateInviteOptions } from '../../auth/defineAuthentication';

export function useAuthentication<UserType extends SocketAPIUser = SocketAPIUser>() {
  function getUser(): UserType | undefined {
    return useAuthData()?.user as UserType | undefined;
  }

  function getAccountId(): string | undefined {
    return useAuthData()?.accountId;
  }

  async function setUser(user: UserType | undefined, accountId?: string) {
    const { getClient } = internalUseSocket();
    const emitUserChanged = useEvent(socketAPIUserChanged);

    const existingAuthData = useAuthData() ?? {};
    // When user is cleared, clear account too. When accountId is omitted, preserve the existing one.
    const resolvedAccountId = user == null ? undefined : (accountId ?? existingAuthData.accountId);
    setAuthData({ ...existingAuthData, user, accountId: resolvedAccountId });

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

  async function createInvite({ userId, baseUrl, accountId }: CreateInviteOptions): Promise<string> {
    const authConfig = getAuthConfig();
    if (!authConfig || authConfig.mode !== 'webauthn') {
      throw new Error('createInvite is only available in webauthn mode');
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

  return {
    get user() { return getUser(); },
    get accountId() { return getAccountId(); },
    setUser,
    signOut,
    impersonateUser,
    createInvite,
  };
}
