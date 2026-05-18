import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SocketAPIServerAction } from '../actions/createServerActionHandler';

const {
  mockCreateSigninAction,
  mockCreateSignoutAction,
  mockCreateWebauthnInviteAction,
  mockCreateWebauthnRegisterAction,
  mockCreateWebauthnReauthAction,
  mockCreateBiometricSetupAction,
  mockCreateGoogleConfigAction,
  mockCreateGoogleStartAction,
  mockCreateGoogleCallbackAction,
  mockCreateGoogleOneTapAction,
  mockCreateGoogleScopesAction,
} = vi.hoisted(() => ({
  mockCreateSigninAction: vi.fn(),
  mockCreateSignoutAction: vi.fn(),
  mockCreateWebauthnInviteAction: vi.fn(),
  mockCreateWebauthnRegisterAction: vi.fn(),
  mockCreateWebauthnReauthAction: vi.fn(),
  mockCreateBiometricSetupAction: vi.fn(),
  mockCreateGoogleConfigAction: vi.fn(),
  mockCreateGoogleStartAction: vi.fn(),
  mockCreateGoogleCallbackAction: vi.fn(),
  mockCreateGoogleOneTapAction: vi.fn(),
  mockCreateGoogleScopesAction: vi.fn(),
}));

vi.mock('../actions/signinAction', () => ({ createSigninAction: mockCreateSigninAction }));
vi.mock('../actions/signoutAction', () => ({ createSignoutAction: mockCreateSignoutAction }));
vi.mock('../actions/webauthnInviteAction', () => ({ createWebauthnInviteAction: mockCreateWebauthnInviteAction }));
vi.mock('../actions/webauthnRegisterAction', () => ({ createWebauthnRegisterAction: mockCreateWebauthnRegisterAction }));
vi.mock('../actions/webauthnReauthAction', () => ({ createWebauthnReauthAction: mockCreateWebauthnReauthAction }));
vi.mock('../actions/biometricSetupAction', () => ({ createBiometricSetupAction: mockCreateBiometricSetupAction }));
vi.mock('../actions/googleConfigAction', () => ({ createGoogleConfigAction: mockCreateGoogleConfigAction }));
vi.mock('../actions/googleStartAction', () => ({ createGoogleStartAction: mockCreateGoogleStartAction }));
vi.mock('../actions/googleCallbackAction', () => ({ createGoogleCallbackAction: mockCreateGoogleCallbackAction }));
vi.mock('../actions/googleOneTapAction', () => ({ createGoogleOneTapAction: mockCreateGoogleOneTapAction }));
vi.mock('../actions/googleScopesAction', () => ({ createGoogleScopesAction: mockCreateGoogleScopesAction }));

import { registerAuthRoutes } from './registerAuthRoutes';
import type { JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';
import type { GoogleOAuthAuthConfig } from './googleOAuthAuthConfig';

function makeMockAction(): SocketAPIServerAction {
  return {
    registerSocket: vi.fn(),
    restEntry: { action: { name: 'mockAction' } as any, handler: vi.fn() as any, limitGate: { run: vi.fn() } as any },
  };
}

describe('registerAuthRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSigninAction.mockReturnValue(makeMockAction());
    mockCreateSignoutAction.mockReturnValue(makeMockAction());
    mockCreateWebauthnInviteAction.mockReturnValue(makeMockAction());
    mockCreateWebauthnRegisterAction.mockReturnValue(makeMockAction());
    mockCreateWebauthnReauthAction.mockReturnValue(makeMockAction());
    mockCreateBiometricSetupAction.mockReturnValue(makeMockAction());
    mockCreateGoogleConfigAction.mockReturnValue(makeMockAction());
    mockCreateGoogleStartAction.mockReturnValue(makeMockAction());
    mockCreateGoogleCallbackAction.mockReturnValue(makeMockAction());
    mockCreateGoogleOneTapAction.mockReturnValue(makeMockAction());
    mockCreateGoogleScopesAction.mockReturnValue(makeMockAction());
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

    it('registers signin and signout actions only, returns both in order', () => {
      const result = registerAuthRoutes(jwtConfig);

      expect(mockCreateSigninAction).toHaveBeenCalledOnce();
      expect(mockCreateSigninAction).toHaveBeenCalledWith(jwtStore, onAuthenticate);
      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(jwtStore);
      expect(mockCreateWebauthnInviteAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnRegisterAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnReauthAction).not.toHaveBeenCalled();

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(mockCreateSigninAction.mock.results[0].value);
      expect(result[1]).toBe(mockCreateSignoutAction.mock.results[0].value);
    });
  });

  describe('webauthn mode', () => {
    const webauthnStore = {} as any;
    const onGetUserDetails = vi.fn();
    const onGetUser = vi.fn();

    const webauthnConfig: WebAuthnAuthConfig = {
      mode: 'webauthn',
      store: webauthnStore,
      onGetInviteDetails: onGetUserDetails as WebAuthnAuthConfig['onGetInviteDetails'],
      onGetUser,
      syncUserToClient: true,
    };

    it('registers invite, register, reauth, biometric-setup, and signout actions, returns all five in order', () => {
      const result = registerAuthRoutes(webauthnConfig);

      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledWith(webauthnStore, onGetUserDetails);
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateBiometricSetupAction).toHaveBeenCalledOnce();
      expect(mockCreateBiometricSetupAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateSigninAction).not.toHaveBeenCalled();

      expect(result).toHaveLength(5);
      expect(result[0]).toBe(mockCreateWebauthnInviteAction.mock.results[0].value);
      expect(result[1]).toBe(mockCreateWebauthnRegisterAction.mock.results[0].value);
      expect(result[2]).toBe(mockCreateWebauthnReauthAction.mock.results[0].value);
      expect(result[3]).toBe(mockCreateBiometricSetupAction.mock.results[0].value);
      expect(result[4]).toBe(mockCreateSignoutAction.mock.results[0].value);
    });
  });

  describe('google-oauth mode', () => {
    const googleStore = {} as any;
    const onGetUser = vi.fn();
    const onCreateUser = vi.fn();

    const googleConfig: GoogleOAuthAuthConfig = {
      mode: 'google-oauth',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.com/callback',
      baseScopes: ['openid', 'email'],
      store: googleStore,
      onGetUser,
      onCreateUser,
      syncUserToClient: true,
    };

    it('registers config, start, callback, one-tap, scopes, and signout actions, returns all six in order', () => {
      const result = registerAuthRoutes(googleConfig);

      expect(mockCreateGoogleConfigAction).toHaveBeenCalledOnce();
      expect(mockCreateGoogleConfigAction).toHaveBeenCalledWith('client-id');
      expect(mockCreateGoogleStartAction).toHaveBeenCalledOnce();
      expect(mockCreateGoogleStartAction).toHaveBeenCalledWith(googleConfig);
      expect(mockCreateGoogleCallbackAction).toHaveBeenCalledOnce();
      expect(mockCreateGoogleCallbackAction).toHaveBeenCalledWith(googleConfig);
      expect(mockCreateGoogleOneTapAction).toHaveBeenCalledOnce();
      expect(mockCreateGoogleOneTapAction).toHaveBeenCalledWith(googleConfig);
      expect(mockCreateGoogleScopesAction).toHaveBeenCalledOnce();
      expect(mockCreateGoogleScopesAction).toHaveBeenCalledWith(googleConfig);
      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(googleStore);
      expect(mockCreateSigninAction).not.toHaveBeenCalled();
      expect(mockCreateWebauthnInviteAction).not.toHaveBeenCalled();

      expect(result).toHaveLength(6);
      expect(result[0]).toBe(mockCreateGoogleConfigAction.mock.results[0].value);
      expect(result[1]).toBe(mockCreateGoogleStartAction.mock.results[0].value);
      expect(result[2]).toBe(mockCreateGoogleCallbackAction.mock.results[0].value);
      expect(result[3]).toBe(mockCreateGoogleOneTapAction.mock.results[0].value);
      expect(result[4]).toBe(mockCreateGoogleScopesAction.mock.results[0].value);
      expect(result[5]).toBe(mockCreateSignoutAction.mock.results[0].value);
    });
  });
});
