import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthentication } from './useAuthentication';
import { useAuthData, setAuthData } from '../../async-context/nexusContext';
import { getAuthConfig } from '../../auth/authConfig';

// Mock the dependencies
vi.mock('../../async-context/nexusContext', () => ({
  useAuthData: vi.fn(() => undefined),
  setAuthData: vi.fn(),
  wrap: vi.fn((_target: any, fn: any) => fn),
  useConfig: vi.fn(() => ({})),
}));

vi.mock('../socket', () => ({
  internalUseSocket: vi.fn(() => ({
    getClient: vi.fn(() => null),
  })),
}));

vi.mock('../../events', () => ({
  useEvent: vi.fn(() => vi.fn()),
}));

vi.mock('../../auth/authConfig', () => ({
  getAuthConfig: vi.fn(() => ({ syncUserToClient: true })),
}));

describe('server useAuthentication', () => {
  beforeEach(() => {
    vi.mocked(useAuthData).mockReturnValue(undefined);
  });

  it('returns user, account, setUser, setAccount, signOut, impersonateUser, getGoogleToken', () => {
    const auth = useAuthentication();
    expect('user' in auth).toBe(true);
    expect('account' in auth).toBe(true);
    expect(typeof auth.setUser).toBe('function');
    expect(typeof auth.setAccount).toBe('function');
    expect(typeof auth.signOut).toBe('function');
    expect(typeof auth.impersonateUser).toBe('function');
    expect(typeof auth.getGoogleToken).toBe('function');
  });

  it('user is undefined when no auth data', () => {
    const auth = useAuthentication();
    expect(auth.user).toBeUndefined();
  });

  it('account is undefined when no auth data', () => {
    const auth = useAuthentication();
    expect(auth.account).toBeUndefined();
  });

  it('user returns the stored user when auth data exists', () => {
    vi.mocked(useAuthData).mockReturnValue({ user: { id: 'u1' } });
    const auth = useAuthentication();
    expect(auth.user).toEqual({ id: 'u1' });
  });

  it('account returns the stored account when auth data exists', () => {
    vi.mocked(useAuthData).mockReturnValue({ account: { id: 'acct-1' } });
    const auth = useAuthentication();
    expect(auth.account).toEqual({ id: 'acct-1' });
  });

  describe('setUser', () => {
    beforeEach(() => vi.mocked(setAuthData).mockClear());

    it('persists the new user into auth data', async () => {
      vi.mocked(useAuthData).mockReturnValue({});
      await useAuthentication().setUser({ id: 'u99' });
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: 'u99' } }),
      );
    });

    it('clears account when user is set to undefined', async () => {
      vi.mocked(useAuthData).mockReturnValue({ user: { id: 'u1' }, account: { id: 'acct-1' } });
      await useAuthentication().setUser(undefined);
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ user: undefined, account: undefined }),
      );
    });

    it('preserves the existing account when setting a new user', async () => {
      vi.mocked(useAuthData).mockReturnValue({ user: { id: 'old' }, account: { id: 'acct-1' } });
      await useAuthentication().setUser({ id: 'u2' });
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: 'u2' }, account: { id: 'acct-1' } }),
      );
    });

    it('emits the user-changed event to the connected client when syncUserToClient is true', async () => {
      const { useEvent } = await import('../../events');
      const mockEmit = vi.fn();
      vi.mocked(useEvent).mockReturnValueOnce(mockEmit);
      const { internalUseSocket } = await import('../socket');
      vi.mocked(internalUseSocket).mockReturnValueOnce({ getClient: vi.fn(() => ({ id: 'socket-1' })) } as any);

      vi.mocked(getAuthConfig).mockReturnValue({ syncUserToClient: true } as any);
      vi.mocked(useAuthData).mockReturnValue({});

      await useAuthentication().setUser({ id: 'u5' });

      expect(mockEmit).toHaveBeenCalledWith({ user: { id: 'u5' } });
    });

    it('does not emit user-changed when syncUserToClient is false', async () => {
      const { useEvent } = await import('../../events');
      const mockEmit = vi.fn();
      vi.mocked(useEvent).mockReturnValueOnce(mockEmit);

      vi.mocked(getAuthConfig).mockReturnValue({ syncUserToClient: false } as any);
      vi.mocked(useAuthData).mockReturnValue({});

      await useAuthentication().setUser({ id: 'u6' });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('stores the sessionToken in auth data when provided', async () => {
      vi.mocked(useAuthData).mockReturnValue({});
      await useAuthentication().setUser({ id: 'u-token' }, 'tok-abc');
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: 'u-token' }, token: 'tok-abc' }),
      );
    });

    it('stores undefined token when no sessionToken is provided', async () => {
      vi.mocked(useAuthData).mockReturnValue({});
      await useAuthentication().setUser({ id: 'u-no-token' });
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ token: undefined }),
      );
    });
  });

  describe('setAccount', () => {
    beforeEach(() => vi.mocked(setAuthData).mockClear());

    it('persists the new account into auth data', async () => {
      vi.mocked(useAuthData).mockReturnValue({});
      await useAuthentication().setAccount({ id: 'acct-99' });
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ account: { id: 'acct-99' } }),
      );
    });

    it('clears account when called with undefined', async () => {
      vi.mocked(useAuthData).mockReturnValue({ account: { id: 'acct-1' } });
      await useAuthentication().setAccount(undefined);
      expect(vi.mocked(setAuthData)).toHaveBeenCalledWith(
        expect.objectContaining({ account: undefined }),
      );
    });

    it('emits the account-changed event to the connected client when syncUserToClient is true', async () => {
      const { useEvent } = await import('../../events');
      const mockEmit = vi.fn();
      vi.mocked(useEvent).mockReturnValueOnce(mockEmit);
      const { internalUseSocket } = await import('../socket');
      vi.mocked(internalUseSocket).mockReturnValueOnce({ getClient: vi.fn(() => ({ id: 'socket-1' })) } as any);

      vi.mocked(getAuthConfig).mockReturnValue({ syncUserToClient: true } as any);
      vi.mocked(useAuthData).mockReturnValue({});

      await useAuthentication().setAccount({ id: 'acct-5' });

      expect(mockEmit).toHaveBeenCalledWith({ account: { id: 'acct-5' } });
    });
  });

  describe('signOut', () => {
    it('clears user and account', async () => {
      vi.mocked(useAuthData).mockReturnValue({ user: { id: 'u1' }, account: { id: 'acct-1' } });
      vi.mocked(setAuthData).mockClear();
      await useAuthentication().signOut();
      const calls = vi.mocked(setAuthData).mock.calls;
      expect(calls.some(([data]) => (data as any).user === undefined)).toBe(true);
      expect(calls.some(([data]) => (data as any).account === undefined)).toBe(true);
    });
  });

  describe('impersonateUser', () => {
    it('executes the handler and returns its result', async () => {
      vi.mocked(useAuthData).mockReturnValue({});
      const result = await useAuthentication().impersonateUser({ id: 'imp-1' }, () => 'handler-result');
      expect(result).toBe('handler-result');
    });

    it('sets the impersonated user before invoking the handler', async () => {
      vi.mocked(useAuthData).mockReturnValue({});
      vi.mocked(setAuthData).mockClear();

      let userAtCallTime: unknown;
      await useAuthentication().impersonateUser({ id: 'imp-2' }, () => {
        userAtCallTime = vi.mocked(setAuthData).mock.calls.at(-1)?.[0];
      });

      expect((userAtCallTime as any)?.user).toEqual({ id: 'imp-2' });
    });
  });

  describe('getGoogleToken', () => {
    const googleStore = {
      create: vi.fn(),
      findById: vi.fn(),
      findBySessionToken: vi.fn(),
      findByUserId: vi.fn(),
      findByDevice: vi.fn(),
      update: vi.fn(),
    };

    const setupGoogleConfig = () => {
      vi.mocked(getAuthConfig).mockReturnValue({
        mode: 'google-oauth',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://app.com/callback',
        baseScopes: ['openid', 'email'],
        store: googleStore,
        onGetUser: vi.fn(),
        onCreateUser: vi.fn(),
        syncUserToClient: true,
      } as any);
    };

    it('is a function on the returned object', () => {
      expect(typeof useAuthentication().getGoogleToken).toBe('function');
    });

    it('throws when auth mode is not google-oauth', async () => {
      vi.mocked(getAuthConfig).mockReturnValue({ mode: 'jwt', store: {} as any, onAuthenticate: vi.fn(), onGetUser: vi.fn(), syncUserToClient: true });
      await expect(useAuthentication().getGoogleToken()).rejects.toThrow('getGoogleToken is only available in google-oauth mode');
    });

    it('throws when no auth config is set', async () => {
      vi.mocked(getAuthConfig).mockReturnValue(undefined as any);
      await expect(useAuthentication().getGoogleToken()).rejects.toThrow('getGoogleToken is only available in google-oauth mode');
    });

    it('throws when no active session token is stored', async () => {
      setupGoogleConfig();
      vi.mocked(useAuthData).mockReturnValue({ user: { id: 'u1' } });
      await expect(useAuthentication().getGoogleToken()).rejects.toThrow('No active Google OAuth session');
    });
  });

  describe('createInvite', () => {
    const createStoreMock = () => ({
      create: vi.fn(),
      findById: vi.fn(),
      findBySessionToken: vi.fn(),
      findByDevice: vi.fn(),
      findByRegistrationToken: vi.fn(),
      findByKeyHash: vi.fn(),
      update: vi.fn(),
    });

    const setupWebAuthnConfig = (storeMock: ReturnType<typeof createStoreMock>) => {
      vi.mocked(getAuthConfig).mockReturnValue({
        mode: 'webauthn',
        store: storeMock,
        onGetInviteDetails: vi.fn(),
        onGetUser: vi.fn(),
        syncUserToClient: true,
      });
    };

    it('is a function on the returned object', () => {
      const auth = useAuthentication();
      expect(typeof auth.createInvite).toBe('function');
    });

    it('throws when auth mode is not webauthn', async () => {
      vi.mocked(getAuthConfig).mockReturnValue({ mode: 'jwt', store: {} as any, onAuthenticate: vi.fn(), onGetUser: vi.fn(), syncUserToClient: true });
      const auth = useAuthentication();
      await expect(auth.createInvite('u1', 'https://app.com')).rejects.toThrow('createInvite is only available in webauthn mode');
    });

    it('creates a store record and returns invite URL containing requestId', async () => {
      const storeMock = createStoreMock();
      setupWebAuthnConfig(storeMock);
      const auth = useAuthentication();
      const url = await auth.createInvite({ userId: 'user-99', baseUrl: 'https://myapp.com' });
      expect(storeMock.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-99',
        isEnabled: false,
        sessionToken: '',
        deviceId: '',
      }));
      expect(url).toMatch(/^https:\/\/myapp\.com\?requestId=.+/);
    });

    it('stores accountId in the auth record when provided', async () => {
      const storeMock = createStoreMock();
      setupWebAuthnConfig(storeMock);
      const auth = useAuthentication();
      await auth.createInvite({ userId: 'user-1', baseUrl: 'https://app.com', accountId: 'account-42' });
      expect(storeMock.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        accountId: 'account-42',
      }));
    });

    it('stores undefined accountId when accountId is not provided', async () => {
      const storeMock = createStoreMock();
      setupWebAuthnConfig(storeMock);
      const auth = useAuthentication();
      await auth.createInvite({ userId: 'user-1', baseUrl: 'https://app.com' });
      expect(storeMock.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        accountId: undefined,
      }));
    });

    it('trims a trailing slash from baseUrl before appending the query param', async () => {
      const storeMock = createStoreMock();
      setupWebAuthnConfig(storeMock);
      const auth = useAuthentication();
      const url = await auth.createInvite({ userId: 'user-1', baseUrl: 'https://app.com/' });
      expect(url).toMatch(/^https:\/\/app\.com\?requestId=/);
      expect(url).not.toContain('/?');
    });

    it('embeds a valid UUID as the requestId', async () => {
      const storeMock = createStoreMock();
      setupWebAuthnConfig(storeMock);
      const auth = useAuthentication();
      const url = await auth.createInvite({ userId: 'user-1', baseUrl: 'https://app.com' });
      const requestId = new URL(url).searchParams.get('requestId');
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
