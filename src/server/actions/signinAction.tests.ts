import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JwtAuthStore } from '../../common/auth';
import type { NexusUser } from '../../common';
import type { SignInRequest } from '../../common/internalActions';
import { handleSignIn } from './signinAction';

const testUser: NexusUser = { id: 'user-1' };

const deviceDetails: SignInRequest['deviceDetails'] = {
  userAgent: 'ua', platform: 'p', language: 'en', hardwareConcurrency: 4,
  maxTouchPoints: 0, vendor: 'v', screenWidth: 1920, screenHeight: 1080,
  viewportWidth: 1200, viewportHeight: 800, colorDepth: 24, pixelRatio: 1, timezone: 'UTC',
};

function makeStore(): JwtAuthStore {
  return {
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => undefined),
    findBySessionToken: vi.fn(async () => undefined),
    findByDevice: vi.fn(async () => undefined),
    update: vi.fn(async () => {}),
  };
}

describe('handleSignIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when onAuthenticate returns undefined', async () => {
    const setCookie = vi.fn();
    await expect(
      handleSignIn(makeStore(), async () => undefined, { credentials: { email: 'bad@test.com', password: 'wrong' }, deviceDetails }, setCookie),
    ).rejects.toThrow('Authentication failed');
  });

  it('calls setCookie with HttpOnly session cookie when credentials are valid', async () => {
    const store = makeStore();
    const setCookie = vi.fn();
    await handleSignIn(store, async () => testUser, { credentials: { email: 'good@test.com', password: 'correct' }, deviceDetails }, setCookie);
    expect(setCookie).toHaveBeenCalledWith(
      'nexus_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'Strict' }),
    );
  });

  it('always creates a new session record', async () => {
    const store = makeStore();
    const setCookie = vi.fn();
    await handleSignIn(store, async () => testUser, { credentials: { email: 'good@test.com', password: 'correct' }, deviceDetails }, setCookie);
    expect(store.create).toHaveBeenCalledOnce();
    expect(store.update).not.toHaveBeenCalled();
  });

  it('propagates error when onAuthenticate throws', async () => {
    const store = makeStore();
    const setCookie = vi.fn();
    await expect(
      handleSignIn(store, async () => { throw new Error('auth-service-down'); }, { credentials: { email: 'any@test.com', password: 'any' }, deviceDetails }, setCookie),
    ).rejects.toThrow('auth-service-down');
  });

  it('propagates error when store.create throws', async () => {
    const store = makeStore();
    vi.mocked(store.create).mockRejectedValueOnce(new Error('db-write-failed'));
    const setCookie = vi.fn();
    await expect(
      handleSignIn(store, async () => testUser, { credentials: { email: 'good@test.com', password: 'correct' }, deviceDetails }, setCookie),
    ).rejects.toThrow('db-write-failed');
  });

  const xssPayloads = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "' OR '1'='1",
    '; DROP TABLE sessions; --',
  ];

  it.each(xssPayloads)(
    'passes credentials containing payload %s to onAuthenticate without modification',
    async (payload) => {
      const onAuthenticate = vi.fn(async () => undefined);
      const setCookie = vi.fn();
      await expect(
        handleSignIn(makeStore(), onAuthenticate, { credentials: { email: payload, password: payload }, deviceDetails }, setCookie),
      ).rejects.toThrow('Authentication failed');
      expect(onAuthenticate).toHaveBeenCalledWith(expect.objectContaining({ email: payload, password: payload }));
    },
  );
});
