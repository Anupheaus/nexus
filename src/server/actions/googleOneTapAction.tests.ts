import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { SocketAPIUser } from '../../common';
import { handleGoogleOneTap, COOKIE_NAME } from './googleOneTapAction';
import type { CookieOptions } from '../handler/handlerUtils';

vi.mock('axios');
const mockedGet = vi.mocked(axios.get);

const mockUser: SocketAPIUser = { id: 'google-uid-abc', name: 'Alice' };

function makeStore(record?: GoogleOAuthAuthRecord): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    findByUserId: vi.fn(async () => record),
    update: vi.fn(),
  };
}

const baseConfig: GoogleOAuthAuthConfig = {
  mode: 'google-oauth',
  clientId: 'client-id',
  clientSecret: 'secret',
  redirectUri: 'https://myapp.com/callback',
  baseScopes: ['openid'],
  store: {} as unknown as GoogleOAuthAuthStore,
  onGetUser: vi.fn(async () => mockUser),
  onCreateUser: vi.fn(async () => mockUser),
  syncUserToClient: true,
};

const validTokenInfo = { sub: 'google-uid-abc', email: 'alice@example.com', name: 'Alice', aud: 'client-id' };

function makeCookieSpy() {
  const cookies: Record<string, string> = {};
  return {
    setCookie: vi.fn((name: string, value: string, _opts?: CookieOptions) => { cookies[name] = value; }),
    cookies,
  };
}

describe('handleGoogleOneTap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws AuthenticationError when tokeninfo aud does not match clientId', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ...validTokenInfo, aud: 'wrong-client' } });
    const { setCookie } = makeCookieSpy();
    await expect(
      handleGoogleOneTap({ config: baseConfig, req: { credential: 'id-tok' }, setCookie }),
    ).rejects.toSatisfy((err: unknown) => err instanceof AuthenticationError);
  });

  it('sets session cookie on success with existing user', async () => {
    const existingRecord: GoogleOAuthAuthRecord = {
      requestId: 'r1', sessionToken: 'old', userId: 'google-uid-abc', 
      deviceId: 'd1', isEnabled: true, googleAccessToken: 'at', googleRefreshToken: 'rt',
      googleTokenExpiresAt: Date.now() + 3600_000, grantedScopes: ['openid'],
    };
    const store = makeStore(existingRecord);
    const config = { ...baseConfig, store };
    mockedGet.mockResolvedValueOnce({ data: validTokenInfo });

    const { setCookie, cookies } = makeCookieSpy();
    await handleGoogleOneTap({ config, req: { credential: 'id-tok' }, setCookie });

    expect(setCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(typeof cookies[COOKIE_NAME]).toBe('string');
    expect(cookies[COOKIE_NAME].length).toBeGreaterThan(0);
  });

  it('calls onCreateUser and store.create for a new user', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedGet.mockResolvedValueOnce({ data: validTokenInfo });

    const { setCookie } = makeCookieSpy();
    await handleGoogleOneTap({ config, req: { credential: 'id-tok' }, setCookie });

    expect(config.onCreateUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'google-uid-abc' }));
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      
      userId: 'google-uid-abc',
      isEnabled: true,
    }));
    expect(setCookie).toHaveBeenCalled();
  });

  it('updates existing record sessionToken and lastConnectedAt on re-authentication', async () => {
    const existingRecord: GoogleOAuthAuthRecord = {
      requestId: 'r1', sessionToken: 'old', userId: 'google-uid-abc', 
      deviceId: 'd1', isEnabled: true, googleAccessToken: 'at', googleRefreshToken: 'rt',
      googleTokenExpiresAt: Date.now() + 3600_000, grantedScopes: ['openid'],
    };
    const store = makeStore(existingRecord);
    const config = { ...baseConfig, store };
    mockedGet.mockResolvedValueOnce({ data: validTokenInfo });

    const { setCookie } = makeCookieSpy();
    await handleGoogleOneTap({ config, req: { credential: 'id-tok' }, setCookie });

    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      isEnabled: true,
      lastConnectedAt: expect.any(Number),
    }));
  });
});
