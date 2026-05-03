import { describe, it, expect, vi } from 'vitest';
import { defineAuthentication } from './defineAuthentication';
import type { JwtAuthStore, WebAuthnAuthStore } from '../../common/auth';

interface TestUser { id: string; name: string; }
interface TestCreds { email: string; password: string; }

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
});
