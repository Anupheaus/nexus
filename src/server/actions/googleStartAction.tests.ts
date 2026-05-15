import { describe, it, expect, vi } from 'vitest';
import { handleGoogleStart } from './googleStartAction';
import type { GoogleOAuthAuthConfig } from '../auth/googleOAuthAuthConfig';
import type { GoogleStartRequest } from '../../common/internalActions';
import { decodeState } from '../auth/googleOAuthState';

const config: GoogleOAuthAuthConfig = {
  mode: 'google-oauth',
  clientId: 'test-client-id',
  clientSecret: 'test-secret',
  redirectUri: 'https://myapp.com/api/socketAPI/google/callback',
  baseScopes: ['openid', 'email', 'profile'],
  store: {} as never,
  onGetUser: vi.fn(),
  onCreateUser: vi.fn(),
  syncUserToClient: true,
};

describe('handleGoogleStart', () => {
  it('returns Google authorization endpoint URL', async () => {
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'web', popup: false };
    const result = await handleGoogleStart(config, req);
    expect(result.authUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
  });

  it('includes base scopes in returned URL', async () => {
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'web', popup: false };
    const result = await handleGoogleStart(config, req);
    expect(result.authUrl).toContain('openid');
    expect(result.authUrl).toContain('email');
    expect(result.authUrl).toContain('profile');
  });

  it('appends extra scopes and include_granted_scopes when scopes param provided', async () => {
    const req: GoogleStartRequest = {
      postAuthUrl: '/dashboard',
      platform: 'web',
      popup: false,
      scopes: 'https://www.googleapis.com/auth/calendar',
    };
    const result = await handleGoogleStart(config, req);
    expect(result.authUrl).toContain('calendar');
    expect(result.authUrl).toContain('include_granted_scopes=true');
  });

  it('includes signed state param verifiable by decodeState', async () => {
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'web', popup: true };
    const result = await handleGoogleStart(config, req);
    const url = new URL(result.authUrl);
    const state = url.searchParams.get('state') ?? '';
    const decoded = decodeState(state, config.clientSecret);
    expect(decoded.postAuthUrl).toBe('/dashboard');
    expect(decoded.popup).toBe(true);
    expect(decoded.platform).toBe('web');
    expect(decoded.nonce).toBeTruthy();
  });

  it('sets platform to capacitor in state when platform param is capacitor', async () => {
    const req: GoogleStartRequest = { postAuthUrl: '/dashboard', platform: 'capacitor', popup: false };
    const result = await handleGoogleStart(config, req);
    const url = new URL(result.authUrl);
    const decoded = decodeState(url.searchParams.get('state') ?? '', config.clientSecret);
    expect(decoded.platform).toBe('capacitor');
  });
});
