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

  const webauthnStore = {} as any;
  const onGetUserDetails = vi.fn();

  const webauthnConfig: WebAuthnAuthConfig = {
    mode: 'webauthn',
    store: webauthnStore,
    onGetUserDetails,
    onGetUser,
    syncUserToClient: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
  });

  describe('jwt mode', () => {
    it('registers the signin route with the correct arguments', () => {
      registerAuthRoutes(router, 'api', jwtConfig);
      expect(mockCreateSigninRoute).toHaveBeenCalledOnce();
      expect(mockCreateSigninRoute).toHaveBeenCalledWith(router, 'api', jwtStore, onAuthenticate);
    });

    it('registers the signout route', () => {
      registerAuthRoutes(router, 'api', jwtConfig);
      expect(mockCreateSignoutRoute).toHaveBeenCalledOnce();
      expect(mockCreateSignoutRoute).toHaveBeenCalledWith(router, 'api', jwtStore);
    });

    it('does not register any WebAuthn routes', () => {
      registerAuthRoutes(router, 'api', jwtConfig);
      expect(mockCreateWebauthnInviteRoute).not.toHaveBeenCalled();
      expect(mockCreateWebauthnRegisterRoute).not.toHaveBeenCalled();
      expect(mockCreateWebauthnReauthRoute).not.toHaveBeenCalled();
    });
  });

  describe('webauthn mode', () => {
    it('registers the invite route with store and onGetUserDetails', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateWebauthnInviteRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteRoute).toHaveBeenCalledWith(router, 'api', webauthnStore, onGetUserDetails);
    });

    it('registers the register route with store', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateWebauthnRegisterRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);
    });

    it('registers the reauth route with store', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateWebauthnReauthRoute).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);
    });

    it('registers the signout route', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateSignoutRoute).toHaveBeenCalledOnce();
      expect(mockCreateSignoutRoute).toHaveBeenCalledWith(router, 'api', webauthnStore);
    });

    it('does not register the signin route', () => {
      registerAuthRoutes(router, 'api', webauthnConfig);
      expect(mockCreateSigninRoute).not.toHaveBeenCalled();
    });
  });
});
