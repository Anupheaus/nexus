import { describe, it, expect, vi } from 'vitest';
import { defineAuthentication } from './defineAuthentication';
import type { JwtAuthStore } from '../../common/auth';

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
});
