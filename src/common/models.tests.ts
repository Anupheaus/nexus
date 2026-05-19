import { describe, it, expect } from 'vitest';
import type { NexusCredentials, NexusUser, NexusClientLoggingService } from './models';

describe('models', () => {
  describe('NexusCredentials', () => {
    it('has required id and password fields', () => {
      const credentials: NexusCredentials = {
        id: 'user-123',
        password: 'secret',
      };
      expect(credentials.id).toBe('user-123');
      expect(credentials.password).toBe('secret');
    });
  });

  describe('NexusUser', () => {
    it('has required id field', () => {
      const user: NexusUser = {
        id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      };
      expect(user.id).toBeDefined();
    });
  });

  describe('NexusClientLoggingService', () => {
    it('is a function type that returns a function', () => {
      const service: NexusClientLoggingService = () => () => Promise.resolve();
      expect(typeof service).toBe('function');
      expect(typeof service({} as never, undefined)).toBe('function');
    });
  });
});
