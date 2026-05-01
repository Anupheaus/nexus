import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SocketAPIServerAction } from '../actions/createServerActionHandler';

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
vi.mock('../actions/webauthnInviteAction', () => ({ createWebauthnInviteAction: mockCreateWebauthnInviteAction }));
vi.mock('../actions/webauthnRegisterAction', () => ({ createWebauthnRegisterAction: mockCreateWebauthnRegisterAction }));
vi.mock('../actions/webauthnReauthAction', () => ({ createWebauthnReauthAction: mockCreateWebauthnReauthAction }));

import { registerAuthRoutes } from './registerAuthRoutes';
import type { JwtAuthConfig, WebAuthnAuthConfig } from './authConfig';

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
      onGetUserDetails,
      onGetUser,
      syncUserToClient: true,
    };

    it('registers invite, register, reauth, and signout actions only, returns all four in order', () => {
      const result = registerAuthRoutes(webauthnConfig);

      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnInviteAction).toHaveBeenCalledWith(webauthnStore, onGetUserDetails);
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnRegisterAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledOnce();
      expect(mockCreateWebauthnReauthAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateSignoutAction).toHaveBeenCalledOnce();
      expect(mockCreateSignoutAction).toHaveBeenCalledWith(webauthnStore);
      expect(mockCreateSigninAction).not.toHaveBeenCalled();

      expect(result).toHaveLength(4);
      expect(result[0]).toBe(mockCreateWebauthnInviteAction.mock.results[0].value);
      expect(result[1]).toBe(mockCreateWebauthnRegisterAction.mock.results[0].value);
      expect(result[2]).toBe(mockCreateWebauthnReauthAction.mock.results[0].value);
      expect(result[3]).toBe(mockCreateSignoutAction.mock.results[0].value);
    });
  });
});
