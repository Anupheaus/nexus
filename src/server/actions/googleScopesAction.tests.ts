import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AuthenticationError } from '@anupheaus/common';
import type { GoogleOAuthAuthStore, GoogleOAuthAuthRecord } from '../../common/auth';
import { handleGoogleScopes } from './googleScopesAction';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);

function makeStore(record?: GoogleOAuthAuthRecord): GoogleOAuthAuthStore {
  return {
    create: vi.fn(),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => record),
    findByDevice: vi.fn(async () => undefined),
    findByUserId: vi.fn(async () => undefined),
    update: vi.fn(),
  };
}

const baseRecord: GoogleOAuthAuthRecord = {
  requestId: 'r1',
  sessionToken: 'tok',
  userId: 'g-uid',

  deviceId: 'd1',
  isEnabled: true,
  googleAccessToken: 'at',
  googleRefreshToken: 'rt',
  googleTokenExpiresAt: Date.now() + 3_600_000,
  grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
};

describe('handleGoogleScopes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns alreadyGranted true and does not call refresh when all scopes present and token is fresh', async () => {
    const store = makeStore(baseRecord);
    const result = await handleGoogleScopes({
      store, clientId: 'cid', clientSecret: 'sec', sessionToken: 'tok',
      requestedScopes: ['openid', 'email'],
    });
    expect(result.alreadyGranted).toBe(true);
    expect(result.missingScopes).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('calls refreshGoogleToken when all scopes granted but token is expired', async () => {
    const expiredRecord = { ...baseRecord, googleTokenExpiresAt: Date.now() - 1000 };
    const store = makeStore(expiredRecord);
    mockedPost.mockResolvedValueOnce({ data: { access_token: 'new-at', expires_in: 3600 } });
    const result = await handleGoogleScopes({
      store, clientId: 'cid', clientSecret: 'sec', sessionToken: 'tok',
      requestedScopes: ['openid'],
    });
    expect(result.alreadyGranted).toBe(true);
    expect(mockedPost).toHaveBeenCalled();
  });

  it('returns alreadyGranted false with missingScopes when a scope is not granted', async () => {
    const store = makeStore(baseRecord);
    const result = await handleGoogleScopes({
      store, clientId: 'cid', clientSecret: 'sec', sessionToken: 'tok',
      requestedScopes: ['openid', 'https://www.googleapis.com/auth/drive'],
    });
    expect(result.alreadyGranted).toBe(false);
    expect(result.missingScopes).toEqual(['https://www.googleapis.com/auth/drive']);
  });

  it('throws AuthenticationError when session token not found', async () => {
    const store = makeStore(undefined);
    await expect(
      handleGoogleScopes({ store, clientId: 'cid', clientSecret: 'sec', sessionToken: 'tok', requestedScopes: ['openid'] }),
    ).rejects.toSatisfy((err: unknown) => err instanceof AuthenticationError);
  });
});
