import { describe, it, expect, vi, beforeEach } from 'vitest';
import Router from 'koa-router';

const {
  mockCreateSigninRoute,
  mockCreateSignoutRoute,
  mockCreateWebauthnInviteRoute,
  mockCreateWebauthnRegisterRoute,
  mockCreateWebauthnReauthRoute,
} = vi.hoisted(() => ({
  mockCreateSigninRoute: vi.fn(),
  mockCreateSignoutRoute: vi.fn(),
  mockCreateWebauthnInviteRoute: vi.fn(),
  mockCreateWebauthnRegisterRoute: vi.fn(),
  mockCreateWebauthnReauthRoute: vi.fn(),
}));

vi.mock('./routes/signinRoute', () => ({ createSigninRoute: mockCreateSigninRoute }));
vi.mock('./routes/signoutRoute', () => ({ createSignoutRoute: mockCreateSignoutRoute }));
vi.mock('./routes/webauthnInviteRoute', () => ({ createWebauthnInviteRoute: mockCreateWebauthnInviteRoute }));
vi.mock('./routes/webauthnRegisterRoute', () => ({ createWebauthnRegisterRoute: mockCreateWebauthnRegisterRoute }));
vi.mock('./routes/webauthnReauthRoute', () => ({ createWebauthnReauthRoute: mockCreateWebauthnReauthRoute }));

import { registerAuthRoutes } from './registerAuthRoutes';
import type { JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';

describe('registerAuthRoutes', () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
  });

  describe('jwt mode', () => {
    const jwtStore = {} as any;
    const onAuthenticate = vi.fn();
    const onGetUser = vi.fn();

    const jwtConfig: JwtAuthConfig = {
      mode: 'jwt',
      store: jwtStore,
      onAuthenticate,
      onGetUser,
      syncUserToClient: true,
    };

    it('registers signin and signout routes, with no WebAuthn routes', () => {
      registerAuthRoutes(router, 'api', jwtConfig);

      expect(mockCreateSigninRoute).toHaveBeenCalledOnce();
      expect(mockCreateSigninRoute).toHaveBeenCalledWith(router, 'api', jwtStore, onAuthenticate);

      expect(mockCreateSignoutRoute).toHaveBeenCalledOnce();
      expect(mockCreateSignoutRoute).toHaveBeenCalledWith(router, 'api', jwtStore);

      expect(mockCreateWebauthnInviteRoute).not.toHaveBeenCalled();
      expect(mockCreateWebauthnRegisterRoute).not.toHaveBeenCalled();
      expect(mockCreateWebauthnReauthRoute).not.toHaveBeenCalled();
    });
  });

  describe('webauthn mode', () => {
    const webauthnStore = {} as any;
    const onGetUserDetails = vi.fn();
    const onGetUser = vi.fn();

    const webauthnConfig: WebAuthnAuthConfig = {
      mode: 'webauthn',
      store: webauthnStore,
      onGetUserDetails,
      onGetUser,
      syncUserToClient: true,
    };

    it('registers invite, register, reauth, and signout routes, with no signin route', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);

      expect(mockCreateWebauthnInviteRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteRoute).toHaveBeenCalledWith(router, 'api', webauthnStore, onGetUserDetails);

      expect(mockCreateWebauthnRegisterRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);

      expect(mockCreateWebauthnReauthRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);

      expect(mockCreateSignoutRoute).toHaveBeenCalledOnce();
      expect(mockCreateSignoutRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);

      expect(mockCreateSigninRoute).not.toHaveBeenCalled();
    });
  });
});
