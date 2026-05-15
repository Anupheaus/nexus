import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestScopes } from './googleRequestScopes';

describe('requestScopes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns immediately when server says all scopes already granted', async () => {
    const callScopes = vi.fn(async () => ({ alreadyGranted: true }));
    const openOAuth = vi.fn();
    await requestScopes(['openid'], callScopes, openOAuth);
    expect(callScopes).toHaveBeenCalledWith({ scopes: ['openid'] });
    expect(openOAuth).not.toHaveBeenCalled();
  });

  it('calls openOAuth with missing scopes when not all granted', async () => {
    const callScopes = vi.fn(async () => ({
      alreadyGranted: false,
      missingScopes: ['https://www.googleapis.com/auth/calendar'],
    }));
    const openOAuth = vi.fn(async () => { /* noop */ });
    await requestScopes(
      ['openid', 'https://www.googleapis.com/auth/calendar'],
      callScopes,
      openOAuth,
    );
    expect(openOAuth).toHaveBeenCalledWith(['https://www.googleapis.com/auth/calendar']);
  });

  it('falls back to the full scope list when missingScopes is absent', async () => {
    const callScopes = vi.fn(async () => ({ alreadyGranted: false }));
    const openOAuth = vi.fn(async () => { /* noop */ });
    await requestScopes(['openid', 'email'], callScopes, openOAuth);
    expect(openOAuth).toHaveBeenCalledWith(['openid', 'email']);
  });

  it('passes the requested scopes to callScopes', async () => {
    const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/calendar'];
    const callScopes = vi.fn(async () => ({ alreadyGranted: true }));
    await requestScopes(scopes, callScopes, vi.fn());
    expect(callScopes).toHaveBeenCalledWith({ scopes });
  });
});
