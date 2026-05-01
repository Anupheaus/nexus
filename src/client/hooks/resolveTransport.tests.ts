import { describe, it, expect } from 'vitest';
import { defineAction } from '../../common/defineAction';
import { resolveTransport, isRestOnly } from './resolveTransport';

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
