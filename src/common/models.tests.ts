import { describe, it, expect } from 'vitest';
import type { SocketAPICredentials, SocketAPIUser, SocketAPIClientLoggingService } from './models';

describe('models', () => {
  describe('SocketAPICredentials', () => {
    it('has required id and password fields', () => {
      const credentials: SocketAPICredentials = {
        id: 'user-123',
        password: 'secret',
      };
      expect(credentials.id).toBe('user-123');
      expect(credentials.password).toBe('secret');
    });
  });

  describe('SocketAPIUser', () => {
    it('has required id field', () => {
      const user: SocketAPIUser = {
        id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      };
      expect(user.id).toBeDefined();
    });
  });

  describe('SocketAPIClientLoggingService', () => {
    it('is a function type that returns a function', () => {
      const service: SocketAPIClientLoggingService = () => () => Promise.resolve();
      expect(typeof service).toBe('function');
      expect(typeof service({} as never, undefined)).toBe('function');
    });
  });
});
