import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import { refreshGoogleToken } from './googleTokenRefresh';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

function makeStore(record?: Partial<GoogleOAuthAuthRecord>): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => record as GoogleOAuthAuthRecord | undefined),
    findByDevice: vi.fn(async () => undefined),
    findByUserId: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

const freshRecord: GoogleOAuthAuthRecord = {
  requestId: 'r1',
  sessionToken: 'tok',
  userId: 'google-123',

  deviceId: 'd1',
  isEnabled: true,
  googleAccessToken: 'fresh-access',
  googleRefreshToken: 'refresh-tok',
  googleTokenExpiresAt: Date.now() + 3_600_000, // 1 hour from now
  grantedScopes: ['openid', 'email'],
};

const expiredRecord: GoogleOAuthAuthRecord = {
  ...freshRecord,
  googleAccessToken: 'expired-access',
  googleTokenExpiresAt: Date.now() - 1000, // already expired
};

describe('refreshGoogleToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns existing access token when not expired', async () => {
    const store = makeStore(freshRecord);
    const token = await refreshGoogleToken({ store, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, sessionToken: 'tok' });
    expect(token).toBe('fresh-access');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('calls Google token endpoint and updates store when token is expired', async () => {
    const store = makeStore(expiredRecord);
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'new-access', expires_in: 3600 } });

    const token = await refreshGoogleToken({ store, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, sessionToken: 'tok' });

    expect(token).toBe('new-access');
    expect(mockedPost).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.any(String),
      expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
    );
    expect(store.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      googleAccessToken: 'new-access',
      googleTokenExpiresAt: expect.any(Number),
    }));
  });

  it('refuses the session of a disabled or signed-out device, returning no Google token', async () => {
    const store = makeStore({ ...freshRecord, isEnabled: false });
    await expect(
      refreshGoogleToken({ store, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, sessionToken: 'tok' }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws when no session record found, without echoing the session token (the message is logged)', async () => {
    const store = makeStore(undefined);
    await expect(
      refreshGoogleToken({ store, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, sessionToken: 'secret-session-token' })
    ).rejects.toSatisfy((err: unknown) => err instanceof AuthenticationError
      && err.message === 'No Google OAuth session found for this session' && !err.message.includes('secret-session-token'));
  });

  it.each([{ $ne: null }, { $gt: '' }, ['tok'], 1, ''])('looks nothing up for a session token that is not a string: %j (sc-620)', async token => {
    const store = makeStore(undefined);
    await expect(
      refreshGoogleToken({ store, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, sessionToken: token as unknown as string })
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(store.findBySessionToken).not.toHaveBeenCalled();
  });

  it('propagates axios error when Google token endpoint fails', async () => {
    const store = makeStore(expiredRecord);
    mockedPost.mockRejectedValueOnce(new Error('network error'));
    await expect(refreshGoogleToken({ store, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, sessionToken: 'tok' })).rejects.toThrow('network error');
  });
});
