import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthentication } from './useAuthentication';
import { useAuthData } from '../../async-context/socketApiContext';
import { getAuthConfig } from '../../auth/authConfig';

// Mock the dependencies
vi.mock('../../async-context/socketApiContext', () => ({
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

  it('returns user, setUser, signOut, impersonateUser', () => {
    const auth = useAuthentication();
    expect('user' in auth).toBe(true);
    expect(typeof auth.setUser).toBe('function');
    expect(typeof auth.signOut).toBe('function');
    expect(typeof auth.impersonateUser).toBe('function');
  });

  it('user is undefined when no auth data', () => {
    const auth = useAuthentication();
    expect(auth.user).toBeUndefined();
  });

  it('user returns the stored user when auth data exists', () => {
    vi.mocked(useAuthData).mockReturnValue({ user: { id: 'u1' } });
    const auth = useAuthentication();
    expect(auth.user).toEqual({ id: 'u1' });
  });

  describe('createInvite', () => {
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
      const storeMock = {
        create: vi.fn(),
        findById: vi.fn(),
        findBySessionToken: vi.fn(),
        findByDevice: vi.fn(),
        findByRegistrationToken: vi.fn(),
        findByKeyHash: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(getAuthConfig).mockReturnValue({
        mode: 'webauthn',
        store: storeMock,
        onGetUserDetails: vi.fn(),
        onGetUser: vi.fn(),
        syncUserToClient: true,
      });
      const auth = useAuthentication();
      const url = await auth.createInvite('user-99', 'https://myapp.com');
      expect(storeMock.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-99',
        isEnabled: false,
        sessionToken: '',
        deviceId: '',
      }));
      expect(url).toMatch(/^https:\/\/myapp\.com\?requestId=.+/);
    });

    it('trims a trailing slash from baseUrl before appending the query param', async () => {
      const storeMock = {
        create: vi.fn(),
        findById: vi.fn(),
        findBySessionToken: vi.fn(),
        findByDevice: vi.fn(),
        findByRegistrationToken: vi.fn(),
        findByKeyHash: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(getAuthConfig).mockReturnValue({
        mode: 'webauthn',
        store: storeMock,
        onGetUserDetails: vi.fn(),
        onGetUser: vi.fn(),
        syncUserToClient: true,
      });
      const auth = useAuthentication();
      const url = await auth.createInvite('user-1', 'https://app.com/');
      expect(url).toMatch(/^https:\/\/app\.com\?requestId=/);
      expect(url).not.toContain('/?');
    });

    it('embeds a valid UUID as the requestId', async () => {
      const storeMock = {
        create: vi.fn(),
        findById: vi.fn(),
        findBySessionToken: vi.fn(),
        findByDevice: vi.fn(),
        findByRegistrationToken: vi.fn(),
        findByKeyHash: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(getAuthConfig).mockReturnValue({
        mode: 'webauthn',
        store: storeMock,
        onGetUserDetails: vi.fn(),
        onGetUser: vi.fn(),
        syncUserToClient: true,
      });
      const auth = useAuthentication();
      const url = await auth.createInvite('user-1', 'https://app.com');
      const requestId = new URL(url).searchParams.get('requestId');
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
