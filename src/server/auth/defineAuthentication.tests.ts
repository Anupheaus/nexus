import { describe, it, expect, vi } from 'vitest';
import { defineAuthentication } from './defineAuthentication';
import type { JwtAuthStore, WebAuthnAuthStore, GoogleOAuthAuthStore } from '../../common/auth';

interface TestUser { id: string; name: string; }
interface TestCreds { id: string; email: string; password: string; }

const store: JwtAuthStore = {
  create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
  findByDevice: vi.fn(), update: vi.fn(),
};

describe('defineAuthentication (server)', () => {
  it('returns configureAuthentication and useAuthentication functions', () => {
    const auth = defineAuthentication<TestUser, TestCreds>();
    expect(typeof auth.configureAuthentication).toBe('function');
    expect(typeof auth.useAuthentication).toBe('function');
  });

  it('configureAuthentication returns config with mode jwt and syncUserToClient defaulting to true', () => {
    const { configureAuthentication } = defineAuthentication<TestUser, TestCreds>();
    const config = configureAuthentication({
      mode: 'jwt',
      store,
      onAuthenticate: async () => undefined,
      onGetUser: async () => undefined,
    });
    expect(config.mode).toBe('jwt');
    expect((config as any).syncUserToClient).toBe(true);
  });

  it('configureAuthentication accepts webauthn mode', () => {
    const webauthnStore: WebAuthnAuthStore = {
      create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
      findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
      findByKeyHash: vi.fn(), update: vi.fn(),
    };
    const { configureAuthentication } = defineAuthentication<TestUser>();
    const config = configureAuthentication({
      mode: 'webauthn',
      store: webauthnStore,
      onGetInviteDetails: async () => ({ domain: 'app.com', appName: 'App', userName: 'Alice', userHandle: 'u1' }),
      onGetUser: async () => undefined,
    });
    expect(config.mode).toBe('webauthn');
    expect((config as any).syncUserToClient).toBe(true);
  });

  it('webauthn configureAuthentication respects syncUserToClient: false', () => {
    const webauthnStore: WebAuthnAuthStore = {
      create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
      findByDevice: vi.fn(), findByRegistrationToken: vi.fn(),
      findByKeyHash: vi.fn(), update: vi.fn(),
    };
    const { configureAuthentication } = defineAuthentication<TestUser>();
    const config = configureAuthentication({
      mode: 'webauthn',
      store: webauthnStore,
      onGetInviteDetails: async () => ({ domain: 'app.com', appName: 'App', userName: 'Alice', userHandle: 'u1' }),
      onGetUser: async () => undefined,
      syncUserToClient: false,
    });
    expect((config as any).syncUserToClient).toBe(false);
  });

  describe('google-oauth mode', () => {
    const googleStore: GoogleOAuthAuthStore = {
      create: vi.fn(), findById: vi.fn(), findBySessionToken: vi.fn(),
      findByDevice: vi.fn(), findByUserId: vi.fn(), update: vi.fn(),
    };
    const onGetUser = vi.fn(async () => undefined as TestUser | undefined);
    const onCreateUser = vi.fn(async () => ({ id: 'u1', name: 'Alice' } as TestUser));

    it('configureAuthentication returns config with mode google-oauth', () => {
      const { configureAuthentication } = defineAuthentication<TestUser>();
      const config = configureAuthentication({
        mode: 'google-oauth',
        clientId: 'cid',
        clientSecret: 'csecret',
        redirectUri: 'https://app.com/cb',
        baseScopes: ['openid', 'email'],
        store: googleStore,
        onGetUser,
        onCreateUser,
      });
      expect(config.mode).toBe('google-oauth');
      expect((config as any).clientId).toBe('cid');
      expect((config as any).clientSecret).toBe('csecret');
      expect((config as any).redirectUri).toBe('https://app.com/cb');
      expect((config as any).baseScopes).toEqual(['openid', 'email']);
    });

    it('syncUserToClient defaults to true when not specified', () => {
      const { configureAuthentication } = defineAuthentication<TestUser>();
      const config = configureAuthentication({
        mode: 'google-oauth',
        clientId: 'cid',
        clientSecret: 'csecret',
        redirectUri: 'https://app.com/cb',
        baseScopes: ['openid'],
        store: googleStore,
        onGetUser,
        onCreateUser,
      });
      expect((config as any).syncUserToClient).toBe(true);
    });

    it('syncUserToClient is false when explicitly set', () => {
      const { configureAuthentication } = defineAuthentication<TestUser>();
      const config = configureAuthentication({
        mode: 'google-oauth',
        clientId: 'cid',
        clientSecret: 'csecret',
        redirectUri: 'https://app.com/cb',
        baseScopes: ['openid'],
        store: googleStore,
        onGetUser,
        onCreateUser,
        syncUserToClient: false,
      });
      expect((config as any).syncUserToClient).toBe(false);
    });

    it('passes capacitorCallbackUrl through when provided', () => {
      const { configureAuthentication } = defineAuthentication<TestUser>();
      const config = configureAuthentication({
        mode: 'google-oauth',
        clientId: 'cid',
        clientSecret: 'csecret',
        redirectUri: 'https://app.com/cb',
        baseScopes: ['openid'],
        store: googleStore,
        onGetUser,
        onCreateUser,
        capacitorCallbackUrl: 'myapp://callback',
      });
      expect((config as any).capacitorCallbackUrl).toBe('myapp://callback');
    });

    it('capacitorCallbackUrl is undefined when not provided', () => {
      const { configureAuthentication } = defineAuthentication<TestUser>();
      const config = configureAuthentication({
        mode: 'google-oauth',
        clientId: 'cid',
        clientSecret: 'csecret',
        redirectUri: 'https://app.com/cb',
        baseScopes: ['openid'],
        store: googleStore,
        onGetUser,
        onCreateUser,
      });
      expect((config as any).capacitorCallbackUrl).toBeUndefined();
    });
  });
});
