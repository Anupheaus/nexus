import { describe, it, expect } from 'vitest';
import { jwt } from './jwt';

// Helper to create a JWT-like string (jwt-decode only parses the payload, doesn't verify)
function createTestJWT(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from('signature').toString('base64url');
  return `${header}.${payloadStr}.${signature}`;
}

describe('jwt', () => {
  describe('extractUntrustedUserFromToken', () => {
    it('returns user when token has valid user object with GUID id', () => {
      const validUserId = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
      const token = createTestJWT({ user: { id: validUserId } });
      const result = jwt.extractUntrustedUserFromToken(token);
      expect(result).toEqual({ id: validUserId });
    });

    it('returns undefined when user id is not a valid GUID', () => {
      const token = createTestJWT({ user: { id: 'not-a-guid' } });
      const result = jwt.extractUntrustedUserFromToken(token);
      expect(result).toBeUndefined();
    });

    it('returns undefined when user is null', () => {
      const token = createTestJWT({ user: null });
      const result = jwt.extractUntrustedUserFromToken(token);
      expect(result).toBeUndefined();
    });

    it('throws InternalError when payload decodes to a string instead of object', () => {
      // JWT payload that is a JSON string (e.g. "hello") decodes to a string
      const payloadStr = Buffer.from(JSON.stringify('string-payload')).toString('base64url');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const token = `${header}.${payloadStr}.sig`;

      expect(() => jwt.extractUntrustedUserFromToken(token)).toThrow('The format of the token is invalid.');
    });

    it('throws InternalError when payload has no user property', () => {
      const token = createTestJWT({ otherKey: 'value' });
      expect(() => jwt.extractUntrustedUserFromToken(token)).toThrow('The format of the token is invalid.');
    });

    it('throws when token is malformed (invalid base64)', () => {
      expect(() => jwt.extractUntrustedUserFromToken('not.valid.token!!!')).toThrow();
    });
  });
});
