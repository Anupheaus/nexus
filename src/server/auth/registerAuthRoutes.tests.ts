import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCreateSigninAction,
  mockCreateSignoutAction,
  mockCreateWebauthnInviteAction,
  mockCreateWebauthnRegisterAction,
  mockCreateWebauthnReauthAction,
} = vi.hoisted(() => ({
  mockCreateSigninAction: vi.fn(),
  mockCreateSignoutAction: vi.fn(),
  mockCreateWebauthnInviteAction: vi.fn(),
  mockCreateWebauthnRegisterAction: vi.fn(),
  mockCreateWebauthnReauthAction: vi.fn(),
}));

vi.mock('../actions/signinAction', () => ({ createSigninAction: mockCreateSigninAction }));
vi.mock('../actions/signoutAction', () => ({ createSignoutAction: mockCreateSignoutAction }));
vi.mock('./routes/webauthnInviteRoute', () => ({ createWebauthnInviteAction: mockCreateWebauthnInviteAction }));
vi.mock('./routes/webauthnRegisterRoute', () => ({ createWebauthnRegisterAction: mockCreateWebauthnRegisterAction }));
vi.mock('./routes/webauthnReauthRoute', () => ({ createWebauthnReauthAction: mockCreateWebauthnReauthAction }));

import { registerAuthRoutes } from './registerAuthRoutes';
import type { JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';

describe('registerAuthRoutes', () => {
  beforeEach(() => vi.clearAllMocks());

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

    it('registers signin and signout actions, with no WebAuthn actions', () => {
      registerAuthRoutes(jwtConfig);

      expect(mockCreateSigninAction).toHaveBeenCalledOnce();
      expect(mockCreateSigninAction).toHaveBeenCalledWith(jwtStore, onAuthenticate);

      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(jwtStore);

      expect(mockCreateWebauthnInviteAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnRegisterAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnReauthAction).not.toHaveBeenCalled();
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

    it('registers invite, register, reauth, and signout actions, with no signin action', () => {
      registerAuthRoutes(webauthnConfig);

      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledWith(webauthnStore, onGetUserDetails);

      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledWith(webauthnStore);

      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledWith(webauthnStore);

      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(webauthnStore);

      expect(mockCreateSigninAction).not.toHaveBeenCalled();
    });
  });
});
