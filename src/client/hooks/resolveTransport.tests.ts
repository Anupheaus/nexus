import { describe, it, expect, test } from 'vitest';
import { defineAction } from '../../common/defineAction';
import { resolveTransport, isRestOnly } from './resolveTransport';
import { signInAction, signOutAction, webauthnRegisterAction, webauthnReauthAction } from '../../common/internalActions';

const defaultAction    = defineAction<void, void>()('defaultAction');
const restOnlyAction   = defineAction<void, void>()('restOnlyAction',   { transport: ['rest'] });
const socketOnlyAction = defineAction<void, void>()('socketOnlyAction', { transport: ['socket'] });
const bothAction       = defineAction<void, void>()('bothAction',       { transport: ['socket', 'rest'] });

describe('resolveTransport', () => {
  describe('REST-only action', () => {
    it('returns rest when connected', () => {
      expect(resolveTransport(restOnlyAction, true)).toBe('rest');
    });
    it('returns rest when disconnected', () => {
      expect(resolveTransport(restOnlyAction, false)).toBe('rest');
    });
  });

  describe('socket-only action', () => {
    it('returns socket when connected', () => {
      expect(resolveTransport(socketOnlyAction, true)).toBe('socket');
    });
    it('returns wait when disconnected', () => {
      expect(resolveTransport(socketOnlyAction, false)).toBe('wait');
    });
  });

  describe('explicit both transports', () => {
    it('returns socket when connected', () => {
      expect(resolveTransport(bothAction, true)).toBe('socket');
    });
    it('returns rest when disconnected', () => {
      expect(resolveTransport(bothAction, false)).toBe('rest');
    });
  });

  describe('default (no transport set)', () => {
    it('returns socket when connected', () => {
      expect(resolveTransport(defaultAction, true)).toBe('socket');
    });
    it('returns rest when disconnected', () => {
      expect(resolveTransport(defaultAction, false)).toBe('rest');
    });
  });
});

// Cookie-setting actions must always use REST — setCookie/removeCookie throw in socket handlers.
// These tests guard against the transport constraint being accidentally removed.
describe('cookie-setting internal actions are always REST', () => {
  const cookieActions = [
    { name: 'signInAction', action: signInAction },
    { name: 'signOutAction', action: signOutAction },
    { name: 'webauthnRegisterAction', action: webauthnRegisterAction },
    { name: 'webauthnReauthAction', action: webauthnReauthAction },
  ];

  test.each(cookieActions)('$name resolves to REST when socket is connected', ({ action }) => {
    expect(resolveTransport(action, true)).toBe('rest');
  });

  test.each(cookieActions)('$name resolves to REST when socket is disconnected', ({ action }) => {
    expect(resolveTransport(action, false)).toBe('rest');
  });

  test.each(cookieActions)('$name is REST-only (isRestOnly returns true)', ({ action }) => {
    expect(isRestOnly(action)).toBe(true);
  });
});

describe('isRestOnly', () => {
  it('returns true for REST-only actions', () => {
    expect(isRestOnly(restOnlyAction)).toBe(true);
  });
  it('returns false for socket-only actions', () => {
    expect(isRestOnly(socketOnlyAction)).toBe(false);
  });
  it('returns false for both-transport actions', () => {
    expect(isRestOnly(bothAction)).toBe(false);
  });
  it('returns false for default actions', () => {
    expect(isRestOnly(defaultAction)).toBe(false);
  });
});
