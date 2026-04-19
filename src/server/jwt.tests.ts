import { describe, it, expect } from 'vitest';
import { jwt } from './jwt';
import type { SocketAPIUser } from '../common';

describe('jwt', () => {
  const validUser: SocketAPIUser = { id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' };

  describe('createTokenFromUser', () => {
    it('creates a token with user data when no private key provided', async () => {
      const result = await jwt.createTokenFromUser(validUser);
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.split('.')).toHaveLength(3); // JWT format
      expect(result.publicKey).toBeDefined();
      expect(result.privateKey).toBeDefined();
    });

    it('creates a token when private key is provided', async () => {
      const { privateKey: base64PrivateKey } = await jwt.createTokenFromUser(validUser);
      const pemPrivateKey = Buffer.from(base64PrivateKey, 'base64').toString('utf-8');
      const result = await jwt.createTokenFromUser(validUser, pemPrivateKey);
      expect(result.token).toBeDefined();
      expect(result.privateKey).toBe(base64PrivateKey);
    });
  });

  describe('extractUserFromToken', () => {
    it('extracts user from valid token', async () => {
      const { token, publicKey } = await jwt.createTokenFromUser(validUser);
      const result = jwt.extractUserFromToken(token, publicKey);
      expect(result).toEqual(validUser);
    });

    it('throws when token is verified with wrong key', async () => {
      const { token } = await jwt.createTokenFromUser(validUser);
      const wrongKey = Buffer.from('invalid-key').toString('base64');
      expect(() => jwt.extractUserFromToken(token, wrongKey)).toThrow();
    });
  });

  describe('encodePrivateKey', () => {
    it('returns base64 encoded string for non-empty private key', () => {
      const pemKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
      const result = jwt.encodePrivateKey(pemKey);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(Buffer.from(result!, 'base64').toString('utf-8')).toBe(pemKey);
    });

    it('returns undefined for empty string', () => {
      expect(jwt.encodePrivateKey('')).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(jwt.encodePrivateKey(undefined)).toBeUndefined();
    });
  });
});
