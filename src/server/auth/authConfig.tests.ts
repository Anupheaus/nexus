import { describe, it, expect, beforeEach } from 'vitest';
import { setAuthConfig, getAuthConfig, clearAuthConfig } from './authConfig';

describe('authConfig', () => {
  beforeEach(() => clearAuthConfig());

  it('returns undefined before config is set', () => {
    expect(getAuthConfig()).toBeUndefined();
  });

  it('returns the config after it is set', () => {
    const store = {} as any;
    const onGetUser = async () => undefined;
    setAuthConfig({ mode: 'jwt', store, onAuthenticate: async () => undefined, onGetUser, syncUserToClient: true });
    const config = getAuthConfig();
    expect(config?.mode).toBe('jwt');
    expect(config?.syncUserToClient).toBe(true);
  });
});
