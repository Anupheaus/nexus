import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthentication } from './useAuthentication';
import { useAuthData } from '../../async-context/socketApiContext';

// Mock the dependencies
vi.mock('../../async-context/socketApiContext', () => ({
  useAuthData: vi.fn(() => undefined),
  setAuthData: vi.fn(),
  wrap: vi.fn((target: any, fn: any) => fn),
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
});
