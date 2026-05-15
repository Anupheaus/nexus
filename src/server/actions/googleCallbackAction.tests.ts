import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { SocketAPIUser } from '../../common';
import { handleGoogleCallback, COOKIE_NAME } from './googleCallbackAction';
import { encodeState } from '../auth/googleOAuthState';
import type { CookieOptions } from '../handler/handlerUtils';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);
const mockedGet = vi.mocked(axios.get);

const SECRET = 'test-secret';
const REDIRECT_URI = 'https://myapp.com/api/socketAPI/google/callback';
const CAPACITOR_URL = 'com.myapp://google-oauth-callback';

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

const mockUser: SocketAPIUser = { id: 'google-uid-123', name: 'Alice' };

const baseConfig: GoogleOAuthAuthConfig = {
  mode: 'google-oauth',
  clientId: 'client-id',
  clientSecret: SECRET,
  redirectUri: REDIRECT_URI,
  baseScopes: ['openid', 'email'],
  store: {} as unknown as GoogleOAuthAuthStore,
  onGetUser: vi.fn(async () => mockUser),
  onCreateUser: vi.fn(async () => mockUser),
  capacitorCallbackUrl: CAPACITOR_URL,
  syncUserToClient: true,
};

function makeState(overrides: { popup?: boolean; platform?: 'web' | 'capacitor'; postAuthUrl?: string } = {}) {
  return encodeState(
    {
      nonce: 'nonce-abc',
      postAuthUrl: overrides.postAuthUrl ?? '/dashboard',
      platform: overrides.platform ?? 'web',
      popup: overrides.popup ?? false,
    },
    SECRET,
  );
}

function makeUtils() {
  const cookies: Record<string, string> = {};
  const redirects: string[] = [];
  const headers: Record<string, string> = {};
  return {
    setCookie: vi.fn((name: string, value: string, _opts?: CookieOptions) => { cookies[name] = value; }),
    redirect: vi.fn((url: string) => { redirects.push(url); return { type: Symbol(), url } as never; }),
    setHeaders: vi.fn((h: Record<string, string>) => Object.assign(headers, h)),
    cookies,
    redirects,
    headers,
  };
}

describe('handleGoogleCallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when error param is present', async () => {
    const utils = makeUtils();
    await expect(
      handleGoogleCallback({ config: baseConfig, req: { code: undefined, state: makeState(), error: 'access_denied' }, utils }),
    ).rejects.toThrow('access_denied');
  });

  it('throws when state signature is invalid', async () => {
    const utils = makeUtils();
    await expect(
      handleGoogleCallback({ config: baseConfig, req: { code: 'code123', state: 'invalid.state' }, utils }),
    ).rejects.toThrow('Invalid OAuth state parameter');
  });

  it('sets session cookie after successful code exchange for existing user', async () => {
    const existingRecord: GoogleOAuthAuthRecord = {
      requestId: 'r1', sessionToken: 'old', userId: 'google-uid-123',
      deviceId: 'd1', isEnabled: true, googleAccessToken: 'old-at', googleRefreshToken: 'rt',
      googleTokenExpiresAt: Date.now() + 3600_000, grantedScopes: ['openid'],
    };
    const store = makeStore(existingRecord);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600, scope: 'openid email' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'google-uid-123', email: 'alice@example.com', name: 'Alice' } });

    const utils = makeUtils();
    await handleGoogleCallback({ config, req: { code: 'code123', state: makeState() }, utils });

    expect(utils.setCookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('calls onCreateUser and store.create when no existing record', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'new-uid', email: 'bob@example.com', name: 'Bob' } });

    const utils = makeUtils();
    await handleGoogleCallback({ config, req: { code: 'code123', state: makeState() }, utils });

    expect(config.onCreateUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-uid', email: 'bob@example.com' }));
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'new-uid',
      isEnabled: true,
    }));
  });

  it('redirects to postAuthUrl in web redirect mode', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'uid', email: 'x@x.com', name: 'X' } });

    const utils = makeUtils();
    await handleGoogleCallback({ config, req: { code: 'code123', state: makeState({ popup: false, postAuthUrl: '/home' }) }, utils });

    expect(utils.redirects[0]).toBe('/home');
  });

  it('returns popup HTML when popup flag is set in state', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'uid', email: 'x@x.com', name: 'X' } });

    const utils = makeUtils();
    const result = await handleGoogleCallback({ config, req: { code: 'code123', state: makeState({ popup: true }) }, utils });

    expect(utils.setHeaders).toHaveBeenCalledWith({ 'Content-Type': 'text/html' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('google-oauth-complete');
  });

  it('redirects to capacitorCallbackUrl when platform is capacitor', async () => {
    const store = makeStore(undefined);
    const config = { ...baseConfig, store };
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' } });
    mockedGet.mockResolvedValueOnce({ data: { sub: 'uid', email: 'x@x.com', name: 'X' } });

    const utils = makeUtils();
    await handleGoogleCallback({ config, req: { code: 'code123', state: makeState({ platform: 'capacitor' }) }, utils });

    expect(utils.redirects[0]).toBe(CAPACITOR_URL);
  });
});
